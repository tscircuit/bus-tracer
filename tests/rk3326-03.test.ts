import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { rk3326_03 } from "tests/fixtures/rk3326"
import {
  solveRk3326Repro,
  visualizeRk3326Repro,
} from "tests/fixtures/solve-rk3326-repro"

test("rk3326-03 captures the USB OTG bus challenge between fanouts", async () => {
  const result = solveRk3326Repro(rk3326_03)
  expect(result.error?.message).toContain("No shared clear via region")
  expect(result.solver.getOutput().traces).toHaveLength(0)
  const svg = getSvgFromGraphicsObject(visualizeRk3326Repro(rk3326_03, result))
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
