import { expect, test } from "bun:test"
import "bun-match-svg"
import { sample003Srj } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { solveSample } from "tests/fixtures/solve-sample"

test("example03 routes sample003 as one atomic bus", async () => {
  const solver = solveSample(sample003Srj)
  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
