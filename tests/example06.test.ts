import { expect, setDefaultTimeout, test } from "bun:test"
import "bun-match-svg"
import { sample006Srj } from "@tsci/tscircuit.dataset-srj12-bus-routing"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { solveSample } from "tests/fixtures/solve-sample"

setDefaultTimeout(120_000)

test("example06 routes the 19-trace sample006 bus atomically", async () => {
  const solver = solveSample(sample006Srj)
  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
