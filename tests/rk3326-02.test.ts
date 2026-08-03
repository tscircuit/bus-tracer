import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { countSameLayerTraceCrossings } from "lib/geometry"
import {
  getRk3326DrcErrors,
  getRk3326KeepoutViolations,
} from "tests/fixtures/get-rk3326-circuit-json"
import { rk3326_02 } from "tests/fixtures/rk3326"
import {
  solveRk3326Repro,
  visualizeRk3326Repro,
} from "tests/fixtures/solve-rk3326-repro"

test("rk3326-02 captures the eMMC control bus challenge between fanouts", async () => {
  const result = solveRk3326Repro(rk3326_02)
  expect(result.error).toBeUndefined()
  expect(result.solver.solved).toBeTrue()
  const traces = result.solver.getOutput().traces
  expect(traces).toHaveLength(3)
  expect(countSameLayerTraceCrossings(traces)).toBe(0)
  expect(
    new Set(
      traces.map(
        (trace) =>
          trace.route.filter((point) => point.route_type === "via").length,
      ),
    ),
  ).toEqual(new Set([1]))
  expect(getRk3326DrcErrors(rk3326_02, result.solver)).toEqual([])
  expect(getRk3326KeepoutViolations(rk3326_02, result.solver)).toEqual([])
  const svg = getSvgFromGraphicsObject(visualizeRk3326Repro(rk3326_02, result))
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
