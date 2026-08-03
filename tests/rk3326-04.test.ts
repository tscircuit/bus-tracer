import { expect, setDefaultTimeout, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { rk3326_04 } from "tests/fixtures/rk3326"
import {
  expectRk3326ReproToRoute,
  visualizeRk3326Repro,
} from "tests/fixtures/solve-rk3326-repro"

setDefaultTimeout(120_000)

test("rk3326-04 captures the 10-line MIPI DSI bus challenge between fanouts", async () => {
  const result = expectRk3326ReproToRoute(rk3326_04, 10)
  const svg = getSvgFromGraphicsObject(visualizeRk3326Repro(rk3326_04, result))
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
