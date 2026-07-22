/**
 * The single frozen instant unit tests pin `nowDate()` to (src/lib/clock.ts),
 * matching the e2e fleet's approach (e2e/servers.ts). Test-worker processes
 * pick this up via vitest.config.ts's `test.env`; global-setup.ts sets it on
 * `process.env` directly because its own process — where the shared PGlite
 * seed template is built — does not inherit `test.env`. Both must agree, or
 * the template and a test's own `nowDate()` calls drift apart.
 */
export const TEST_FROZEN_CLOCK = "2026-07-21T13:30:00.000Z";
