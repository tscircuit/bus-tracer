import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { rk3326_04 } from "tests/fixtures/rk3326"
import {
  solveRk3326Repro,
  visualizeRk3326Repro,
} from "tests/fixtures/solve-rk3326-repro"

test("rk3326-04 captures the 10-line MIPI DSI bus challenge between fanouts", async () => {
  const result = solveRk3326Repro(rk3326_04)
  expect(result.error).toBeDefined()
  expect(result.solver.getOutput().traces).toHaveLength(0)
  const svg = getSvgFromGraphicsObject(visualizeRk3326Repro(rk3326_04, result))
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
