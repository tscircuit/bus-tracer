import { BusTracer, type BusTracerInput } from "lib/bus-tracer"
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
