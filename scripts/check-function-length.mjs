import { main } from "./check-page-length.mjs";

/**
 * The function half of `scripts/check-page-length.mjs`, alone. `pnpm check:repo` runs both
 * halves through that file; this entry exists so the ratchet's own hints
 * (`node scripts/check-function-length.mjs --absorb "<why>"`) name a command that works.
 */
await main(["functions"]);
