import {
  BasePipelineSolver,
  definePipelineStep,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  CoarseBusPathfindingSolver,
  type CoarseBusPathfindingSolverInput,
} from "./coarse-bus-pathfinding-solver"
import {
  DetailedBusRoutingSolver,
  type DetailedBusRoutingSolverInput,
} from "./detailed-bus-routing-solver"
import type {
  BusTracerOptions,
  BusTracerOutput,
  BusTracerSimpleRouteJson,
} from "./types"
import { visualizeBusTracer } from "./visualize"

export type BusTracerInput = {
  simpleRouteJson: BusTracerSimpleRouteJson
  options?: BusTracerOptions
}

export class BusTracer extends BasePipelineSolver<BusTracerInput> {
  coarseBusPathfindingSolver?: CoarseBusPathfindingSolver
  detailedBusRoutingSolver?: DetailedBusRoutingSolver

  pipelineDef: PipelineStep<any>[] = [
    definePipelineStep(
      "coarseBusPathfindingSolver",
      CoarseBusPathfindingSolver,
      (solver: BusTracer) => [
        {
          simpleRouteJson: solver.inputProblem.simpleRouteJson,
          options: solver.inputProblem.options,
        } satisfies CoarseBusPathfindingSolverInput,
      ],
    ),
    definePipelineStep(
      "detailedBusRoutingSolver",
      DetailedBusRoutingSolver,
      (solver: BusTracer) => [
        {
          simpleRouteJson: solver.inputProblem.simpleRouteJson,
          coarseRoutes:
            solver.coarseBusPathfindingSolver?.getOutput().buses ?? [],
          options: solver.inputProblem.options,
        } satisfies DetailedBusRoutingSolverInput,
      ],
    ),
  ]

  constructor(input: BusTracerInput | BusTracerSimpleRouteJson) {
    super(
      "simpleRouteJson" in input
        ? input
        : {
            simpleRouteJson: input,
          },
    )
  }

  getOutputSimpleRouteJson(): BusTracerSimpleRouteJson {
    return (
      this.detailedBusRoutingSolver?.getOutput().simpleRouteJson ??
      this.inputProblem.simpleRouteJson
    )
  }

  override getOutput(): BusTracerOutput {
    const detailed = this.detailedBusRoutingSolver?.getOutput()
    return {
      traces: detailed?.traces ?? [],
      simpleRouteJson:
        detailed?.simpleRouteJson ?? this.inputProblem.simpleRouteJson,
      coarseRoutes: this.coarseBusPathfindingSolver?.getOutput().buses ?? [],
    }
  }

  override initialVisualize(): GraphicsObject {
    return visualizeBusTracer({
      simpleRouteJson: this.inputProblem.simpleRouteJson,
      traces: this.inputProblem.simpleRouteJson.traces ?? [],
    })
  }

  override finalVisualize(): GraphicsObject {
    return visualizeBusTracer({
      simpleRouteJson: this.getOutputSimpleRouteJson(),
      traces: this.getOutputSimpleRouteJson().traces ?? [],
    })
  }
}
