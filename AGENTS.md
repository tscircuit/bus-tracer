# Repository Instructions

## Tests and SVG snapshots

- Every test must assert a clear SVG snapshot of the behavior or output under test.
- Prefer a focused output visualization over a dump of unrelated solver search state.
- Commit the generated SVG snapshot with the test and visually inspect it before opening a pull request.
- Expected-failure reproductions must remain active tests and snapshot the failure state clearly; do not skip them solely because the solver currently fails.
