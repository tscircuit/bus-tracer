import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { getAllowedLayers, getConnectionTraceWidth } from "./bus-constraints"
import {
  countSameLayerTraceCrossings,
  getOffsetPolyline,
  pointToSegmentDistance,
  simplifyRoutePoints,
} from "./geometry"
import { findGridPath } from "./grid-pathfinder"
import { getLayerNames } from "./layer-names"
import { createObstacleBlocker } from "./obstacle-blocker"
import { resolveBuses } from "./resolve-buses"
import type {
  BusTracerOptions,
  BusTracerSimpleRouteJson,
  CoarseBusRoute,
  DetailedRoutingOutput,
  ResolvedBus,
  RoutePoint,
  SimplifiedPcbTrace,
} from "./types"
import { visualizeBusTracer } from "./visualize"

export type DetailedBusRoutingSolverInput = {
  simpleRouteJson: BusTracerSimpleRouteJson
  coarseRoutes: CoarseBusRoute[]
  options?: BusTracerOptions
}

type WireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

type SharedGuardDistances = { start: number; end: number }

// This branch is intentionally bounded to the small-bus use case. Larger
// buses retain the established shared-guard strategy used by the dataset.
const MAX_PERMUTATION_AWARE_TRACE_COUNT = 10

export class DetailedBusRoutingSolver extends BaseSolver {
  private readonly srj: BusTracerSimpleRouteJson
  private readonly coarseRoutes: CoarseBusRoute[]
  private readonly options: BusTracerOptions
  private buses: ResolvedBus[] = []
  private nextBusIndex = 0
  generatedTraces: SimplifiedPcbTrace[] = []

  constructor(input: DetailedBusRoutingSolverInput) {
    super()
    this.srj = input.simpleRouteJson
    this.coarseRoutes = input.coarseRoutes
    this.options = input.options ?? {}
    this.MAX_ITERATIONS = Math.max(2, this.coarseRoutes.length) + 1
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
    const traces = this.routeBus(bus)
    const viaCounts = new Set(
      traces.map(
        (trace) =>
          trace.route.filter((point) => point.route_type === "via").length,
      ),
    )
    if (viaCounts.size !== 1) {
      throw new Error(`Bus "${bus.bus.busId}" produced inconsistent via counts`)
    }
    this.generatedTraces.push(...traces)
    this.nextBusIndex++
    this.progress = this.nextBusIndex / this.buses.length
    this.stats = {
      busesDetailed: this.nextBusIndex,
      totalBuses: this.buses.length,
      tracesPlanned: this.generatedTraces.length,
    }
  }

  private routeBus(bus: ResolvedBus): SimplifiedPcbTrace[] {
    const coarse = this.coarseRoutes.find(
      (route) => route.busId === bus.bus.busId,
    )
    if (!coarse)
      throw new Error(`Missing coarse route for bus "${bus.bus.busId}"`)
    const usePermutationAwareRouting = shouldUsePermutationAwareRouting(
      bus,
      coarse,
    )
    const detailedCoarse = usePermutationAwareRouting
      ? getDetailedCoarseRoute(bus, coarse)
      : coarse
    const laneGuides = getLaneGuides(bus, detailedCoarse)
    this.alignAndClearSharedVias(bus, detailedCoarse, laneGuides)
    this.addSingleTransitionEscapeGuards(bus, detailedCoarse, laneGuides)
    const sharedGuardDistances =
      !usePermutationAwareRouting &&
      bus.connections.length > 2 &&
      countLayerChanges(detailedCoarse.centerline) > 1
        ? getSharedGuardDistances(bus, detailedCoarse, laneGuides)
        : undefined
    let lastError: unknown
    for (const connectionOrder of getConnectionOrderCandidates(bus, coarse)) {
      const traces: SimplifiedPcbTrace[] = []
      try {
        for (const connectionIndex of connectionOrder) {
          traces.push(
            this.routeConnection(
              bus,
              connectionIndex,
              laneGuides[connectionIndex]!,
              laneGuides,
              detailedCoarse,
              traces,
              sharedGuardDistances,
            ),
          )
        }
        const crossingCount = countSameLayerTraceCrossings(traces)
        if (crossingCount > 0) {
          throw new Error(
            `Bus "${bus.bus.busId}" produced ${crossingCount} same-layer trace crossings`,
          )
        }
        return traces
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  private addSingleTransitionEscapeGuards(
    bus: ResolvedBus,
    coarse: CoarseBusRoute,
    laneGuides: RoutePoint[][],
  ) {
    if (!shouldUsePermutationAwareRouting(bus, coarse)) return
    const layerChangeIndices = coarse.centerline.flatMap((point, index) =>
      index < coarse.centerline.length - 1 &&
      point.layer !== coarse.centerline[index + 1]!.layer
        ? [index]
        : [],
    )
    if (layerChangeIndices.length !== 1) return

    const layerChangeIndex = layerChangeIndices[0]!
    const afterTransition = coarse.centerline[layerChangeIndex + 1]!
    const nextPoint = coarse.centerline
      .slice(layerChangeIndex + 2)
      .find(
        (point) =>
          point.layer === afterTransition.layer &&
          (point.x !== afterTransition.x || point.y !== afterTransition.y),
      )
    if (!nextPoint) return

    const dx = nextPoint.x - afterTransition.x
    const dy = nextPoint.y - afterTransition.y
    const magnitude = Math.hypot(dx, dy) || 1
    let direction = { x: dx / magnitude, y: dy / magnitude }
    if (!areTerminalArraysPerpendicular(bus)) {
      const endDirection = getStableTerminalArrayDirection(
        bus.connections.map((connection) => connection.end),
      )
      const sign = endDirection.x * dx + endDirection.y * dy >= 0 ? 1 : -1
      direction = {
        x: endDirection.x * sign,
        y: endDirection.y * sign,
      }
    }
    const viaPoints = laneGuides.map((guide) => guide[layerChangeIndex + 1]!)
    const furthestProjection = Math.max(
      ...viaPoints.map(
        (point) => point.x * direction.x + point.y * direction.y,
      ),
    )
    const maximumTraceWidth = Math.max(
      this.srj.minTraceWidth,
      ...bus.connections.map(
        (connection) =>
          connection.nominalTraceWidth ??
          this.srj.nominalTraceWidth ??
          this.srj.minTraceWidth,
      ),
    )
    const clearance =
      getViaDiameter(this.srj) / 2 +
      maximumTraceWidth / 2 +
      (this.options.traceClearance ?? this.srj.minTraceWidth)
    const guardProjection = furthestProjection + clearance

    for (const guide of laneGuides) {
      const viaPoint = guide[layerChangeIndex + 1]!
      const projection = viaPoint.x * direction.x + viaPoint.y * direction.y
      const distance = guardProjection - projection
      guide.splice(layerChangeIndex + 2, 0, {
        x: viaPoint.x + direction.x * distance,
        y: viaPoint.y + direction.y * distance,
        layer: afterTransition.layer,
      })
    }
  }

  private alignAndClearSharedVias(
    bus: ResolvedBus,
    coarse: CoarseBusRoute,
    laneGuides: RoutePoint[][],
  ) {
    const usePermutationAwareRouting = shouldUsePermutationAwareRouting(
      bus,
      coarse,
    )
    const viaDiameter = getViaDiameter(this.srj)
    const margin =
      this.options.obstacleMargin ?? this.srj.defaultObstacleMargin ?? 0.1
    const grid =
      this.options.detailGridCellSize ?? Math.max(0.2, coarse.tracePitch / 2)
    const layerChangeIndices = coarse.centerline.flatMap((point, index) =>
      index < coarse.centerline.length - 1 &&
      point.layer !== coarse.centerline[index + 1]!.layer
        ? [index]
        : [],
    )
    const startTerminalPoints = bus.connections.map(
      (connection) => connection.start,
    )
    const endTerminalPoints = bus.connections.map(
      (connection) => connection.end,
    )
    const firstLayerChange = layerChangeIndices[0]
    const sharedCrossbarDirection =
      firstLayerChange === undefined
        ? undefined
        : getPerpendicularDirectionToward(
            getStableTerminalArrayDirection(startTerminalPoints),
            getPointCentroid(startTerminalPoints),
            coarse.centerline[firstLayerChange]!,
          )
    // Intermediate bus sections use one stable lane identity. The first and
    // last via fields map the terminals' spatial order to and from this order.
    // Keeping that permutation inside a via field lets the planar copper on
    // either side remain an uncrossed ribbon.
    const trunkRanks = bus.connections.map((_, index) => index)

    for (let index = 0; index < coarse.centerline.length - 1; index++) {
      const before = coarse.centerline[index]!
      const after = coarse.centerline[index + 1]!
      if (before.layer === after.layer) continue

      const layerChangePosition = layerChangeIndices.indexOf(index)
      const isSingleChangeCloserToStart =
        layerChangeIndices.length === 1 &&
        Math.hypot(
          before.x - getPointCentroid(startTerminalPoints).x,
          before.y - getPointCentroid(startTerminalPoints).y,
        ) <=
          Math.hypot(
            before.x - getPointCentroid(endTerminalPoints).x,
            before.y - getPointCentroid(endTerminalPoints).y,
          )
      const terminalPoints =
        bus.connections.length > 2 &&
        layerChangePosition === 0 &&
        (layerChangeIndices.length > 1 || isSingleChangeCloserToStart)
          ? startTerminalPoints
          : bus.connections.length > 2 &&
              layerChangePosition === layerChangeIndices.length - 1 &&
              (layerChangeIndices.length > 1 || !isSingleChangeCloserToStart)
            ? endTerminalPoints
            : undefined
      const oppositeTerminalPoints =
        terminalPoints === startTerminalPoints
          ? endTerminalPoints
          : startTerminalPoints
      const terminalRanks = terminalPoints
        ? getPointRanksAlongDirection(
            terminalPoints,
            getStableTerminalArrayDirection(terminalPoints),
          )
        : undefined
      const transitionRanks = terminalPoints
        ? layerChangeIndices.length > 1
          ? trunkRanks
          : getPointRanksAlongDirection(
              oppositeTerminalPoints,
              getStableTerminalArrayDirection(oppositeTerminalPoints),
            )
        : undefined
      const transitionPermutesLanes =
        terminalRanks !== undefined &&
        transitionRanks !== undefined &&
        terminalRanks.some(
          (rank, connectionIndex) => rank !== transitionRanks[connectionIndex],
        )
      const baseLanePoints = terminalPoints
        ? getTerminalAlignedViaPoints(
            { x: before.x, y: before.y },
            terminalPoints,
            oppositeTerminalPoints,
            coarse.tracePitch,
            viaDiameter,
            Math.max(margin, 0.1),
            {
              useTwoDimensionalField: usePermutationAwareRouting
                ? layerChangeIndices.length > 1 || transitionPermutesLanes
                : layerChangeIndices.length === 1,
              secondaryRanks: usePermutationAwareRouting
                ? transitionRanks
                : undefined,
              secondaryDirection:
                layerChangeIndices.length > 1
                  ? sharedCrossbarDirection
                  : undefined,
              terminalEscapePadding: usePermutationAwareRouting ? 0.3 : 0.8,
              includeFieldHalfSpan: usePermutationAwareRouting,
              useLegacyViaPitch: !usePermutationAwareRouting,
            },
          )
        : laneGuides.map((guide) => ({
            x: (guide[index]!.x + guide[index + 1]!.x) / 2,
            y: (guide[index]!.y + guide[index + 1]!.y) / 2,
          }))
      const translations = [{ x: 0, y: 0 }]
      if (terminalPoints) {
        const terminalDirection = getTerminalArrayDirection(terminalPoints)
        const escapeDirection = getPerpendicularDirectionToward(
          terminalDirection,
          getPointCentroid(terminalPoints),
          getPointCentroid(baseLanePoints),
        )
        for (let step = 1; step <= Math.ceil(6 / grid); step++) {
          translations.push({
            x: escapeDirection.x * step * grid,
            y: escapeDirection.y * step * grid,
          })
        }
      } else {
        for (let ring = 1; ring <= Math.ceil(2 / grid); ring++) {
          for (let dx = -ring; dx <= ring; dx++) {
            for (let dy = -ring; dy <= ring; dy++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
              translations.push({ x: dx * grid, y: dy * grid })
            }
          }
        }
      }

      const translation = translations.find((candidate) =>
        bus.connections.every((connection, connectionIndex) => {
          const ignoredIds = getConnectionIds(connection)
          const blocked = createObstacleBlocker(this.srj, {
            padding: viaDiameter / 2 + margin,
            ignoredConnectionIds: ignoredIds,
          })
          const point = {
            x: baseLanePoints[connectionIndex]!.x + candidate.x,
            y: baseLanePoints[connectionIndex]!.y + candidate.y,
          }
          return !blocked(point, before.layer) && !blocked(point, after.layer)
        }),
      )
      if (!translation) {
        throw new Error(
          `No shared clear via region near (${before.x}, ${before.y}) for bus "${bus.bus.busId}"`,
        )
      }

      for (let laneIndex = 0; laneIndex < laneGuides.length; laneIndex++) {
        const viaPoint = {
          x: baseLanePoints[laneIndex]!.x + translation.x,
          y: baseLanePoints[laneIndex]!.y + translation.y,
        }
        laneGuides[laneIndex]![index] = { ...viaPoint, layer: before.layer }
        laneGuides[laneIndex]![index + 1] = { ...viaPoint, layer: after.layer }
      }
    }
  }

  private routeConnection(
    bus: ResolvedBus,
    connectionIndex: number,
    guide: RoutePoint[],
    allLaneGuides: RoutePoint[][],
    coarse: CoarseBusRoute,
    priorBusTraces: SimplifiedPcbTrace[],
    sharedGuardDistances?: SharedGuardDistances,
  ): SimplifiedPcbTrace {
    const usePermutationAwareRouting = shouldUsePermutationAwareRouting(
      bus,
      coarse,
    )
    const connection = bus.connections[connectionIndex]!
    const traceWidth = getConnectionTraceWidth(connection, bus, this.srj)
    const margin =
      this.options.obstacleMargin ?? this.srj.defaultObstacleMargin ?? 0.1
    const traceClearance =
      this.options.traceClearance ?? Math.max(this.srj.minTraceWidth, 0.12)
    const detailCellSize =
      this.options.detailGridCellSize ??
      (usePermutationAwareRouting && countLayerChanges(coarse.centerline) === 1
        ? Math.max(0.04, traceClearance / 2)
        : Math.max(0.2, coarse.tracePitch / 2))
    // Closely pitched fanout terminals can have overlapping clearance halos.
    // All terminals owned by this bus form one fanout region; blocking sibling
    // terminals would make a connection start inside an obstacle before it has
    // a chance to escape the array. Unrelated pads and component keepouts are
    // still handled by the obstacle blocker.
    const connectionIds = getConnectionIds(connection)
    const terminalBlocker = createObstacleBlocker(this.srj, {
      padding: traceWidth / 2 + margin,
      ignoredConnectionIds: connectionIds,
    })
    const ignoredIds =
      terminalBlocker(connection.start, connection.start.layer) ||
      terminalBlocker(connection.end, connection.end.layer)
        ? getBusConnectionIds(bus)
        : connectionIds
    const viaDiameter = getViaDiameter(this.srj)
    const terminalArraysArePerpendicular = usePermutationAwareRouting
      ? areTerminalArraysPerpendicular(bus)
      : areLegacyTerminalArraysPerpendicular(bus)
    const extraBlocked = (point: { x: number; y: number }, layer: string) => {
      if (
        usePermutationAwareRouting ||
        countLayerChanges(coarse.centerline) === 1
      ) {
        for (
          let otherConnectionIndex = 0;
          otherConnectionIndex < allLaneGuides.length;
          otherConnectionIndex++
        ) {
          if (otherConnectionIndex === connectionIndex) continue
          const otherGuide = allLaneGuides[otherConnectionIndex]!
          for (let index = 0; index < otherGuide.length - 1; index++) {
            const before = otherGuide[index]!
            const after = otherGuide[index + 1]!
            if (before.layer === after.layer) continue
            if (!viaSpansLayer(before.layer, after.layer, layer, this.srj)) {
              continue
            }
            if (
              Math.hypot(point.x - before.x, point.y - before.y) <
              viaDiameter / 2 + traceWidth / 2 + traceClearance
            ) {
              return true
            }
          }
        }
      }
      if (
        !terminalArraysArePerpendicular &&
        layer !== connection.start.layer &&
        layer !== connection.end.layer
      ) {
        return false
      }
      if (!usePermutationAwareRouting) {
        for (const priorTrace of priorBusTraces) {
          for (let index = 0; index < priorTrace.route.length - 1; index++) {
            const first = priorTrace.route[index]!
            const second = priorTrace.route[index + 1]!
            if (
              first.route_type !== "wire" ||
              second.route_type !== "wire" ||
              first.layer !== layer ||
              second.layer !== layer
            ) {
              continue
            }
            if (
              pointToSegmentDistance(point, first, second) <
              (traceWidth + first.width) / 2 + traceClearance
            ) {
              return true
            }
          }
        }
      }
      return false
    }
    const isBlocked = createObstacleBlocker(this.srj, {
      padding: traceWidth / 2 + margin,
      ignoredConnectionIds: ignoredIds,
      extraBlocked,
    })
    const layerSegments = splitGuideByLayerChanges(guide)
    const route: SimplifiedPcbTrace["route"] = []

    for (
      let segmentIndex = 0;
      segmentIndex < layerSegments.length;
      segmentIndex++
    ) {
      const segment = layerSegments[segmentIndex]!
      const searchMargin =
        this.options.fineSearchMargin ?? Math.max(1.5, coarse.corridorWidth)
      const boundedSearch = getSearchBounds(
        segment.points,
        this.srj.bounds,
        searchMargin,
      )
      let path: RoutePoint[]
      const fanoutGuardPath = getFanoutGuardPath(
        bus,
        connection,
        segment.points[0]!,
        segment.points.at(-1)!,
        Math.max(0.3, traceWidth / 2 + margin + 0.18),
      )
      if (
        !usePermutationAwareRouting &&
        bus.connections.length > 2 &&
        segment.layer !== connection.start.layer &&
        !areLegacyTerminalArraysPerpendicular(bus)
      ) {
        const startVia = segment.points[0]!
        const endVia = segment.points.at(-1)!
        if (!sharedGuardDistances) {
          throw new Error("Dense trunk routing requires shared guard distances")
        }
        const startDirection = getUnitDirection(connection.start, startVia)
        const endDirection = getUnitDirection(connection.end, endVia)
        const startGuard = {
          x: connection.start.x + startDirection.x * sharedGuardDistances.start,
          y: connection.start.y + startDirection.y * sharedGuardDistances.start,
          layer: segment.layer,
        }
        const endGuard = {
          x: connection.end.x + endDirection.x * sharedGuardDistances.end,
          y: connection.end.y + endDirection.y * sharedGuardDistances.end,
          layer: segment.layer,
        }
        path = simplifyRoutePoints([startVia, startGuard, endGuard, endVia])
      } else if (
        usePermutationAwareRouting &&
        countLayerChanges(coarse.centerline) === 1 &&
        isPolylineClear(segment.points, detailCellSize / 3, isBlocked)
      ) {
        // The coarse corridor was cleared for the complete ribbon. Preserve a
        // continuous offset lane when it is already valid; snapping a 0.165 mm
        // lane pitch to the 0.2 mm fallback grid can make a valid dense ribbon
        // appear impossible.
        path = simplifyRoutePoints(segment.points)
      } else if (
        usePermutationAwareRouting &&
        fanoutGuardPath &&
        isPolylineClear(fanoutGuardPath, detailCellSize / 2, isBlocked)
      ) {
        path = simplifyRoutePoints(fanoutGuardPath)
      } else if (
        bus.connections.length > 2 &&
        isDirectPathClear(
          segment.points[0]!,
          segment.points.at(-1)!,
          detailCellSize / 2,
          isBlocked,
        )
      ) {
        path = simplifyRoutePoints([segment.points[0]!, segment.points.at(-1)!])
      } else {
        try {
          path = findGridPath({
            start: segment.points[0]!,
            goal: segment.points.at(-1)!,
            layers: getAllowedLayers(bus, this.srj),
            bounds: boundedSearch,
            cellSize: detailCellSize,
            viaPenalty: 1e6,
            isBlocked,
            guide: segment.points,
            guidePenalty: this.options.fineGuidePenalty ?? 0.08,
            allowLayerChanges: false,
          })
        } catch (error) {
          if (usePermutationAwareRouting) throw error
          path = findGridPath({
            start: segment.points[0]!,
            goal: segment.points.at(-1)!,
            layers: getAllowedLayers(bus, this.srj),
            bounds: this.srj.bounds,
            cellSize: detailCellSize,
            viaPenalty: 1e6,
            isBlocked,
            guide: segment.points,
            guidePenalty: this.options.fineGuidePenalty ?? 0.08,
            allowLayerChanges: false,
          })
        }
      }

      for (const point of path) {
        const wire: WireRoutePoint = {
          route_type: "wire",
          x: point.x,
          y: point.y,
          width: traceWidth,
          layer: point.layer,
        }
        route.push(wire)
      }
      if (segment.toLayer) {
        const viaPoint = path.at(-1)!
        route.push({
          route_type: "via",
          x: viaPoint.x,
          y: viaPoint.y,
          from_layer: segment.layer,
          to_layer: segment.toLayer,
          via_diameter: getViaDiameter(this.srj),
          via_hole_diameter:
            this.srj.min_via_hole_diameter ?? this.srj.minViaHoleDiameter,
        })
      }
    }

    const firstWire = route.find(
      (point): point is WireRoutePoint => point.route_type === "wire",
    )
    const lastWire = route.findLast(
      (point): point is WireRoutePoint => point.route_type === "wire",
    )
    if (firstWire && connection.start.pcbPortId) {
      firstWire.start_pcb_port_id = connection.start.pcbPortId
    }
    if (lastWire && connection.end.pcbPortId) {
      lastWire.end_pcb_port_id = connection.end.pcbPortId
    }

    return {
      type: "pcb_trace",
      pcb_trace_id: `pcb_trace_bus_tracer_${this.nextBusIndex}_${connectionIndex}`,
      connection_name: connection.name,
      connectsTo: [
        connection.start.pointId ?? connection.start.pcbPortId,
        connection.end.pointId ?? connection.end.pcbPortId,
      ].filter((id): id is string => Boolean(id)),
      route,
    }
  }

  override getOutput(): DetailedRoutingOutput {
    const traces = [...(this.srj.traces ?? []), ...this.generatedTraces]
    return {
      traces: this.generatedTraces,
      simpleRouteJson: { ...this.srj, traces },
    }
  }

  override getConstructorParams() {
    return [
      {
        simpleRouteJson: this.srj,
        coarseRoutes: this.coarseRoutes,
        options: this.options,
      },
    ]
  }

  override visualize(): GraphicsObject {
    return visualizeBusTracer({
      simpleRouteJson: this.srj,
      coarseRoutes: this.coarseRoutes,
      traces: [...(this.srj.traces ?? []), ...this.generatedTraces],
    })
  }
}

const getViaDiameter = (srj: BusTracerSimpleRouteJson) =>
  srj.min_via_pad_diameter ?? srj.minViaPadDiameter ?? srj.minViaDiameter ?? 0.6

const getTerminalAlignedViaPoints = (
  center: { x: number; y: number },
  terminalPoints: RoutePoint[],
  oppositeTerminalPoints: RoutePoint[],
  tracePitch: number,
  viaDiameter: number,
  clearance: number,
  options: {
    useTwoDimensionalField: boolean
    secondaryRanks?: number[]
    secondaryDirection?: { x: number; y: number }
    terminalEscapePadding?: number
    includeFieldHalfSpan?: boolean
    useLegacyViaPitch?: boolean
  },
) => {
  const { useTwoDimensionalField } = options
  const direction = useTwoDimensionalField
    ? getStableTerminalArrayDirection(terminalPoints)
    : getTerminalArrayDirection(terminalPoints)
  const terminalCenter = getPointCentroid(terminalPoints)
  const escapeDirection = getPerpendicularDirectionToward(
    direction,
    terminalCenter,
    center,
  )
  const terminalPitch = Math.min(
    ...terminalPoints
      .slice(0, -1)
      .map((point, index) =>
        Math.hypot(
          terminalPoints[index + 1]!.x - point.x,
          terminalPoints[index + 1]!.y - point.y,
        ),
      ),
  )
  const legacyViaPitch = Math.max(
    tracePitch,
    terminalPitch,
    viaDiameter + clearance,
  )
  const secondaryViaPitch = options.useLegacyViaPitch
    ? legacyViaPitch
    : Math.max(tracePitch, viaDiameter + clearance)
  const primaryViaPitch = options.useLegacyViaPitch
    ? legacyViaPitch
    : Math.max(
        secondaryViaPitch,
        terminalPitch,
        useTwoDimensionalField ? viaDiameter + tracePitch : 0,
      )
  const middleIndex = (terminalPoints.length - 1) / 2
  const fieldHalfSpan =
    useTwoDimensionalField && (options.includeFieldHalfSpan ?? true)
      ? middleIndex * secondaryViaPitch
      : 0
  // Keep the complete staggered field outside the terminal row, rather than
  // clearing only its centroid. This is important for wide permutation fields:
  // the last row must not fold back across the pads while the bus converges.
  const minimumTerminalEscape =
    viaDiameter +
    clearance +
    (options.terminalEscapePadding ?? 0.3) +
    fieldHalfSpan
  const currentTerminalEscape =
    (center.x - terminalCenter.x) * escapeDirection.x +
    (center.y - terminalCenter.y) * escapeDirection.y
  const terminalEscape = Math.max(currentTerminalEscape, minimumTerminalEscape)
  const adjustedCenter = {
    x: terminalCenter.x + escapeDirection.x * terminalEscape,
    y: terminalCenter.y + escapeDirection.y * terminalEscape,
  }
  if (!useTwoDimensionalField) {
    const stagger = Math.min(primaryViaPitch / 2, viaDiameter * 0.75)
    return terminalPoints.map((terminalPoint, index) => {
      const terminalLaneOffset =
        (terminalPoint.x - terminalCenter.x) * direction.x +
        (terminalPoint.y - terminalCenter.y) * direction.y
      const laneOffset =
        primaryViaPitch > terminalPitch + 1e-6
          ? (index - middleIndex) * primaryViaPitch
          : terminalLaneOffset
      const staggerOffset = (index % 2 === 0 ? -1 : 1) * (stagger / 2)
      return {
        x:
          adjustedCenter.x +
          direction.x * laneOffset +
          escapeDirection.x * staggerOffset,
        y:
          adjustedCenter.y +
          direction.y * laneOffset +
          escapeDirection.y * staggerOffset,
      }
    })
  }

  const terminalRanks = getPointRanksAlongDirection(terminalPoints, direction)
  const oppositeDirection = getStableTerminalArrayDirection(
    oppositeTerminalPoints,
  )
  const oppositeRanks =
    options.secondaryRanks ??
    getPointRanksAlongDirection(oppositeTerminalPoints, oppositeDirection)
  const secondaryDirection = options.secondaryDirection ?? escapeDirection
  const stagger = Math.min(primaryViaPitch / 2, viaDiameter * 0.75)
  return terminalPoints.map((_, index) => {
    const laneOffset = (terminalRanks[index]! - middleIndex) * primaryViaPitch
    const staggerOffset =
      oppositeRanks.length === terminalPoints.length
        ? (oppositeRanks[index]! - middleIndex) * secondaryViaPitch
        : (index % 2 === 0 ? -1 : 1) * (stagger / 2)
    return {
      x:
        adjustedCenter.x +
        direction.x * laneOffset +
        secondaryDirection.x * staggerOffset,
      y:
        adjustedCenter.y +
        direction.y * laneOffset +
        secondaryDirection.y * staggerOffset,
    }
  })
}

const getTerminalArrayDirection = (terminalPoints: RoutePoint[]) => {
  const first = terminalPoints[0]!
  const last = terminalPoints.at(-1)!
  const dx = last.x - first.x
  const dy = last.y - first.y
  const magnitude = Math.hypot(dx, dy) || 1
  const direction = { x: dx / magnitude, y: dy / magnitude }
  const shouldReverse =
    Math.abs(direction.x) >= Math.abs(direction.y)
      ? direction.x < 0
      : direction.y < 0
  return shouldReverse ? { x: -direction.x, y: -direction.y } : direction
}

const getStableTerminalArrayDirection = (terminalPoints: RoutePoint[]) => {
  let first = terminalPoints[0]!
  let last = terminalPoints.at(-1)!
  let maximumDistance = -1
  for (let firstIndex = 0; firstIndex < terminalPoints.length; firstIndex++) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < terminalPoints.length;
      secondIndex++
    ) {
      const candidateFirst = terminalPoints[firstIndex]!
      const candidateLast = terminalPoints[secondIndex]!
      const candidateDistance = Math.hypot(
        candidateLast.x - candidateFirst.x,
        candidateLast.y - candidateFirst.y,
      )
      if (candidateDistance <= maximumDistance) continue
      maximumDistance = candidateDistance
      first = candidateFirst
      last = candidateLast
    }
  }
  const dx = last.x - first.x
  const dy = last.y - first.y
  const magnitude = Math.hypot(dx, dy) || 1
  const direction = { x: dx / magnitude, y: dy / magnitude }
  const shouldReverse =
    Math.abs(direction.x) >= Math.abs(direction.y)
      ? direction.x < 0
      : direction.y < 0
  return shouldReverse ? { x: -direction.x, y: -direction.y } : direction
}

const getPointRanksAlongDirection = (
  points: RoutePoint[],
  direction: { x: number; y: number },
) => {
  const ranks = Array.from({ length: points.length }, () => 0)
  points
    .map((point, index) => ({
      index,
      projection: point.x * direction.x + point.y * direction.y,
    }))
    .sort((first, second) => first.projection - second.projection)
    .forEach(({ index }, rank) => {
      ranks[index] = rank
    })
  return ranks
}

const getPointCentroid = (points: Array<{ x: number; y: number }>) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
})

const getPerpendicularDirectionToward = (
  axis: { x: number; y: number },
  from: { x: number; y: number },
  toward: { x: number; y: number },
) => {
  const perpendicular = { x: -axis.y, y: axis.x }
  const towardVector = { x: toward.x - from.x, y: toward.y - from.y }
  const sign =
    perpendicular.x * towardVector.x + perpendicular.y * towardVector.y >= 0
      ? 1
      : -1
  return { x: perpendicular.x * sign, y: perpendicular.y * sign }
}

const getLaneSignAtBusStart = (bus: ResolvedBus, coarse: CoarseBusRoute) => {
  if (bus.connections.length < 2) return 1
  const start = coarse.centerline[0]!
  const next = coarse.centerline.find(
    (point) =>
      point.layer === start.layer &&
      (point.x !== start.x || point.y !== start.y),
  )
  if (!next) return 1
  const dx = next.x - start.x
  const dy = next.y - start.y
  const magnitude = Math.hypot(dx, dy) || 1
  const normal = { x: -dy / magnitude, y: dx / magnitude }
  const project = (point: RoutePoint) => point.x * normal.x + point.y * normal.y
  return project(bus.connections.at(-1)!.start) >=
    project(bus.connections[0]!.start)
    ? 1
    : -1
}

const getLegacyOffsetPolyline = (points: RoutePoint[], offset: number) =>
  points.map((point, index) => {
    let previous: RoutePoint | undefined = points[index - 1]
    let next: RoutePoint | undefined = points[index + 1]
    if (previous?.layer !== point.layer) previous = undefined
    if (next?.layer !== point.layer) next = undefined
    const from = previous ?? point
    const to = next ?? point
    const dx = to.x - from.x
    const dy = to.y - from.y
    const magnitude = Math.hypot(dx, dy) || 1
    return {
      x: point.x + (-dy / magnitude) * offset,
      y: point.y + (dx / magnitude) * offset,
      layer: point.layer,
    }
  })

const getLaneGuides = (bus: ResolvedBus, coarse: CoarseBusRoute) => {
  const traceCount = bus.connections.length
  if (!shouldUsePermutationAwareRouting(bus, coarse)) {
    const laneSign = getLaneSignAtBusStart(bus, coarse)
    return bus.connections.map((connection, index) => {
      const offset = coarse.laneCenterOffsets[index]! * laneSign
      const guide = getLegacyOffsetPolyline(coarse.centerline, offset)
      guide[0] = { ...connection.start }
      guide[guide.length - 1] = { ...connection.end }
      return guide
    })
  }
  const layerChangeIndices = coarse.centerline.flatMap((point, index) =>
    index < coarse.centerline.length - 1 &&
    point.layer !== coarse.centerline[index + 1]!.layer
      ? [index]
      : [],
  )
  if (layerChangeIndices.length > 1 && traceCount > 2) {
    const firstLayerChange = layerChangeIndices[0]!
    const lastLayerChange = layerChangeIndices.at(-1)!
    const startPoints = bus.connections.map((connection) => connection.start)
    const endPoints = bus.connections.map((connection) => connection.end)
    const startDirection = getStableTerminalArrayDirection(startPoints)
    const endDirection = getStableTerminalArrayDirection(endPoints)
    const startRanks = getPointRanksAlongDirection(startPoints, startDirection)
    const endRanks = getPointRanksAlongDirection(endPoints, endDirection)
    const startLaneSign = getPolylineNormalSignForAxis(
      coarse.centerline,
      firstLayerChange,
      startDirection,
    )
    const endLaneSign = getPolylineNormalSignForAxis(
      coarse.centerline,
      lastLayerChange + 1,
      endDirection,
    )
    const trunkLaneSign = getLaneSignAtBusStart(bus, coarse)
    return bus.connections.map((connection, connectionIndex) => {
      const startGuide = getOffsetPolyline(
        coarse.centerline,
        coarse.laneCenterOffsets[startRanks[connectionIndex]!]! * startLaneSign,
      )
      const trunkGuide = getOffsetPolyline(
        coarse.centerline,
        coarse.laneCenterOffsets[connectionIndex]! * trunkLaneSign,
      )
      const endGuide = getOffsetPolyline(
        coarse.centerline,
        coarse.laneCenterOffsets[endRanks[connectionIndex]!]! * endLaneSign,
      )
      const guide = coarse.centerline.map((_, pointIndex) => {
        if (pointIndex <= firstLayerChange) return startGuide[pointIndex]!
        if (pointIndex > lastLayerChange) return endGuide[pointIndex]!
        return trunkGuide[pointIndex]!
      })
      guide[0] = { ...connection.start }
      guide[guide.length - 1] = { ...connection.end }
      return guide
    })
  }
  if (layerChangeIndices.length !== 1 || traceCount <= 2) {
    const laneSign = getLaneSignAtBusStart(bus, coarse)
    return bus.connections.map((connection, index) => {
      const offset = coarse.laneCenterOffsets[index]! * laneSign
      const guide = getLegacyOffsetPolyline(coarse.centerline, offset)
      guide[0] = { ...connection.start }
      guide[guide.length - 1] = { ...connection.end }
      return guide
    })
  }

  const layerChangeIndex = layerChangeIndices[0]!
  const layerChangeCenter = coarse.centerline[layerChangeIndex]!
  const startPoints = bus.connections.map((connection) => connection.start)
  const endPoints = bus.connections.map((connection) => connection.end)
  const startDirection = getStableTerminalArrayDirection(startPoints)
  const endDirection = getStableTerminalArrayDirection(endPoints)
  const startRanks = getPointRanksAlongDirection(startPoints, startDirection)
  const endRanks = getPointRanksAlongDirection(endPoints, endDirection)
  const terminalPermutationIsStable = startRanks.every(
    (rank, connectionIndex) => rank === endRanks[connectionIndex],
  )
  // A spatially ranked guide is only needed when a wider bus must actually
  // change lane order at its layer transition. Keeping the legacy offset
  // guide for stable permutations (and the small-bus exhaustive planner)
  // avoids introducing a needless crossbar into otherwise planar fanouts.
  if (terminalPermutationIsStable || traceCount <= 3) {
    const laneSign = getLaneSignAtBusStart(bus, coarse)
    return bus.connections.map((connection, index) => {
      const offset = coarse.laneCenterOffsets[index]! * laneSign
      const guide = getLegacyOffsetPolyline(coarse.centerline, offset)
      guide[0] = { ...connection.start }
      guide[guide.length - 1] = { ...connection.end }
      return guide
    })
  }
  const closerToStart =
    Math.hypot(
      layerChangeCenter.x - getPointCentroid(startPoints).x,
      layerChangeCenter.y - getPointCentroid(startPoints).y,
    ) <=
    Math.hypot(
      layerChangeCenter.x - getPointCentroid(endPoints).x,
      layerChangeCenter.y - getPointCentroid(endPoints).y,
    )
  const startLaneAxis = closerToStart
    ? startDirection
    : getPerpendicularDirectionToward(
        endDirection,
        getPointCentroid(endPoints),
        layerChangeCenter,
      )
  const endLaneAxis = closerToStart
    ? getPerpendicularDirectionToward(
        startDirection,
        getPointCentroid(startPoints),
        layerChangeCenter,
      )
    : endDirection
  const startLaneSign = getPolylineNormalSignForAxis(
    coarse.centerline,
    layerChangeIndex,
    startLaneAxis,
  )
  const endLaneSign = getPolylineNormalSignForAxis(
    coarse.centerline,
    layerChangeIndex + 1,
    endLaneAxis,
  )

  return bus.connections.map((connection, connectionIndex) => {
    const startGuide = getOffsetPolyline(
      coarse.centerline,
      coarse.laneCenterOffsets[startRanks[connectionIndex]!]! * startLaneSign,
    )
    const endGuide = getOffsetPolyline(
      coarse.centerline,
      coarse.laneCenterOffsets[endRanks[connectionIndex]!]! * endLaneSign,
    )
    const guide = coarse.centerline.map((_, pointIndex) =>
      pointIndex <= layerChangeIndex
        ? startGuide[pointIndex]!
        : endGuide[pointIndex]!,
    )
    guide[0] = { ...connection.start }
    guide[guide.length - 1] = { ...connection.end }
    return guide
  })
}

const getDetailedCoarseRoute = (
  bus: ResolvedBus,
  coarse: CoarseBusRoute,
): CoarseBusRoute => {
  if (bus.connections.length <= 2 || coarse.centerline.length < 2) return coarse
  if (countLayerChanges(coarse.centerline) > 1) return coarse
  const centerline = coarse.centerline.map((point) => ({ ...point }))
  const escapeDistance = Math.max(0.6, coarse.corridorWidth)
  const startPoints = bus.connections.map((connection) => connection.start)
  const endPoints = bus.connections.map((connection) => connection.end)
  const startCenter = getPointCentroid(startPoints)
  const endCenter = getPointCentroid(endPoints)
  const startDirection = getPerpendicularDirectionToward(
    getStableTerminalArrayDirection(startPoints),
    startCenter,
    centerline[1]!,
  )
  const endDirection = getPerpendicularDirectionToward(
    getStableTerminalArrayDirection(endPoints),
    endCenter,
    centerline.at(-2)!,
  )
  const endEscapeDistance = Math.min(
    escapeDistance,
    Math.hypot(
      centerline.at(-2)!.x - endCenter.x,
      centerline.at(-2)!.y - endCenter.y,
    ) * 0.8,
  )
  const firstSegmentLength = Math.hypot(
    centerline[1]!.x - startCenter.x,
    centerline[1]!.y - startCenter.y,
  )
  centerline[1] = {
    x: startCenter.x + startDirection.x * firstSegmentLength,
    y: startCenter.y + startDirection.y * firstSegmentLength,
    layer: centerline[1]!.layer,
  }
  centerline.splice(centerline.length - 1, 0, {
    x: endCenter.x + endDirection.x * endEscapeDistance,
    y: endCenter.y + endDirection.y * endEscapeDistance,
    layer: centerline.at(-1)!.layer,
  })
  return { ...coarse, centerline }
}

const getPolylineNormalSignForAxis = (
  points: RoutePoint[],
  pointIndex: number,
  axis: { x: number; y: number },
) => {
  const point = points[pointIndex]!
  const previous = points
    .slice(0, pointIndex)
    .findLast(
      (candidate) =>
        candidate.layer === point.layer &&
        (candidate.x !== point.x || candidate.y !== point.y),
    )
  const next = points
    .slice(pointIndex + 1)
    .find(
      (candidate) =>
        candidate.layer === point.layer &&
        (candidate.x !== point.x || candidate.y !== point.y),
    )
  const from = previous ?? point
  const to = next ?? point
  const dx = to.x - from.x
  const dy = to.y - from.y
  const magnitude = Math.hypot(dx, dy) || 1
  const normal = { x: -dy / magnitude, y: dx / magnitude }
  return normal.x * axis.x + normal.y * axis.y >= 0 ? 1 : -1
}

const getConnectionIds = (connection: ResolvedBus["connections"][number]) =>
  new Set(
    [
      connection.name,
      connection.start.pointId,
      connection.end.pointId,
      connection.start.pcbPortId,
      connection.end.pcbPortId,
    ].filter((id): id is string => Boolean(id)),
  )

const getBusConnectionIds = (bus: ResolvedBus) => {
  const ids = new Set<string>()
  for (const connection of bus.connections) {
    for (const id of getConnectionIds(connection)) ids.add(id)
  }
  return ids
}

const splitGuideByLayerChanges = (guide: RoutePoint[]) => {
  const segments: Array<{
    layer: string
    toLayer?: string
    points: RoutePoint[]
  }> = []
  let segmentStart = 0
  for (let index = 0; index < guide.length - 1; index++) {
    if (guide[index]!.layer === guide[index + 1]!.layer) continue
    segments.push({
      layer: guide[index]!.layer,
      toLayer: guide[index + 1]!.layer,
      points: guide.slice(segmentStart, index + 1),
    })
    segmentStart = index + 1
  }
  segments.push({
    layer: guide[segmentStart]!.layer,
    points: guide.slice(segmentStart),
  })
  return segments
}

const getSearchBounds = (
  points: RoutePoint[],
  boardBounds: BusTracerSimpleRouteJson["bounds"],
  margin: number,
) => ({
  minX: Math.max(
    boardBounds.minX,
    Math.min(...points.map((point) => point.x)) - margin,
  ),
  maxX: Math.min(
    boardBounds.maxX,
    Math.max(...points.map((point) => point.x)) + margin,
  ),
  minY: Math.max(
    boardBounds.minY,
    Math.min(...points.map((point) => point.y)) - margin,
  ),
  maxY: Math.min(
    boardBounds.maxY,
    Math.max(...points.map((point) => point.y)) + margin,
  ),
})

const isDirectPathClear = (
  start: RoutePoint,
  end: RoutePoint,
  sampleSpacing: number,
  isBlocked: (point: { x: number; y: number }, layer: string) => boolean,
) => {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const sampleCount = Math.max(2, Math.ceil(distance / sampleSpacing))
  for (let sample = 1; sample < sampleCount; sample++) {
    const progress = sample / sampleCount
    if (
      isBlocked(
        {
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        },
        start.layer,
      )
    ) {
      return false
    }
  }
  return true
}

const isPolylineClear = (
  points: RoutePoint[],
  sampleSpacing: number,
  isBlocked: (point: { x: number; y: number }, layer: string) => boolean,
) =>
  points
    .slice(0, -1)
    .every((point, index) =>
      isDirectPathClear(point, points[index + 1]!, sampleSpacing, isBlocked),
    )

const getFanoutGuardPath = (
  bus: ResolvedBus,
  connection: ResolvedBus["connections"][number],
  segmentStart: RoutePoint,
  segmentEnd: RoutePoint,
  guardDistance: number,
): RoutePoint[] | undefined => {
  const atStartTerminal =
    segmentStart.layer === connection.start.layer &&
    segmentStart.x === connection.start.x &&
    segmentStart.y === connection.start.y
  const atEndTerminal =
    segmentEnd.layer === connection.end.layer &&
    segmentEnd.x === connection.end.x &&
    segmentEnd.y === connection.end.y
  if (!atStartTerminal && !atEndTerminal) return undefined

  const terminalPoints = bus.connections.map((candidate) =>
    atStartTerminal ? candidate.start : candidate.end,
  )
  const terminal = atStartTerminal ? connection.start : connection.end
  const toward = atStartTerminal ? segmentEnd : segmentStart
  const nearestTerminalDistance = Math.min(
    ...terminalPoints
      .filter((candidate) => candidate !== terminal)
      .map((candidate) =>
        Math.hypot(candidate.x - terminal.x, candidate.y - terminal.y),
      ),
  )
  const effectiveGuardDistance =
    !atStartTerminal && nearestTerminalDistance < guardDistance
      ? 0
      : guardDistance
  const terminalDirection = getStableTerminalArrayDirection(terminalPoints)
  const terminalProjection =
    terminal.x * terminalDirection.x + terminal.y * terminalDirection.y
  const movementProjection =
    (toward.x - terminal.x) * terminalDirection.x +
    (toward.y - terminal.y) * terminalDirection.y
  const denseTurnDelay =
    atStartTerminal && nearestTerminalDistance < guardDistance
      ? terminalPoints.filter((candidate) => {
          if (candidate === terminal) return false
          if (
            Math.hypot(candidate.x - terminal.x, candidate.y - terminal.y) >=
            guardDistance
          ) {
            return false
          }
          const candidateProjection =
            candidate.x * terminalDirection.x +
            candidate.y * terminalDirection.y
          return movementProjection >= 0
            ? candidateProjection > terminalProjection
            : candidateProjection < terminalProjection
        }).length * 0.12
      : 0
  const escapeDirection = getPerpendicularDirectionToward(
    terminalDirection,
    getPointCentroid(terminalPoints),
    toward,
  )
  const guard = {
    x:
      terminal.x +
      escapeDirection.x * (effectiveGuardDistance + denseTurnDelay),
    y:
      terminal.y +
      escapeDirection.y * (effectiveGuardDistance + denseTurnDelay),
    layer: terminal.layer,
  }
  return [segmentStart, guard, segmentEnd]
}

const getUnitDirection = (
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const magnitude = Math.hypot(dx, dy) || 1
  return { x: dx / magnitude, y: dy / magnitude }
}

const areLegacyTerminalArraysPerpendicular = (bus: ResolvedBus) => {
  if (bus.connections.length <= 2) return false
  const startDirection = getUnitDirection(
    bus.connections[0]!.start,
    bus.connections.at(-1)!.start,
  )
  const endDirection = getUnitDirection(
    bus.connections[0]!.end,
    bus.connections.at(-1)!.end,
  )
  return (
    Math.abs(
      startDirection.x * endDirection.x + startDirection.y * endDirection.y,
    ) < 0.5
  )
}

const areTerminalArraysPerpendicular = (bus: ResolvedBus) => {
  if (bus.connections.length <= 2) return false
  const startDirection = getStableTerminalArrayDirection(
    bus.connections.map((connection) => connection.start),
  )
  const endDirection = getStableTerminalArrayDirection(
    bus.connections.map((connection) => connection.end),
  )
  return (
    Math.abs(
      startDirection.x * endDirection.x + startDirection.y * endDirection.y,
    ) < 0.5
  )
}

const shouldUsePermutationAwareRouting = (
  bus: ResolvedBus,
  coarse: CoarseBusRoute,
) => {
  if (
    bus.connections.length <= 3 ||
    bus.connections.length > MAX_PERMUTATION_AWARE_TRACE_COUNT
  ) {
    return false
  }
  const layerChangeCount = countLayerChanges(coarse.centerline)
  if (layerChangeCount > 1) return true
  if (layerChangeCount !== 1) return false

  const startPoints = bus.connections.map((connection) => connection.start)
  const endPoints = bus.connections.map((connection) => connection.end)
  const startRanks = getPointRanksAlongDirection(
    startPoints,
    getStableTerminalArrayDirection(startPoints),
  )
  const endRanks = getPointRanksAlongDirection(
    endPoints,
    getStableTerminalArrayDirection(endPoints),
  )
  return startRanks.some(
    (rank, connectionIndex) => rank !== endRanks[connectionIndex],
  )
}

const getConnectionOrderCandidates = (
  bus: ResolvedBus,
  coarse: CoarseBusRoute,
) => {
  const naturalOrder = bus.connections.map((_, index) => index)
  const startTerminalOrder = getTerminalAxisOrder(
    bus.connections.map((connection) => connection.start),
  )
  const endTerminalOrder = getTerminalAxisOrder(
    bus.connections.map((connection) => connection.end),
  )
  const terminalArraysArePerpendicular = shouldUsePermutationAwareRouting(
    bus,
    coarse,
  )
    ? areTerminalArraysPerpendicular(bus)
    : areLegacyTerminalArraysPerpendicular(bus)
  const legacyPreferredOrder = terminalArraysArePerpendicular
    ? [...naturalOrder].reverse()
    : naturalOrder
  const preferredOrder = terminalArraysArePerpendicular
    ? endTerminalOrder
    : naturalOrder
  if (
    bus.connections.length > 4 &&
    countLayerChanges(coarse.centerline) === 1
  ) {
    return [preferredOrder]
  }

  const candidates: number[][] = []
  const seen = new Set<string>()
  const addCandidate = (candidate: number[]) => {
    const key = candidate.join(":")
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(candidate)
  }
  addCandidate(legacyPreferredOrder)
  addCandidate([...legacyPreferredOrder].reverse())
  addCandidate(preferredOrder)
  addCandidate([...preferredOrder].reverse())
  addCandidate(startTerminalOrder)
  addCandidate([...startTerminalOrder].reverse())
  addCandidate(endTerminalOrder)
  addCandidate([...endTerminalOrder].reverse())

  if (bus.connections.length > 3) return candidates

  const addPermutations = (prefix: number[], remaining: number[]) => {
    if (remaining.length === 0) {
      addCandidate(prefix)
      return
    }
    for (let index = 0; index < remaining.length; index++) {
      addPermutations(
        [...prefix, remaining[index]!],
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
      )
    }
  }
  addPermutations([], naturalOrder)
  return candidates
}

const getTerminalAxisOrder = (points: RoutePoint[]) => {
  const xRange =
    Math.max(...points.map((point) => point.x)) -
    Math.min(...points.map((point) => point.x))
  const yRange =
    Math.max(...points.map((point) => point.y)) -
    Math.min(...points.map((point) => point.y))
  const coordinate = xRange >= yRange ? "x" : "y"
  return points
    .map((point, index) => ({ coordinate: point[coordinate], index }))
    .sort((first, second) => first.coordinate - second.coordinate)
    .map(({ index }) => index)
}

const countLayerChanges = (points: RoutePoint[]) =>
  points
    .slice(0, -1)
    .reduce(
      (count, point, index) =>
        count + (point.layer === points[index + 1]!.layer ? 0 : 1),
      0,
    )

const viaSpansLayer = (
  fromLayer: string,
  toLayer: string,
  layer: string,
  srj: BusTracerSimpleRouteJson,
) => {
  const layers = getLayerNames(srj.layerCount)
  const fromIndex = layers.indexOf(fromLayer)
  const toIndex = layers.indexOf(toLayer)
  const layerIndex = layers.indexOf(layer)
  return (
    layerIndex >= Math.min(fromIndex, toIndex) &&
    layerIndex <= Math.max(fromIndex, toIndex)
  )
}

const getSharedGuardDistances = (
  bus: ResolvedBus,
  coarse: CoarseBusRoute,
  laneGuides: RoutePoint[][],
): SharedGuardDistances => {
  const layerChangeIndices = coarse.centerline.flatMap((point, index) =>
    index < coarse.centerline.length - 1 &&
    point.layer !== coarse.centerline[index + 1]!.layer
      ? [index]
      : [],
  )
  const firstChange = layerChangeIndices[0]
  const lastChange = layerChangeIndices.at(-1)
  if (firstChange === undefined || lastChange === undefined) {
    throw new Error(`Dense bus "${bus.bus.busId}" needs trunk layer changes`)
  }
  const guardClearance = 0.3
  return {
    start:
      Math.max(
        ...bus.connections.map((connection, index) =>
          Math.hypot(
            laneGuides[index]![firstChange]!.x - connection.start.x,
            laneGuides[index]![firstChange]!.y - connection.start.y,
          ),
        ),
      ) + guardClearance,
    end:
      Math.max(
        ...bus.connections.map((connection, index) =>
          Math.hypot(
            laneGuides[index]![lastChange]!.x - connection.end.x,
            laneGuides[index]![lastChange]!.y - connection.end.y,
          ),
        ),
      ) + guardClearance,
  }
}
