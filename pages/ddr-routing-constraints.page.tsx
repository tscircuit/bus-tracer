import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BusTracer } from "lib/bus-tracer"
import { ddrRoutingConstraintsSrj } from "tests/fixtures/ddr-routing-constraints"

export default () => (
  <GenericSolverDebugger
    createSolver={() => new BusTracer(ddrRoutingConstraintsSrj)}
  />
)
