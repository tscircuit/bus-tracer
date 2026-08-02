import {
  checkViasInPads,
  checkViasOffBoard,
  dedupePcbDrcErrors,
  runAllRoutingChecks,
} from "@tscircuit/checks"
import { setDefaultTimeout, test } from "bun:test"
import { samples } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import type { AnyCircuitElement } from "circuit-json"
import { getRoutedCircuitJson } from "tests/fixtures/get-routed-circuit-json"
import { solveSample } from "tests/fixtures/solve-sample"

setDefaultTimeout(120_000)

for (const { sampleName, srj } of samples) {
  test(`${sampleName} has no PCB routing DRC errors`, async () => {
    const solver = solveSample(srj)
    const circuitJson = await getRoutedCircuitJson(sampleName, solver)
    const errors = dedupePcbDrcErrors([
      ...(await runAllRoutingChecks(circuitJson)),
      ...checkViasInPads(circuitJson),
      ...checkViasOffBoard(circuitJson),
    ] as AnyCircuitElement[])

    if (errors.length > 0) {
      const countsByType = Object.fromEntries(
        [...Map.groupBy(errors, (error) => error.type)].map(
          ([type, groupedErrors]) => [type, groupedErrors.length],
        ),
      )
      throw new Error(
        `${sampleName} has ${errors.length} DRC errors ${JSON.stringify(countsByType)}:\n${errors
          .slice(0, 20)
          .map((error) => ("message" in error ? error.message : error.type))
          .join("\n")}`,
      )
    }
  })
}
