import { expect } from "bun:test"
import { BusTracer } from "lib/bus-tracer"
import { countSameLayerTraceCrossings } from "lib/geometry"
import type { BusTracerSimpleRouteJson } from "lib/types"

export const solveSample = (sample: unknown) => {
  const solver = new BusTracer(sample as BusTracerSimpleRouteJson)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const output = solver.getOutput()
  expect(output.traces.length).toBeGreaterThan(0)
  for (const coarseBus of output.coarseRoutes) {
    const traces = output.traces.filter((trace) =>
      coarseBus.connectionNames.includes(trace.connection_name),
    )
    expect(traces).toHaveLength(coarseBus.connectionNames.length)
    const viaCounts = new Set(
      traces.map(
        (trace) =>
          trace.route.filter((point) => point.route_type === "via").length,
      ),
    )
    expect(viaCounts.size).toBe(1)
  }
  expect(countSameLayerTraceCrossings(output.traces)).toBe(0)
  return solver
}
