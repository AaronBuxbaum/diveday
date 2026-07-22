# 20260722-export-zip-bundling — Use fflate to bundle the full-shop data export

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

The portability wedge ([competitive-strategy.md](../../product/competitive-strategy.md)) starts
with a self-serve full-shop export: one button that downloads every tenant-owned dataset as
documented CSVs. Multiple files need to arrive as one artifact a shop owner can open anywhere,
which means a ZIP archive — tar.gz is hostile to Windows front desks, and a page of separate
download links is not an ejection guarantee. Node's built-in `zlib` provides DEFLATE but not the
ZIP container format, so producing a ZIP requires either a dependency or a hand-rolled encoder.

## Decision

Add **fflate** (^0.8) as a runtime dependency and build the export bundle with its synchronous
`zipSync` in the download route handler. fflate is zero-dependency, ~8 kB core, MIT-licensed,
pure-JS (no native bindings — works in every deploy target Next supports), and widely used
(three.js, SheetJS). Export sizes are bounded — CSV text for one shop's operational history —
so synchronous zipping in a request handler is acceptable; revisit streaming only if real bundles
prove large.

## Alternatives considered

- **Hand-rolled ZIP writer** — the container format plus CRC32 is ~150 lines of subtle binary
  layout; safety-adjacent evidence exports deserve boring, proven code, not a bespoke encoder.
- **archiver / jszip / adm-zip** — heavier, transitive dependencies, and stream-oriented APIs we
  don't need for bounded in-memory bundles.
- **tar.gz via built-in zlib** — no new dependency, but shop staff on Windows cannot open it
  without extra tooling; the artifact must be universally openable to serve as the exit door.
- **Per-dataset CSV links, no bundle** — no dependency at all, but "eject" becomes twenty clicks
  and an incomplete-download hazard; the one-button bundle is the product promise.

## Consequences

One small, stable dependency joins the runtime; the export route stays a simple
rows → CSV strings → `zipSync` pipeline that unit tests can exercise without HTTP. Commits us to
in-memory bundle assembly — a shop whose export outgrows memory would force a move to a streaming
zip (fflate supports it; the route contract wouldn't change). If fflate is ever abandoned, any
ZIP encoder with a buffer API is a drop-in replacement behind `src/lib/export.ts`.
