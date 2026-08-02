import { expect } from "bun:test"
import { BusTracer } from "lib/bus-tracer"
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
  expect(countSameLayerCrossings(output.traces)).toBe(0)
  return solver
}

const countSameLayerCrossings = (
  traces: ReturnType<BusTracer["getOutput"]>["traces"],
) => {
  const segments = traces.flatMap((trace) =>
    trace.route.slice(0, -1).flatMap((first, index) => {
      const second = trace.route[index + 1]!
      if (
        first.route_type !== "wire" ||
        second.route_type !== "wire" ||
        first.layer !== second.layer
      ) {
        return []
      }
      return [{ first, second, connectionName: trace.connection_name }]
    }),
  )

  let crossings = 0
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex++) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < segments.length;
      secondIndex++
    ) {
      const first = segments[firstIndex]!
      const second = segments[secondIndex]!
      if (
        first.connectionName === second.connectionName ||
        first.first.layer !== second.first.layer
      ) {
        continue
      }
      if (
        segmentsStrictlyIntersect(
          first.first,
          first.second,
          second.first,
          second.second,
        )
      ) {
        crossings++
      }
    }
  }
  return crossings
}

const segmentsStrictlyIntersect = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) => {
  const orientation = (
    first: { x: number; y: number },
    second: { x: number; y: number },
    third: { x: number; y: number },
  ) =>
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  const epsilon = 1e-8
  return (
    orientation(a, b, c) * orientation(a, b, d) < -epsilon &&
    orientation(c, d, a) * orientation(c, d, b) < -epsilon
  )
}
