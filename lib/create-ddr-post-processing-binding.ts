import type {
  HighDensityRoute,
  PostProcessingSolverOutput,
  PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import type { BusTracerSimpleRouteJson, SimplifiedPcbTrace } from "./types"

export type DdrPostProcessingBinding = {
  params: PostProcessingSolverParams
  getOutputTraces: (output: PostProcessingSolverOutput) => SimplifiedPcbTrace[]
}

/** Bind bus-tracer output to the native HD-route post-processing boundary. */
export const createDdrPostProcessingBinding = (input: {
  simpleRouteJson: BusTracerSimpleRouteJson
  generatedTraces: SimplifiedPcbTrace[]
  fixedTraces: SimplifiedPcbTrace[]
}): DdrPostProcessingBinding => {
  const { simpleRouteJson } = input
  const getLayerIndex = (layer: string): number => {
    if (layer === "top") return 0
    if (layer === "bottom") return simpleRouteJson.layerCount - 1
    const match = /^inner(\d+)$/.exec(layer)
    if (!match) throw new Error(`BusTracer: unsupported layer "${layer}"`)
    const index = Number(match[1])
    if (index <= 0 || index >= simpleRouteJson.layerCount - 1)
      throw new Error(`BusTracer: unavailable layer "${layer}"`)
    return index
  }
  const getLayerName = (index: number): string => {
    if (index === 0) return "top"
    if (index === simpleRouteJson.layerCount - 1) return "bottom"
    if (index > 0 && index < simpleRouteJson.layerCount - 1)
      return `inner${index}`
    throw new Error(`BusTracer: unavailable layer index ${index}`)
  }
  const getViaPadDiameter = (): number =>
    simpleRouteJson.min_via_pad_diameter ??
    simpleRouteJson.minViaPadDiameter ??
    simpleRouteJson.minViaDiameter ??
    0.6
  const getViaHoleDiameter = (): number =>
    simpleRouteJson.min_via_hole_diameter ??
    simpleRouteJson.minViaHoleDiameter ??
    0.3
  const measureTraceLength = (trace: SimplifiedPcbTrace): number => {
    let total = 0
    let previousWire: Extract<
      SimplifiedPcbTrace["route"][number],
      { route_type: "wire" }
    > | null = null
    for (const entry of trace.route) {
      if (entry.route_type !== "wire") {
        previousWire = null
        continue
      }
      if (previousWire?.layer === entry.layer)
        total += Math.hypot(entry.x - previousWire.x, entry.y - previousWire.y)
      previousWire = entry
    }
    return total
  }
  const fixedLengthByConnectionName: Record<string, number> = {}
  for (const trace of input.fixedTraces)
    fixedLengthByConnectionName[trace.connection_name] =
      (fixedLengthByConnectionName[trace.connection_name] ?? 0) +
      measureTraceLength(trace)

  const hdRoutes = input.generatedTraces.map((trace): HighDensityRoute => {
    const first = trace.route[0]
    if (!first || first.route_type !== "wire")
      throw new Error(
        `BusTracer: generated trace "${trace.connection_name}" must start with wire geometry`,
      )
    const route: HighDensityRoute["route"] = [
      {
        x: first.x,
        y: first.y,
        z: getLayerIndex(first.layer),
        traceThickness: first.width,
        ...(first.start_pcb_port_id
          ? { pcb_port_id: first.start_pcb_port_id }
          : {}),
      },
    ]
    const vias: HighDensityRoute["vias"] = []
    let currentLayer = first.layer
    let currentWidth = first.width
    let maximumViaDiameter = getViaPadDiameter()
    for (const entry of trace.route.slice(1)) {
      if (entry.route_type === "wire") {
        if (entry.layer !== currentLayer)
          throw new Error(
            `BusTracer: generated trace "${trace.connection_name}" changes layers without a via`,
          )
        const point = {
          x: entry.x,
          y: entry.y,
          z: getLayerIndex(entry.layer),
          traceThickness: entry.width,
          ...(entry.end_pcb_port_id
            ? { pcb_port_id: entry.end_pcb_port_id }
            : {}),
        }
        const previous = route.at(-1)!
        if (
          previous.x === point.x &&
          previous.y === point.y &&
          previous.z === point.z
        )
          route[route.length - 1] = { ...previous, ...point }
        else route.push(point)
        currentWidth = entry.width
        continue
      }
      if (entry.route_type !== "via")
        throw new Error(
          `BusTracer: generated trace "${trace.connection_name}" contains unsupported ${entry.route_type} geometry`,
        )
      const nextLayer =
        currentLayer === entry.from_layer
          ? entry.to_layer
          : currentLayer === entry.to_layer
            ? entry.from_layer
            : null
      if (!nextLayer)
        throw new Error(
          `BusTracer: generated trace "${trace.connection_name}" has a discontinuous via`,
        )
      const current = route.at(-1)!
      if (Math.hypot(current.x - entry.x, current.y - entry.y) > 1e-8)
        route.push({
          x: entry.x,
          y: entry.y,
          z: getLayerIndex(currentLayer),
          traceThickness: currentWidth,
        })
      route.push({
        x: entry.x,
        y: entry.y,
        z: getLayerIndex(nextLayer),
        traceThickness: currentWidth,
      })
      const fromZ = getLayerIndex(entry.from_layer)
      const toZ = getLayerIndex(entry.to_layer)
      vias.push({
        x: entry.x,
        y: entry.y,
        zLayers: Array.from(
          { length: Math.abs(toZ - fromZ) + 1 },
          (_, index) => Math.min(fromZ, toZ) + index,
        ),
      })
      maximumViaDiameter = Math.max(
        maximumViaDiameter,
        entry.via_diameter ?? getViaPadDiameter(),
      )
      currentLayer = nextLayer
    }
    if (route.length < 2)
      throw new Error(
        `BusTracer: generated trace "${trace.connection_name}" has incomplete copper`,
      )
    const lastWire = trace.route.findLast(
      (entry) => entry.route_type === "wire",
    )
    return {
      connectionName: trace.connection_name,
      traceThickness: Math.max(
        ...route.map((point) => point.traceThickness ?? first.width),
      ),
      viaDiameter: maximumViaDiameter,
      route,
      vias,
      ...(first.start_pcb_port_id
        ? { startPcbPortId: first.start_pcb_port_id }
        : {}),
      ...(lastWire?.route_type === "wire" && lastWire.end_pcb_port_id
        ? { endPcbPortId: lastWire.end_pcb_port_id }
        : {}),
    }
  })
  const getFixedLengths = (connectionNames: string[]): Record<string, number> =>
    Object.fromEntries(
      connectionNames.map((connectionName) => [
        connectionName,
        fixedLengthByConnectionName[connectionName] ?? 0,
      ]),
    )
  const busLengthMatchingGroups = (simpleRouteJson.buses ?? [])
    .filter((bus) => bus.maxLengthSkew !== undefined)
    .map((bus) => ({
      connectionNames: [...bus.connectionNames],
      maxLengthSkew: bus.maxLengthSkew!,
      fixedLengthByConnectionName: getFixedLengths(bus.connectionNames),
    }))
  // Pair spacing is already part of the atomic bus lane geometry. Apply the
  // tighter pair skew after whole-bus matching without rerouting it in isolation.
  const pairLengthMatchingGroups = (
    simpleRouteJson.differentialPairs ?? []
  ).map((pair) => ({
    connectionNames: [...pair.connectionNames],
    maxLengthSkew: pair.lengthTolerance,
    fixedLengthByConnectionName: getFixedLengths(pair.connectionNames),
  }))
  const availableLayerNames = new Set(
    Array.from({ length: simpleRouteJson.layerCount }, (_, index) =>
      getLayerName(index),
    ),
  )

  return {
    params: {
      hdRoutes,
      differentialPairs: [],
      lengthMatchingGroups: [
        ...busLengthMatchingGroups,
        ...pairLengthMatchingGroups,
      ],
      obstacles: structuredClone(simpleRouteJson.obstacles).map((obstacle) => ({
        ...obstacle,
        type: "rect" as const,
        layers: obstacle.layers.filter((layer) =>
          availableLayerNames.has(layer),
        ),
        connectedTo: obstacle.connectedTo ?? [],
      })),
      bounds: structuredClone(simpleRouteJson.bounds),
      layerCount: simpleRouteJson.layerCount,
    },
    getOutputTraces: (output) => {
      if (output.hdRoutes.length !== input.generatedTraces.length)
        throw new Error(
          "BusTracer: DDR post-processing changed the generated trace count",
        )
      return input.generatedTraces.map((sourceTrace) => {
        const matches = output.hdRoutes.filter(
          (route) => route.connectionName === sourceTrace.connection_name,
        )
        if (matches.length !== 1)
          throw new Error(
            `BusTracer: post-processed connection "${sourceTrace.connection_name}" must resolve to one HD route`,
          )
        const hdRoute = matches[0]!
        const firstPoint = hdRoute.route[0]
        if (!firstPoint)
          throw new Error(
            `BusTracer: post-processed connection "${sourceTrace.connection_name}" has no route`,
          )
        const route: SimplifiedPcbTrace["route"] = [
          {
            route_type: "wire",
            x: firstPoint.x,
            y: firstPoint.y,
            width: firstPoint.traceThickness ?? hdRoute.traceThickness,
            layer: getLayerName(firstPoint.z),
            ...((hdRoute.startPcbPortId ?? firstPoint.pcb_port_id)
              ? {
                  start_pcb_port_id:
                    hdRoute.startPcbPortId ?? firstPoint.pcb_port_id,
                }
              : {}),
          },
        ]
        for (let index = 1; index < hdRoute.route.length; index++) {
          const previous = hdRoute.route[index - 1]!
          const point = hdRoute.route[index]!
          if (previous.z !== point.z) {
            if (Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-8)
              throw new Error(
                `BusTracer: post-processed connection "${sourceTrace.connection_name}" moves while changing layers`,
              )
            route.push({
              route_type: "via",
              x: point.x,
              y: point.y,
              from_layer: getLayerName(previous.z),
              to_layer: getLayerName(point.z),
              via_diameter: hdRoute.viaDiameter,
              via_hole_diameter: getViaHoleDiameter(),
            })
          }
          route.push({
            route_type: "wire",
            x: point.x,
            y: point.y,
            width: point.traceThickness ?? hdRoute.traceThickness,
            layer: getLayerName(point.z),
            ...(index === hdRoute.route.length - 1 &&
            (hdRoute.endPcbPortId ?? point.pcb_port_id)
              ? {
                  end_pcb_port_id: hdRoute.endPcbPortId ?? point.pcb_port_id,
                }
              : {}),
          })
        }
        return { ...sourceTrace, route }
      })
    },
  }
}
