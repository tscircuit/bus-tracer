import {
  BasePipelineSolver,
  definePipelineStep,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import { PostProcessingSolver } from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import {
  CoarseBusPathfindingSolver,
  type CoarseBusPathfindingSolverInput,
} from "./coarse-bus-pathfinding-solver"
import {
  DetailedBusRoutingSolver,
  type DetailedBusRoutingSolverInput,
} from "./detailed-bus-routing-solver"
import {
  createDdrPostProcessingBinding,
  type DdrPostProcessingBinding,
} from "./create-ddr-post-processing-binding"
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
  postProcessingSolver?: PostProcessingSolver
  private ddrPostProcessingBinding: DdrPostProcessingBinding | null = null

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
    definePipelineStep(
      "postProcessingSolver",
      PostProcessingSolver,
      (solver: BusTracer) => {
        const detailed = solver.detailedBusRoutingSolver?.getOutput()
        if (!detailed)
          throw new Error(
            "BusTracer: DDR post-processing requires detailed routing output",
          )
        solver.ddrPostProcessingBinding = createDdrPostProcessingBinding({
          simpleRouteJson: detailed.simpleRouteJson,
          generatedTraces: detailed.traces,
          fixedTraces: solver.inputProblem.simpleRouteJson.traces ?? [],
        })
        return [solver.ddrPostProcessingBinding.params]
      },
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
    const detailed = this.detailedBusRoutingSolver?.getOutput()
    if (!detailed) return this.inputProblem.simpleRouteJson
    if (!this.postProcessingSolver?.solved || !this.ddrPostProcessingBinding)
      return detailed.simpleRouteJson
    const generatedTraces = this.ddrPostProcessingBinding.getOutputTraces(
      this.postProcessingSolver.getOutput(),
    )
    return {
      ...detailed.simpleRouteJson,
      traces: [
        ...(this.inputProblem.simpleRouteJson.traces ?? []),
        ...generatedTraces,
      ],
    }
  }

  override getOutput(): BusTracerOutput {
    const detailed = this.detailedBusRoutingSolver?.getOutput()
    const simpleRouteJson = this.getOutputSimpleRouteJson()
    const generatedTraceIds = new Set(
      detailed?.traces.map((trace) => trace.pcb_trace_id) ?? [],
    )
    return {
      traces: (simpleRouteJson.traces ?? []).filter((trace) =>
        generatedTraceIds.has(trace.pcb_trace_id),
      ),
      simpleRouteJson,
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
