import { expect, test } from "bun:test"
import "bun-match-svg"
import { sample004Srj } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { solveSample } from "tests/fixtures/solve-sample"

test("example04 routes sample004 as one atomic bus", async () => {
  const solver = solveSample(sample004Srj)
  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
