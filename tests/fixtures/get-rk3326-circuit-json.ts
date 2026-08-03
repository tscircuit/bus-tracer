import {
  checkDifferentNetViaSpacing,
  checkEachPcbPortConnectedToPcbTraces,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkSameNetViaSpacing,
  checkSourceTracesHavePcbTraces,
  checkTracesAreContiguous,
  checkViaTraceClearance,
  checkViasInPads,
  checkViasOffBoard,
  dedupePcbDrcErrors,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import type { BusTracer, BusTracerInput } from "lib/bus-tracer"
import { isPointInsideObstacle } from "lib/geometry"

export const getRk3326CircuitJson = (
  input: BusTracerInput,
  solver: BusTracer,
) => {
  const { simpleRouteJson } = input
  const elements: AnyCircuitElement[] = [
    {
      type: "pcb_board",
      pcb_board_id: "pcb_board_rk3326",
      center: {
        x: (simpleRouteJson.bounds.minX + simpleRouteJson.bounds.maxX) / 2,
        y: (simpleRouteJson.bounds.minY + simpleRouteJson.bounds.maxY) / 2,
      },
      width: simpleRouteJson.bounds.maxX - simpleRouteJson.bounds.minX,
      height: simpleRouteJson.bounds.maxY - simpleRouteJson.bounds.minY,
      num_layers: simpleRouteJson.layerCount,
    } as AnyCircuitElement,
  ]

  for (const obstacle of simpleRouteJson.obstacles) {
    if (obstacle.connectedTo.length > 0) continue
    elements.push({
      type: "pcb_component",
      pcb_component_id:
        obstacle.obstacleId ?? `rk3326_keepout_${elements.length}`,
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      layer: "top",
      rotation: obstacle.ccwRotationDegrees ?? 0,
      obstructs_within_bounds: true,
    } as AnyCircuitElement)
  }

  for (const connection of simpleRouteJson.connections) {
    const sourcePortIds = connection.pointsToConnect.map(
      (_, pointIndex) => `${connection.name}_source_port_${pointIndex}`,
    )
    const pcbPortIds = connection.pointsToConnect.map(
      (_, pointIndex) => `${connection.name}_pcb_port_${pointIndex}`,
    )
    elements.push(
      {
        type: "source_net",
        source_net_id: `${connection.name}_net`,
        name: connection.name,
      } as AnyCircuitElement,
      {
        type: "source_trace",
        source_trace_id: connection.name,
        connected_source_port_ids: sourcePortIds,
        connected_source_net_ids: [`${connection.name}_net`],
      } as AnyCircuitElement,
    )

    connection.pointsToConnect.forEach((point, pointIndex) => {
      const layer = "layer" in point ? point.layer : point.layers[0]!
      elements.push(
        {
          type: "source_port",
          source_port_id: sourcePortIds[pointIndex],
          name: `${connection.name}_${pointIndex}`,
        } as AnyCircuitElement,
        {
          type: "pcb_port",
          pcb_port_id: pcbPortIds[pointIndex],
          source_port_id: sourcePortIds[pointIndex],
          x: point.x,
          y: point.y,
          layers: [layer],
        } as AnyCircuitElement,
      )
    })
  }

  for (const trace of solver.getOutput().traces) {
    const connection = simpleRouteJson.connections.find(
      (candidate) => candidate.name === trace.connection_name,
    )!
    const route = trace.route.map((point) => ({ ...point }))
    const firstWire = route.find((point) => point.route_type === "wire")
    const lastWire = route.findLast((point) => point.route_type === "wire")
    if (firstWire?.route_type === "wire") {
      firstWire.start_pcb_port_id = `${connection.name}_pcb_port_0`
    }
    if (lastWire?.route_type === "wire") {
      lastWire.end_pcb_port_id = `${connection.name}_pcb_port_1`
    }
    elements.push({
      ...trace,
      source_trace_id: connection.name,
      route,
    } as AnyCircuitElement)

    route.forEach((point, routeIndex) => {
      if (point.route_type !== "via") return
      elements.push({
        type: "pcb_via",
        pcb_via_id: `${trace.pcb_trace_id}_via_${routeIndex}`,
        pcb_trace_id: trace.pcb_trace_id,
        x: point.x,
        y: point.y,
        hole_diameter: point.via_hole_diameter ?? 0.1,
        outer_diameter: point.via_diameter ?? 0.25,
        layers: [point.from_layer, point.to_layer],
        from_layer: point.from_layer,
        to_layer: point.to_layer,
      } as AnyCircuitElement)
    })
  }

  return elements
}

export const getRk3326DrcErrors = (
  input: BusTracerInput,
  solver: BusTracer,
) => {
  const circuitJson = getRk3326CircuitJson(input, solver)
  const minClearance = input.options?.traceClearance ?? 0.1
  return dedupePcbDrcErrors([
    ...checkEachPcbTraceNonOverlapping(circuitJson, { minClearance }),
    ...checkSameNetViaSpacing(circuitJson, { minClearance }),
    ...checkDifferentNetViaSpacing(circuitJson, { minClearance }),
    ...checkPadTraceClearance(circuitJson, { minClearance }),
    ...checkViaTraceClearance(circuitJson, { minClearance }),
    ...checkViasInPads(circuitJson),
    ...checkViasOffBoard(circuitJson),
    ...checkTracesAreContiguous(circuitJson),
    ...checkPcbTracesOutOfBoard(circuitJson),
    ...checkEachPcbPortConnectedToPcbTraces(circuitJson),
    ...checkSourceTracesHavePcbTraces(circuitJson),
  ] as AnyCircuitElement[])
}

export const getRk3326KeepoutViolations = (
  input: BusTracerInput,
  solver: BusTracer,
) => {
  const componentKeepouts = input.simpleRouteJson.obstacles.filter(
    (obstacle) => obstacle.connectedTo.length === 0,
  )
  const margin = input.options?.obstacleMargin ?? 0.1
  const violations: string[] = []

  for (const trace of solver.getOutput().traces) {
    for (let routeIndex = 0; routeIndex < trace.route.length; routeIndex++) {
      const point = trace.route[routeIndex]!
      if (point.route_type === "via") {
        for (const obstacle of componentKeepouts) {
          if (
            isPointInsideObstacle(
              point,
              obstacle,
              (point.via_diameter ?? 0.25) / 2 + margin,
            )
          ) {
            violations.push(`${trace.connection_name}:via:${routeIndex}`)
          }
        }
        continue
      }
      if (point.route_type !== "wire") continue
      const next = trace.route[routeIndex + 1]
      if (next?.route_type !== "wire" || next.layer !== point.layer) {
        continue
      }
      const length = Math.hypot(next.x - point.x, next.y - point.y)
      const sampleCount = Math.max(1, Math.ceil(length / 0.025))
      for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
        const progress = sampleIndex / sampleCount
        const sample = {
          x: point.x + (next.x - point.x) * progress,
          y: point.y + (next.y - point.y) * progress,
        }
        for (const obstacle of componentKeepouts) {
          if (
            obstacle.layers.includes(point.layer) &&
            isPointInsideObstacle(sample, obstacle, point.width / 2 + margin)
          ) {
            violations.push(`${trace.connection_name}:wire:${routeIndex}`)
          }
        }
      }
    }
  }
  return [...new Set(violations)]
}
