import { expect, setDefaultTimeout, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { countSameLayerTraceCrossings } from "lib/geometry"
import {
  getRk3326DrcErrors,
  getRk3326KeepoutViolations,
} from "tests/fixtures/get-rk3326-circuit-json"
import { rk3326_03 } from "tests/fixtures/rk3326"
import {
  solveRk3326Repro,
  visualizeRk3326Repro,
} from "tests/fixtures/solve-rk3326-repro"

setDefaultTimeout(20_000)

test("rk3326-03 routes the USB OTG bus between fanouts", async () => {
  const result = solveRk3326Repro(rk3326_03)
  expect(result.error).toBeUndefined()
  expect(result.solver.solved).toBeTrue()
  const traces = result.solver.getOutput().traces
  expect(traces).toHaveLength(4)
  expect(countSameLayerTraceCrossings(traces)).toBe(0)
  expect(
    new Set(
      traces.map(
        (trace) =>
          trace.route.filter((point) => point.route_type === "via").length,
      ),
    ),
  ).toEqual(new Set([1]))
  expect(getRk3326DrcErrors(rk3326_03, result.solver)).toEqual([])
  expect(getRk3326KeepoutViolations(rk3326_03, result.solver)).toEqual([])
  const svg = getSvgFromGraphicsObject(visualizeRk3326Repro(rk3326_03, result))
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
