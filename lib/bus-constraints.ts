import { getLayerNames } from "./layer-names"
import type {
  BusTracerSimpleRouteJson,
  ResolvedBus,
  ResolvedConnection,
} from "./types"

export const getConnectionTraceWidth = (
  connection: ResolvedConnection,
  bus: ResolvedBus,
  srj: BusTracerSimpleRouteJson,
) =>
  connection.nominalTraceWidth ??
  bus.bus.traceWidth ??
  srj.nominalTraceWidth ??
  srj.minTraceWidth

export const getAllowedLayers = (
  bus: ResolvedBus,
  srj: BusTracerSimpleRouteJson,
) => bus.bus.allowedLayers ?? getLayerNames(srj.layerCount)

export const getLaneGeometry = (
  bus: ResolvedBus,
  srj: BusTracerSimpleRouteJson,
  clearance: number,
) => {
  const widths = bus.connections.map((connection) =>
    getConnectionTraceWidth(connection, bus, srj),
  )
  const pairGapByAdjacentConnectionNames = new Map<string, number>()

  for (const pair of srj.differentialPairs ?? []) {
    const firstIndex = bus.connections.findIndex(
      (connection) => connection.name === pair.connectionNames[0],
    )
    const secondIndex = bus.connections.findIndex(
      (connection) => connection.name === pair.connectionNames[1],
    )
    if (firstIndex === -1 && secondIndex === -1) continue
    if (firstIndex === -1 || secondIndex === -1) {
      throw new Error(
        `Differential pair "${pair.connectionNames.join("/")}" must belong to one bus`,
      )
    }
    if (Math.abs(firstIndex - secondIndex) !== 1) {
      throw new Error(
        `Differential pair "${pair.connectionNames.join("/")}" must be adjacent in bus "${bus.bus.busId}"`,
      )
    }
    if (pair.traceGap === undefined) continue
    pairGapByAdjacentConnectionNames.set(
      [firstIndex, secondIndex].sort((a, b) => a - b).join(":"),
      pair.traceGap,
    )
  }

  const uniformWidth = widths.every((width) => width === widths[0])
  if (uniformWidth && pairGapByAdjacentConnectionNames.size === 0) {
    const tracePitch = widths[0]! + clearance
    const middleRank = (widths.length - 1) / 2
    return {
      widths,
      laneCenterOffsets: widths.map(
        (_, index) => (index - middleRank) * tracePitch,
      ),
      copperWidth: widths[0]! + tracePitch * (widths.length - 1),
      maximumCenterPitch: tracePitch,
    }
  }

  const centers = [widths[0]! / 2]
  for (let index = 1; index < widths.length; index++) {
    const gap =
      pairGapByAdjacentConnectionNames.get(`${index - 1}:${index}`) ?? clearance
    centers.push(
      centers[index - 1]! + widths[index - 1]! / 2 + gap + widths[index]! / 2,
    )
  }
  const copperWidth = centers.at(-1)! + widths.at(-1)! / 2
  const center = copperWidth / 2
  const laneCenterOffsets = centers.map((position) => position - center)
  const centerPitches = laneCenterOffsets
    .slice(1)
    .map((offset, index) => offset - laneCenterOffsets[index]!)

  return {
    widths,
    laneCenterOffsets,
    copperWidth,
    maximumCenterPitch: Math.max(...centerPitches, ...widths),
  }
}

export const validateBusConstraints = (
  bus: ResolvedBus,
  srj: BusTracerSimpleRouteJson,
) => {
  const boardLayers = new Set(getLayerNames(srj.layerCount))
  const allowedLayers = getAllowedLayers(bus, srj)
  if (allowedLayers.length === 0) {
    throw new Error(`Bus "${bus.bus.busId}" has no allowed layers`)
  }
  for (const layer of allowedLayers) {
    if (!boardLayers.has(layer)) {
      throw new Error(
        `Bus "${bus.bus.busId}" references unavailable layer "${layer}"`,
      )
    }
  }
  const allowedLayerSet = new Set(allowedLayers)
  for (const connection of bus.connections) {
    if (
      !allowedLayerSet.has(connection.start.layer) ||
      !allowedLayerSet.has(connection.end.layer)
    ) {
      throw new Error(
        `Bus "${bus.bus.busId}" must allow the terminal layers for "${connection.name}"`,
      )
    }
    if (getConnectionTraceWidth(connection, bus, srj) <= 0) {
      throw new Error(
        `Bus "${bus.bus.busId}" has a non-positive trace width for "${connection.name}"`,
      )
    }
  }
  if (bus.bus.maxLengthSkew !== undefined && bus.bus.maxLengthSkew < 0) {
    throw new Error(`Bus "${bus.bus.busId}" has a negative maxLengthSkew`)
  }
  if (bus.bus.traceWidth !== undefined && bus.bus.traceWidth <= 0) {
    throw new Error(`Bus "${bus.bus.busId}" has a non-positive traceWidth`)
  }
  for (const pair of srj.differentialPairs ?? []) {
    if (pair.lengthTolerance < 0) {
      throw new Error(
        `Differential pair "${pair.connectionNames.join("/")}" has a negative lengthTolerance`,
      )
    }
    if (pair.traceGap !== undefined && pair.traceGap < 0) {
      throw new Error(
        `Differential pair "${pair.connectionNames.join("/")}" has a negative traceGap`,
      )
    }
  }
}
