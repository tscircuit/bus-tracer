import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { pointToSegmentDistance } from "./geometry"
import { findGridPath } from "./grid-pathfinder"
import { getLayerNames } from "./layer-names"
import { createObstacleBlocker } from "./obstacle-blocker"
import { getBusCentroids, resolveBuses } from "./resolve-buses"
import type {
  BusTracerOptions,
  BusTracerSimpleRouteJson,
  CoarseBusRoute,
  CoarsePathfindingOutput,
  ResolvedBus,
} from "./types"
import { visualizeBusTracer } from "./visualize"

export type CoarseBusPathfindingSolverInput = {
  simpleRouteJson: BusTracerSimpleRouteJson
  options?: BusTracerOptions
}

export class CoarseBusPathfindingSolver extends BaseSolver {
  private readonly srj: BusTracerSimpleRouteJson
  private readonly options: BusTracerOptions
  private buses: ResolvedBus[] = []
  private nextBusIndex = 0
  coarseRoutes: CoarseBusRoute[] = []

  constructor(input: CoarseBusPathfindingSolverInput) {
    super()
    this.srj = input.simpleRouteJson
    this.options = input.options ?? {}
    this.MAX_ITERATIONS = Math.max(2, this.srj.buses?.length ?? 1) + 1
  }

  override _setup() {
    this.buses = resolveBuses(this.srj)
    this.MAX_ITERATIONS = this.buses.length + 1
  }

  override _step() {
    const bus = this.buses[this.nextBusIndex]
    if (!bus) {
      this.solved = true
      this.progress = 1
      return
    }
    this.coarseRoutes.push(this.routeBus(bus))
    this.nextBusIndex++
    this.progress = this.nextBusIndex / this.buses.length
    this.stats = {
      busesPlanned: this.nextBusIndex,
      totalBuses: this.buses.length,
      coarseVias: this.coarseRoutes.reduce(
        (count, route) => count + countLayerChanges(route.centerline),
        0,
      ),
    }
  }

  private routeBus(bus: ResolvedBus): CoarseBusRoute {
    const { start, end } = getBusCentroids(bus)
    const startLayers = new Set(
      bus.connections.map((connection) => connection.start.layer),
    )
    const endLayers = new Set(
      bus.connections.map((connection) => connection.end.layer),
    )
    if (startLayers.size !== 1 || endLayers.size !== 1) {
      throw new Error(
        `Bus "${bus.bus.busId}" must have a common start layer and a common end layer`,
      )
    }

    const clearance =
      this.options.traceClearance ??
      (bus.connections.length > 2
        ? Math.max(this.srj.minTraceWidth, 0.3)
        : Math.max(this.srj.minTraceWidth, 0.12))
    const traceWidth = Math.max(
      this.srj.minTraceWidth,
      ...bus.connections.map(
        (connection) =>
          connection.nominalTraceWidth ?? this.srj.nominalTraceWidth ?? 0,
      ),
    )
    const tracePitch = traceWidth + clearance
    const obstacleMargin =
      this.options.obstacleMargin ?? this.srj.defaultObstacleMargin ?? 0.1
    const corridorWidth =
      traceWidth +
      tracePitch * (bus.connections.length - 1) +
      obstacleMargin * 2
    const shortestBoardSide = Math.min(
      this.srj.bounds.maxX - this.srj.bounds.minX,
      this.srj.bounds.maxY - this.srj.bounds.minY,
    )
    const cellSize =
      this.options.coarseGridCellSize ?? Math.max(0.4, shortestBoardSide / 60)
    const ignoredIds = new Set<string>()
    for (const connection of bus.connections) {
      ignoredIds.add(connection.name)
      if (connection.start.pointId) ignoredIds.add(connection.start.pointId)
      if (connection.end.pointId) ignoredIds.add(connection.end.pointId)
      if (connection.start.pcbPortId) ignoredIds.add(connection.start.pcbPortId)
      if (connection.end.pcbPortId) ignoredIds.add(connection.end.pcbPortId)
    }

    const extraBlocked = (point: { x: number; y: number }, layer: string) => {
      for (const previous of this.coarseRoutes) {
        for (let index = 0; index < previous.centerline.length - 1; index++) {
          const first = previous.centerline[index]!
          const second = previous.centerline[index + 1]!
          if (first.layer !== layer || second.layer !== layer) continue
          if (
            pointToSegmentDistance(point, first, second) <
            (corridorWidth + previous.corridorWidth) / 2
          ) {
            return true
          }
        }
      }
      return false
    }
    const isBlocked = createObstacleBlocker(this.srj, {
      padding: corridorWidth / 2,
      ignoredConnectionIds: ignoredIds,
      ignoreObstacleShortSideBelow:
        this.options.coarseIgnoreObstacleShortSideBelow ?? cellSize * 1.25,
      extraBlocked,
    })
    const boardDiagonal = Math.hypot(
      this.srj.bounds.maxX - this.srj.bounds.minX,
      this.srj.bounds.maxY - this.srj.bounds.minY,
    )
    let centerline = findGridPath({
      start,
      goal: end,
      layers: getLayerNames(this.srj.layerCount),
      bounds: this.srj.bounds,
      cellSize,
      viaPenalty: this.options.coarseViaPenalty ?? boardDiagonal * 0.45,
      isBlocked,
      allowLayerChanges: this.srj.layerCount > 1,
    })
    // Keep dense fanouts on their terminal layer while giving the shared bus
    // trunk an alternate layer with identical escape and return vias per lane.
    if (
      bus.connections.length > 2 &&
      this.srj.layerCount > 1 &&
      centerline.length > 3 &&
      countLayerChanges(centerline) === 0
    ) {
      const alternateLayer = getLayerNames(this.srj.layerCount).find(
        (layer) => layer !== centerline[0]!.layer,
      )!
      const firstViaIndex = 1
      const secondViaIndex = centerline.length - 2
      centerline = centerline.flatMap((point, index) => {
        if (index === firstViaIndex) {
          return [point, { ...point, layer: alternateLayer }]
        }
        if (index > firstViaIndex && index < secondViaIndex) {
          return [{ ...point, layer: alternateLayer }]
        }
        if (index === secondViaIndex) {
          return [{ ...point, layer: alternateLayer }, point]
        }
        return [point]
      })
    }

    return {
      busId: bus.bus.busId,
      connectionNames: bus.connections.map((connection) => connection.name),
      centerline,
      tracePitch,
      corridorWidth,
    }
  }

  override getOutput(): CoarsePathfindingOutput {
    return { buses: this.coarseRoutes }
  }

  override getConstructorParams() {
    return [{ simpleRouteJson: this.srj, options: this.options }]
  }

  override visualize(): GraphicsObject {
    return visualizeBusTracer({
      simpleRouteJson: this.srj,
      coarseRoutes: this.coarseRoutes,
    })
  }
}

const countLayerChanges = (points: CoarseBusRoute["centerline"]) => {
  let count = 0
  for (let index = 0; index < points.length - 1; index++) {
    if (points[index]!.layer !== points[index + 1]!.layer) count++
  }
  return count
}
