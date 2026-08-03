import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { BusTracer } from "lib/bus-tracer"
import type { BusTracerSimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("matches total DDR bus and differential-pair lengths after fanout", async () => {
  const connectionNames = ["DQS_P", "DQS_N", "DQ0"]
  const terminalY = [-0.45, 0, 0.25]
  const createFixedTrace = (
    pcbTraceId: string,
    connectionName: string,
    startX: number,
    endX: number,
    y: number,
  ): SimplifiedPcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: pcbTraceId,
    connection_name: connectionName,
    route: [
      { route_type: "wire", x: startX, y, width: 0.15, layer: "top" },
      { route_type: "wire", x: endX, y, width: 0.15, layer: "top" },
    ],
  })
  const simpleRouteJson: BusTracerSimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    nominalTraceWidth: 0.15,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.45,
    defaultObstacleMargin: 0.1,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [],
    connections: connectionNames.map((name, index) => ({
      name,
      pointsToConnect: [
        { x: -4, y: terminalY[index]!, layer: "top" },
        { x: 4, y: terminalY[index]!, layer: "top" },
      ],
    })),
    traces: [
      createFixedTrace("fixed_dqs_p", "DQS_P", -8, -4, -0.45),
      createFixedTrace("fixed_dqs_n", "DQS_N", -8, -4, 0),
    ],
    buses: [
      {
        busId: "DDR_BYTE_LANE_0",
        connectionNames,
        maxLengthSkew: 0.1,
        traceWidth: 0.15,
        allowedLayers: ["top"],
      },
    ],
    differentialPairs: [
      {
        connectionNames: ["DQS_P", "DQS_N"],
        lengthTolerance: 0.05,
        traceGap: 0.3,
      },
    ],
  }
  const solver = new BusTracer(simpleRouteJson)

  solver.solve()

  const output = solver.getOutput()
  const fixedLengths = { DQ0: 0, DQS_P: 4, DQS_N: 4 }
  const totalLengths = Object.fromEntries(
    output.traces.map((trace) => {
      const routedLength = trace.route.reduce((total, entry, index, route) => {
        const next = route[index + 1]
        if (
          entry.route_type !== "wire" ||
          next?.route_type !== "wire" ||
          entry.layer !== next.layer
        )
          return total
        return total + Math.hypot(next.x - entry.x, next.y - entry.y)
      }, 0)
      return [
        trace.connection_name,
        routedLength +
          fixedLengths[trace.connection_name as keyof typeof fixedLengths],
      ]
    }),
  )
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    Math.max(...Object.values(totalLengths)) -
      Math.min(...Object.values(totalLengths)),
  ).toBeLessThanOrEqual(0.100001)
  expect(
    Math.abs(totalLengths.DQS_P! - totalLengths.DQS_N!),
  ).toBeLessThanOrEqual(0.050001)
  const laneOffsets = output.coarseRoutes[0]!.laneCenterOffsets
  expect(laneOffsets[1]! - laneOffsets[0]!).toBeCloseTo(0.45)
  const dqsP = output.traces.find((trace) => trace.connection_name === "DQS_P")!
  const dqsN = output.traces.find((trace) => trace.connection_name === "DQS_N")!
  const dqsPStart = dqsP.route[0]
  const dqsNStart = dqsN.route[0]
  if (dqsPStart?.route_type !== "wire" || dqsNStart?.route_type !== "wire")
    throw new Error("Expected DQS routes to start with wire geometry")
  expect(Math.abs(dqsPStart.y - dqsNStart.y)).toBeCloseTo(0.45)
  expect(
    output.traces.find((trace) => trace.connection_name === "DQ0")!.route
      .length,
  ).toBeGreaterThan(2)
  expect(dqsP.route.length).toBe(2)
  expect(dqsN.route.length).toBe(2)
  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
