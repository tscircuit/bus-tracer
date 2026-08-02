import { sample003Srj } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BusTracer } from "lib/bus-tracer"
import type { BusTracerSimpleRouteJson } from "lib/types"

export default () => (
  <GenericSolverDebugger
    createSolver={() =>
      new BusTracer(sample003Srj as unknown as BusTracerSimpleRouteJson)
    }
  />
)
