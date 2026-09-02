import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { TEST_FROZEN_CLOCK } from "./src/test/frozen-clock";
import { CostWeightedSequencer } from "./src/test/shard-sequencer";

export default defineConfig({
  plugins: [react()],
  test: {
    // Node is the default; the few component tests that need a DOM opt in with
    // a `// @vitest-environment jsdom` docblock. Booting jsdom for every pure
    // domain-logic file was measurable dead weight.
    environment: "node",
    // Passing tests keep their console output to themselves; a failing test still prints
    // every line it wrote. `src/lib/log.ts` writes a structured JSON line per event on the
    // money and cron paths, and the suite exercises those paths hard — so a green run used
    // to interleave hundreds of `{"time":...,"event":"checkout.retired_stale_quote",...}`
    // lines and their `stdout | file > test name` banners through the dot reporter, which
    // is output nobody reads and everybody pays for (AGENTS.md, "Context economy":
    // successful tooling should be quiet). This is a reporter setting, not a mute: Vitest
    // intercepts `globalThis.console`, so the handful of tests that `vi.spyOn(console, ...)`
    // still observe every call. Pass `--silent=false` to watch a passing test's logs while
    // debugging one.
    silent: "passed-only",
    setupFiles: ["./src/test/setup.ts"],
    // Builds the shared PGlite template snapshot the db tests hydrate from.
    globalSetup: ["./src/test/global-setup.ts"],
    // `scripts/` is in scope too: a few repo scripts carry real parsing and
    // formatting logic that nothing else would exercise (scripts/visual-report-lib.mjs
    // decides whether a reg-suit run compared anything at all), and they belong
    // in the same `pnpm check` gate as the app.
    // `infra/` too: the CDK stack is the only place a credential can leak into a
    // stack output, and nothing else in `pnpm check` synthesizes it — lint and
    // tsc see TypeScript, not a CloudFormation template.
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs", "infra/**/*.test.ts"],
    // PGlite-backed integration tests hydrate an embedded Postgres per test;
    // generous ceiling so slow CI runners don't flake.
    testTimeout: 20_000,
    // The same ceiling for hooks, because `fileScopedShopContext` moved the
    // hydration *out* of the test body and into `beforeAll` (src/test/db.ts).
    // Vitest's hook default is 10s, so without this the identical work — one
    // template hydration — silently got half the budget it had while it lived
    // inside a test. This is not widening a timeout to paper over a flake: the
    // work did not grow, it moved, and the budget follows it. It gets *rarer*
    // at the same time, since a file now hydrates once instead of once per
    // test.
    hookTimeout: 20_000,
    // Back to Vitest 4's own default after a worker_threads-specific PGlite
    // failure finally surfaced — the exact condition the "threads" note here
    // named as the one reason to revisit.
    //
    // The symptom is not a test failure. A random one of CI's four shards dies
    // outright:
    //
    //     # Check failed: jit_page_->allocations_.erase(addr) == 1.
    //     v8::internal::ThreadIsolation::UnregisterWasmAllocation(...)
    //     Command was killed with SIGILL (Invalid machine instruction)
    //
    // `ThreadIsolation` is V8's *cross-thread* protection for JIT and WASM code
    // pages, and `jit_page_->allocations_` is one process-global map shared by
    // every thread in the isolate group. Under "threads" all of a worker's test
    // files run in one process, and the only WASM here is PGlite — which every
    // db-backed test instantiates and closes (~900 open/close cycles a run,
    // hundreds per shard, several threads at once). That map is what the CHECK
    // guards, and freeing WASM code from several threads is what trips it.
    // Forks give each file its own process, so there is no shared page table to
    // disagree about.
    //
    // Seen on main at c72ef6d (shard 3/4), on PR #573 at cf14914 (shard 2/4),
    // and on PR #574 at 2b44612 (shard 4/4, where the gear register also loads
    // btree_gist into every test PGlite beside pg_trgm — one more WASM module
    // churning per instance) — different shards each time, so not a test's
    // fault; it never reproduced locally, which is why the fix is reasoned
    // from the crash site rather than from a red run on this machine.
    //
    // The cost is real, and larger than the old note's 13% — measured on this
    // branch rather than inherited: 792s and 802s under "threads", 947s under
    // "forks", so about +20%, or two and a half minutes on a full local run.
    // CI shards four ways, so it lands as ~40s a shard. That buys a signal that
    // means what it says, which is worth more than the minutes: a SIGILL is
    // indistinguishable from a flake, and "just re-run it" is exactly the habit
    // this repo refuses everywhere else.
    //
    // Do not reach for `isolate: false` to win the time back — module mocks are
    // per-file here, and a shared registry across files is a different bug.
    pool: "forks",
    // `--shard=i/n` (CI's four unit shards) deals files by estimated cost, not
    // by count: a db-backed file costs a PGlite hydration per test and a pure
    // one costs almost nothing, and an equal-count deal left the slowest shard
    // a minute and a half behind the fastest. See src/test/shard-sequencer.ts.
    sequence: { sequencer: CostWeightedSequencer },
    // `pnpm test:changed` (and `vitest related`) selects tests by walking the
    // *import* graph, and the Drizzle migrations are never imported — they are
    // read off disk at runtime by `migrate(db, { migrationsFolder: "drizzle" })`.
    // A migration change therefore selected zero tests while silently changing
    // the schema every db-backed test runs against. Listing it here makes any
    // `drizzle/` edit rerun the whole suite. Setting this option *replaces*
    // Vitest's defaults rather than extending them, so the first three entries
    // restate those defaults verbatim and must stay.
    forceRerunTriggers: [
      "**/package.json/**",
      "**/vitest.config.*/**",
      "**/vite.config.*/**",
      "**/drizzle/**",
    ],
    // Freezes `nowDate()` (src/lib/clock.ts) for test-worker processes; see
    // src/test/frozen-clock.ts for why global-setup.ts also sets this
    // directly rather than relying on this config alone.
    env: {
      DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      // Set-but-empty is this repo's "off" switch (src/lib/configured.ts), and
      // the DSN needs one now that it is compiled in rather than supplied by
      // the environment: `register()` is called directly by
      // instrumentation.test.ts, so without this the unit suite initializes
      // real Sentry and reports its own deliberate failures to the production
      // project. `pnpm e2e:build` switches it off the same way.
      NEXT_PUBLIC_SENTRY_DSN: "",
      // A throwaway sealing key, so the suite runs the path a deployment runs.
      // Without one `secretKeyFromEnvironment()` reports "unset" and every
      // sealing caller degrades — waiver links would go back to being reissued
      // on every send, and the tests would be proving the fallback rather than
      // the behaviour. Not a secret: it seals nothing outside a test database,
      // and production derives its own from the stack seed.
      SECRET_ENCRYPTION_KEY: "ZGl2ZWRheS10ZXN0LW9ubHktc2VhbGluZy1rZXktMDE=",
      // Same reasoning as the sealing key: `isManagedStorageUrl` now derives
      // "one of ours" from the configured bucket rather than from a hostname
      // suffix, so without a bucket name the suite would prove the
      // no-storage-configured fallback instead of the behaviour. No
      // credentials, so nothing here can reach a real bucket.
      MEDIA_BUCKET_NAME: "diveday-media",
      MEDIA_AWS_REGION: "us-east-1",
      DIVEDAY_CLOCK: TEST_FROZEN_CLOCK,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
