import type { BusTracerSimpleRouteJson } from "lib/types"

const connectionNames = ["DQ0", "DQS_P", "DQS_N", "DQ1"] as const
const laneY = [-0.72, -0.18, 0.18, 0.72]

export const ddrRoutingConstraintsSrj: BusTracerSimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.1,
  nominalTraceWidth: 0.15,
  minViaHoleDiameter: 0.2,
  minViaPadDiameter: 0.45,
  defaultObstacleMargin: 0.1,
  bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 },
  obstacles: connectionNames.flatMap((connectionName, index) =>
    [-8, 8].map((x, side) => ({
      obstacleId: `${connectionName}_${side === 0 ? "source" : "sink"}`,
      type: "rect" as const,
      layers: ["top"],
      center: { x, y: laneY[index]! },
      width: 0.6,
      height: 0.36,
      connectedTo: [connectionName],
    })),
  ),
  connections: connectionNames.map((name, index) => ({
    name,
    pointsToConnect: [
      {
        x: -8,
        y: laneY[index]!,
        layer: "top",
        pointId: `${name}_source`,
      },
      {
        x: 8,
        y: laneY[index]!,
        layer: "top",
        pointId: `${name}_sink`,
      },
    ],
  })),
  buses: [
    {
      busId: "DDR_BYTE_LANE_0",
      name: "DDR byte lane 0",
      connectionNames: [...connectionNames],
      maxLengthSkew: 0.25,
      traceWidth: 0.24,
      allowedLayers: ["top"],
    },
  ],
  differentialPairs: [
    {
      connectionNames: ["DQS_P", "DQS_N"],
      lengthTolerance: 0.1,
      traceGap: 0.12,
    },
  ],
}
