import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BusTracer } from "lib/bus-tracer"
import { rk3326_01 } from "tests/fixtures/rk3326"

export default () => (
  <GenericSolverDebugger createSolver={() => new BusTracer(rk3326_01)} />
)
