import { distance } from "./geometry"
import type {
  BusTracerSimpleRouteJson,
  ResolvedBus,
  ResolvedConnection,
  RoutePoint,
  SimpleRouteBus,
} from "./types"

type InputPoint =
  BusTracerSimpleRouteJson["connections"][number]["pointsToConnect"][number]

const toRoutePoint = (
  point: InputPoint,
): RoutePoint & { pcbPortId?: string; pointId?: string } => {
  const layer = "layer" in point ? point.layer : point.layers[0]
  if (!layer)
    throw new Error(`Connection point at (${point.x}, ${point.y}) has no layer`)
  return {
    x: point.x,
    y: point.y,
    layer,
    pcbPortId: point.pcb_port_id,
    pointId: point.pointId,
  }
}

const alignConnectionEndpoints = (
  connection: BusTracerSimpleRouteJson["connections"][number],
  referenceStart?: RoutePoint,
  referenceEnd?: RoutePoint,
): ResolvedConnection => {
  if (connection.pointsToConnect.length !== 2) {
    throw new Error(
      `Bus connection "${connection.name}" must have exactly two pointsToConnect; got ${connection.pointsToConnect.length}`,
    )
  }
  const first = toRoutePoint(connection.pointsToConnect[0]!)
  const second = toRoutePoint(connection.pointsToConnect[1]!)
  const shouldFlip =
    referenceStart && referenceEnd
      ? distance(first, referenceStart) + distance(second, referenceEnd) >
        distance(second, referenceStart) + distance(first, referenceEnd)
      : false

  return {
    name: connection.name,
    start: shouldFlip ? second : first,
    end: shouldFlip ? first : second,
    nominalTraceWidth: connection.nominalTraceWidth,
  }
}

const getImplicitBus = (srj: BusTracerSimpleRouteJson): SimpleRouteBus => ({
  busId: "implicit_bus_0",
  name: "Implicit bus",
  connectionNames: srj.connections.map((connection) => connection.name),
})

export const resolveBuses = (srj: BusTracerSimpleRouteJson): ResolvedBus[] => {
  if (srj.connections.length === 0)
    throw new Error("SimpleRouteJson has no connections")
  const buses = srj.buses?.length ? srj.buses : [getImplicitBus(srj)]
  const connectionByName = new Map(
    srj.connections.map((connection) => [connection.name, connection]),
  )
  const claimedConnections = new Set<string>()

  return buses.map((bus) => {
    if (bus.connectionNames.length === 0) {
      throw new Error(`Bus "${bus.busId}" has no connectionNames`)
    }
    const connections: ResolvedConnection[] = []
    let referenceStart: RoutePoint | undefined
    let referenceEnd: RoutePoint | undefined

    for (const connectionName of bus.connectionNames) {
      if (claimedConnections.has(connectionName)) {
        throw new Error(
          `Connection "${connectionName}" belongs to more than one bus`,
        )
      }
      const connection = connectionByName.get(connectionName)
      if (!connection) {
        throw new Error(
          `Bus "${bus.busId}" references unknown connection "${connectionName}"`,
        )
      }
      const resolved = alignConnectionEndpoints(
        connection,
        referenceStart,
        referenceEnd,
      )
      connections.push(resolved)
      claimedConnections.add(connectionName)

      const count = connections.length
      referenceStart = {
        x: connections.reduce((sum, item) => sum + item.start.x, 0) / count,
        y: connections.reduce((sum, item) => sum + item.start.y, 0) / count,
        layer: connections[0]!.start.layer,
      }
      referenceEnd = {
        x: connections.reduce((sum, item) => sum + item.end.x, 0) / count,
        y: connections.reduce((sum, item) => sum + item.end.y, 0) / count,
        layer: connections[0]!.end.layer,
      }
    }

    return { bus, connections }
  })
}

export const getBusCentroids = (bus: ResolvedBus) => ({
  start: {
    x:
      bus.connections.reduce((sum, connection) => sum + connection.start.x, 0) /
      bus.connections.length,
    y:
      bus.connections.reduce((sum, connection) => sum + connection.start.y, 0) /
      bus.connections.length,
    layer: bus.connections[0]!.start.layer,
  },
  end: {
    x:
      bus.connections.reduce((sum, connection) => sum + connection.end.x, 0) /
      bus.connections.length,
    y:
      bus.connections.reduce((sum, connection) => sum + connection.end.y, 0) /
      bus.connections.length,
    layer: bus.connections[0]!.end.layer,
  },
})
