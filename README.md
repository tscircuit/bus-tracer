# @tscircuit/bus-tracer

A small, obstacle-aware autorouter for the special case where a board needs a
few complete buses routed together. It consumes and returns `SimpleRouteJson`.

The solver is a two-stage `BasePipelineSolver`:

1. `CoarseBusPathfindingSolver` routes a corridor for each complete bus on a
   coarse 3D grid. Obstacles smaller than the coarse cell are intentionally
   ignored at this stage.
2. `DetailedBusRoutingSolver` offsets the corridor into ordered lanes and runs
   fine pathfinding for every trace against all obstacles. Layer transitions
   are inherited from the corridor and committed atomically with the bus.

Every trace in a bus therefore has the same via count and its corresponding
vias stay in the same local transition regions. Traces are only added to the
output SRJ after their complete bus has been planned.

## Usage

```ts
import { BusTracer } from "@tscircuit/bus-tracer"

const solver = new BusTracer(simpleRouteJson)
solver.solve()

if (solver.failed) throw new Error(solver.error ?? "Bus routing failed")

const routedSimpleRouteJson = solver.getOutputSimpleRouteJson()
const { traces, coarseRoutes } = solver.getOutput()
```

The current `SimpleRouteJson.buses` forms from both `@tscircuit/core` and
`@tscircuit/capacity-autorouter` are accepted:

```ts
{
  buses: [
    {
      busId: "DATA",
      connectionNames: ["D0", "D1", "D2", "D3"],
      maxLengthSkew: 0.25,
      traceWidth: 0.12,
      allowedLayers: ["top", "inner1"],
      termination: { type: "boundary" },
    },
  ]
}
```

`traceWidth` and differential-pair `traceGap` are resolved copper dimensions in
millimeters. The PCB stackup/impedance calculator must resolve impedance targets
to these dimensions before invoking bus-tracer. A connection-level
`nominalTraceWidth` takes precedence over its bus `traceWidth`.

```ts
{
  differentialPairs: [
    {
      connectionNames: ["DQS_P", "DQS_N"],
      lengthTolerance: 0.1,
      traceGap: 0.12,
    },
  ]
}
```

`allowedLayers` constrains coarse and detailed routing and must include the
terminal layers. Differential-pair members must be adjacent in bus order so the
router can reserve their exact edge-to-edge gap. Length constraints remain
metadata until a dedicated tuning stage consumes them.

Bus order is trace order. If `buses` is absent, all connections are treated as
one ordered implicit bus; this supports the pre-bus-metadata samples in
`tscircuit/dataset-srj12-bus-routing`. Each routed connection currently needs
exactly two `pointsToConnect`.

## Debugging and deployment

Six enumerated Cosmos pages import samples directly from
`tscircuit/dataset-srj12-bus-routing`; `example06` exercises a 19-trace bus.

```sh
bun install
bun run start
bun test
bun run typecheck
bun run build:site
```

`bun run build:site` uses `cosmos-export`. The included `vercel.json` publishes
the resulting `cosmos-export/` directory directly on Vercel.
