import { expect, test } from "bun:test"
import "bun-match-svg"
import { sample005Srj } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { solveSample } from "tests/fixtures/solve-sample"

test("example05 routes sample005 as one atomic bus", async () => {
  const solver = solveSample(sample005Srj)
  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
