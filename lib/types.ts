import type {
  DifferentialPair as CapacityDifferentialPair,
  SimpleRouteJson as CapacitySimpleRouteJson,
  SimplifiedPcbTrace,
} from "@tscircuit/capacity-autorouter"

export type SimpleRouteBusTermination =
  | { type: "boundary" }
  | { type: "plane"; layer: string }

export type SimpleRouteBus = {
  busId: string
  name?: string
  connectionNames: string[]
  maxLengthSkew?: number
  /** Resolved copper width in millimeters for members without an override. */
  traceWidth?: number
  /** Layers on which this bus may be routed, including its terminal layers. */
  allowedLayers?: string[]
  termination?: SimpleRouteBusTermination
}

export type BusTracerDifferentialPair = CapacityDifferentialPair & {
  /** Resolved edge-to-edge copper gap in millimeters. */
  traceGap?: number
}

export type BusTracerSimpleRouteJson = Omit<
  CapacitySimpleRouteJson,
  "buses" | "differentialPairs"
> & {
  buses?: SimpleRouteBus[]
  differentialPairs?: BusTracerDifferentialPair[]
}

export type RoutePoint = {
  x: number
  y: number
  layer: string
}

export type CoarseBusRoute = {
  busId: string
  connectionNames: string[]
  centerline: RoutePoint[]
  /** Centerline offset for each connection, in bus order. */
  laneCenterOffsets: number[]
  tracePitch: number
  corridorWidth: number
}

export type CoarsePathfindingOutput = {
  buses: CoarseBusRoute[]
}

export type DetailedRoutingOutput = {
  traces: SimplifiedPcbTrace[]
  simpleRouteJson: BusTracerSimpleRouteJson
}

export type BusTracerOutput = DetailedRoutingOutput & {
  coarseRoutes: CoarseBusRoute[]
}

export type BusTracerOptions = {
  coarseGridCellSize?: number
  detailGridCellSize?: number
  traceClearance?: number
  obstacleMargin?: number
  coarseIgnoreObstacleShortSideBelow?: number
  coarseViaPenalty?: number
  fineGuidePenalty?: number
  fineSearchMargin?: number
}

export type ResolvedConnection = {
  name: string
  start: RoutePoint & { pcbPortId?: string; pointId?: string }
  end: RoutePoint & { pcbPortId?: string; pointId?: string }
  nominalTraceWidth?: number
}

export type ResolvedBus = {
  bus: SimpleRouteBus
  connections: ResolvedConnection[]
}

export type { SimplifiedPcbTrace }
