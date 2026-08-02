import { expect, test } from "bun:test"
import "bun-match-svg"
import { sample002Srj } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { solveSample } from "tests/fixtures/solve-sample"

test("example02 routes sample002 as one atomic bus", async () => {
  const solver = solveSample(sample002Srj)
  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
