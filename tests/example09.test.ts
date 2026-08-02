import { expect, setDefaultTimeout, test } from "bun:test"
import "bun-match-svg"
import { sample009Srj } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { solveSample } from "tests/fixtures/solve-sample"

setDefaultTimeout(120_000)

test("example09 routes sample009 as one atomic bus", async () => {
  const solver = solveSample(sample009Srj)
  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
