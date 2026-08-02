import type {
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
  termination?: SimpleRouteBusTermination
}

export type BusTracerSimpleRouteJson = Omit<
  CapacitySimpleRouteJson,
  "buses"
> & {
  buses?: SimpleRouteBus[]
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
