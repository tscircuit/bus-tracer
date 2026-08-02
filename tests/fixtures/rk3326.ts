import type { BusTracerInput } from "lib/bus-tracer"
import type { BusTracerSimpleRouteJson } from "lib/types"

type FanoutConnection = {
  start: { x: number; y: number }
  startLayer: string
  end: { x: number; y: number }
  endLayer: string
}

// These endpoints come from the RK3326 global autorouting phase after the
// RK3326, eMMC, USB, and DSI local fanout phases have completed.
const traceWidth = 0.09
const traceClearance = 0.075
const terminalSize = 0.15
const layers = ["top", "inner1", "inner2", "inner3", "inner4", "bottom"]

const componentKeepouts: BusTracerSimpleRouteJson["obstacles"] = [
  {
    type: "rect",
    obstacleId: "U1",
    center: { x: 0, y: 0 },
    width: 14.8,
    height: 14.8,
    layers,
    connectedTo: [],
  },
  {
    type: "rect",
    obstacleId: "U2",
    center: { x: 17, y: -4 },
    width: 8,
    height: 8,
    layers,
    connectedTo: [],
  },
  {
    type: "rect",
    obstacleId: "J1",
    center: { x: 0, y: -20 },
    width: 5,
    height: 5,
    layers,
    connectedTo: [],
  },
  {
    type: "rect",
    obstacleId: "J2",
    center: { x: 0, y: 15.5 },
    width: 14.5,
    height: 4.5,
    layers,
    connectedTo: [],
  },
]

const createRk3326BusInput = (
  busId: string,
  firstSourceTraceIndex: number,
  endpoints: FanoutConnection[],
): BusTracerInput => {
  const connectionNames = endpoints.map(
    (_, index) => `source_trace_${firstSourceTraceIndex + index}`,
  )
  const connections = endpoints.map((endpoint, index) => {
    const name = connectionNames[index]!
    return {
      name,
      pointsToConnect: [
        {
          ...endpoint.start,
          layer: endpoint.startLayer,
          pointId: `${name}-start`,
        },
        {
          ...endpoint.end,
          layer: endpoint.endLayer,
          pointId: `${name}-end`,
        },
      ],
      nominalTraceWidth: traceWidth,
    }
  })
  const terminalObstacles = connections.flatMap((connection) =>
    connection.pointsToConnect.map((point) => ({
      type: "rect" as const,
      center: { x: point.x, y: point.y },
      width: terminalSize,
      height: terminalSize,
      layers: [point.layer],
      connectedTo: [connection.name, point.pointId],
    })),
  )

  return {
    simpleRouteJson: {
      bounds: { minX: -28, maxX: 28, minY: -25, maxY: 25 },
      obstacles: [...componentKeepouts, ...terminalObstacles],
      connections,
      buses: [{ busId, name: busId, connectionNames }],
      layerCount: layers.length,
      minTraceWidth: traceWidth,
      nominalTraceWidth: traceWidth,
      minViaDiameter: 0.25,
      minViaHoleDiameter: 0.1,
      minViaPadDiameter: 0.25,
      min_via_hole_diameter: 0.1,
      min_via_pad_diameter: 0.25,
    },
    options: {
      traceClearance,
      obstacleMargin: traceClearance,
    },
  }
}

export const rk3326_01 = createRk3326BusInput("emmc-data", 205, [
  {
    start: { x: 7.65, y: -0.5775 },
    startLayer: "inner3",
    end: { x: 15.000004, y: 2 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: 4.225 },
    startLayer: "inner3",
    end: { x: 15.500003, y: 2 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: 5.525 },
    startLayer: "inner3",
    end: { x: 17.2475, y: 2 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: -0.975 },
    startLayer: "inner3",
    end: { x: 14.749941, y: 2 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: 3.575 },
    startLayer: "inner3",
    end: { x: 15.250067, y: 2 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: 5.2 },
    startLayer: "inner3",
    end: { x: 15.749939, y: 2 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: 5.85 },
    startLayer: "inner3",
    end: { x: 17.4125, y: 2 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: 6.175 },
    startLayer: "inner3",
    end: { x: 17.5775, y: 2 },
    endLayer: "inner2",
  },
])

export const rk3326_02 = createRk3326BusInput("emmc-control", 213, [
  {
    start: { x: 7.65, y: -0.165 },
    startLayer: "bottom",
    end: { x: 16.749937, y: -10 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: 0 },
    startLayer: "bottom",
    end: { x: 16.500001, y: -10 },
    endLayer: "inner2",
  },
  {
    start: { x: 7.65, y: 3.25 },
    startLayer: "bottom",
    end: { x: 17, y: -10 },
    endLayer: "inner2",
  },
])

export const rk3326_03 = createRk3326BusInput("usb-otg", 216, [
  {
    start: { x: 7.65, y: -1.625 },
    startLayer: "inner3",
    end: { x: 0.2475, y: -16.9249851 },
    endLayer: "top",
  },
  {
    start: { x: 7.65, y: -5.85 },
    startLayer: "inner3",
    end: { x: -0.0825, y: -16.9249851 },
    endLayer: "top",
  },
  {
    start: { x: 7.65, y: -1.3 },
    startLayer: "inner3",
    end: { x: 0.0825, y: -16.9249851 },
    endLayer: "top",
  },
  {
    start: { x: 7.65, y: -1.95 },
    startLayer: "inner3",
    end: { x: -0.2475, y: -16.9249851 },
    endLayer: "top",
  },
])

export const rk3326_04 = createRk3326BusInput("mipi-dsi", 220, [
  {
    start: { x: 3.9, y: 7.65 },
    startLayer: "inner3",
    end: { x: -3.749929, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: 4.225, y: 7.65 },
    startLayer: "inner3",
    end: { x: -3.250057, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: 2.925, y: 7.65 },
    startLayer: "inner3",
    end: { x: -2.250059, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: 3.25, y: 7.65 },
    startLayer: "inner3",
    end: { x: -1.749933, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: 1.95, y: 7.65 },
    startLayer: "inner3",
    end: { x: -0.749935, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: 1.3, y: 7.65 },
    startLayer: "inner3",
    end: { x: 0.0825, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: -0.7425, y: 7.65 },
    startLayer: "inner3",
    end: { x: 0.2475, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: -0.5775, y: 7.65 },
    startLayer: "inner3",
    end: { x: 0.4125, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: 2.6, y: 7.65 },
    startLayer: "inner3",
    end: { x: 1.249807, y: 12.45008665 },
    endLayer: "top",
  },
  {
    start: { x: 2.275, y: 7.65 },
    startLayer: "inner3",
    end: { x: 1.749933, y: 12.45008665 },
    endLayer: "top",
  },
])
