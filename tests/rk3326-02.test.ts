import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { rk3326_02 } from "tests/fixtures/rk3326"
import {
  solveRk3326Repro,
  visualizeRk3326Repro,
} from "tests/fixtures/solve-rk3326-repro"

test("rk3326-02 captures the eMMC control bus challenge between fanouts", async () => {
  const result = solveRk3326Repro(rk3326_02)
  expect(result.error?.message).toContain("No shared clear via region")
  expect(result.solver.getOutput().traces).toHaveLength(0)
  const svg = getSvgFromGraphicsObject(visualizeRk3326Repro(rk3326_02, result))
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
