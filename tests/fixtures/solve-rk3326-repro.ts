import { expect } from "bun:test"
import { BusTracer, type BusTracerInput } from "lib/bus-tracer"
import { countSameLayerTraceCrossings } from "lib/geometry"
import { visualizeBusTracer } from "lib/visualize"

export const solveRk3326Repro = (input: BusTracerInput) => {
  const solver = new BusTracer(input)
  let error: Error | undefined
  try {
    solver.solve()
  } catch (caughtError) {
    error =
      caughtError instanceof Error
        ? caughtError
        : new Error(String(caughtError))
  }
  return { solver, error }
}

export const expectRk3326ReproToRoute = (
  input: BusTracerInput,
  expectedTraceCount: number,
) => {
  const result = solveRk3326Repro(input)
  expect(result.error).toBeUndefined()
  expect(result.solver.solved).toBeTrue()
  const traces = result.solver.getOutput().traces
  expect(traces).toHaveLength(expectedTraceCount)
  expect(
    traces.map(
      (trace) =>
        trace.route.filter((point) => point.route_type === "via").length,
    ),
  ).toEqual(Array(expectedTraceCount).fill(3))
  expect(countSameLayerTraceCrossings(traces)).toBe(0)
  return result
}

export const visualizeRk3326Repro = (
  input: BusTracerInput,
  result: ReturnType<typeof solveRk3326Repro>,
) => {
  const { solver, error } = result
  const output = solver.getOutput()
  const graphics = visualizeBusTracer({
    simpleRouteJson: input.simpleRouteJson,
    coarseRoutes: output.coarseRoutes,
    traces: output.traces,
  })
  if (error || solver.failed) {
    graphics.texts?.push({
      x: input.simpleRouteJson.bounds.minX + 1,
      y: input.simpleRouteJson.bounds.maxY - 1,
      text: error?.message ?? solver.error ?? "Bus routing failed",
      color: "red",
      fontSize: 0.8,
    })
  }
  return graphics
}
