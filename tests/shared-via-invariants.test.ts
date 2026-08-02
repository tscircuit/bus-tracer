import { expect, test } from "bun:test"
import { BusTracer } from "lib/bus-tracer"
import type { BusTracerSimpleRouteJson } from "lib/types"

const barrierProblem: BusTracerSimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaPadDiameter: 0.5,
  minViaHoleDiameter: 0.25,
  defaultObstacleMargin: 0.1,
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  obstacles: [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 10,
      layers: ["top"],
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "data_0",
      pointsToConnect: [
        { x: -4, y: -0.4, layer: "top" },
        { x: 4, y: -0.4, layer: "top" },
      ],
    },
    {
      name: "data_1",
      pointsToConnect: [
        { x: -4, y: 0.4, layer: "top" },
        { x: 4, y: 0.4, layer: "top" },
      ],
    },
  ],
  buses: [{ busId: "data", connectionNames: ["data_0", "data_1"] }],
}

test("all traces inherit the coarse route's shared layer transitions", () => {
  const solver = new BusTracer(barrierProblem)
  solver.solve()
  expect(solver.solved).toBeTrue()

  const traces = solver.getOutput().traces
  const viasByTrace = traces.map((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )
  expect(viasByTrace.map((vias) => vias.length)).toEqual([2, 2])

  for (let viaIndex = 0; viaIndex < 2; viaIndex++) {
    const first = viasByTrace[0]![viaIndex]!
    const second = viasByTrace[1]![viaIndex]!
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeLessThan(1)
    expect(first.from_layer).toBe(second.from_layer)
    expect(first.to_layer).toBe(second.to_layer)
  }
})
