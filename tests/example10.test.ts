import { expect, setDefaultTimeout, test } from "bun:test"
import "bun-match-svg"
import { sample010Srj } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { solveSample } from "tests/fixtures/solve-sample"

setDefaultTimeout(120_000)

test("example10 routes sample010 as one atomic bus", async () => {
  const solver = solveSample(sample010Srj)
  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
