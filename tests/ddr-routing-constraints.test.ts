import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { solveSample } from "tests/fixtures/solve-sample"
import { ddrRoutingConstraintsSrj } from "./fixtures/ddr-routing-constraints"

test("routes resolved DDR width, pair gap, and layer constraints", async () => {
  const solver = solveSample(ddrRoutingConstraintsSrj)
  const output = solver.getOutput()

  const expectedLaneOffsets = [-0.72, -0.18, 0.18, 0.72]
  output.coarseRoutes[0]!.laneCenterOffsets.forEach((offset, index) => {
    expect(offset).toBeCloseTo(expectedLaneOffsets[index]!)
  })
  for (const trace of output.traces) {
    for (const point of trace.route) {
      if (point.route_type !== "wire") continue
      expect(point.width).toBe(0.24)
      expect(point.layer).toBe("top")
    }
  }

  const svg = getSvgFromGraphicsObject(solver.finalVisualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
