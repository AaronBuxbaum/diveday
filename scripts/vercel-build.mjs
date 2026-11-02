import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

function run(command, args, timeoutMs) {
  const result = runBounded(command, args, { stdio: "inherit", timeoutMs });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}.`);
  }
}

// Keep the production refusal gate without retaining Next's compiled application
// beside the TypeScript 7 checker on Vercel's 8 GB builder. Generate the current
// route types first, then run both TypeScript projects in a separate process.
// next.config.ts skips only that overlapping in-build pass on Vercel; local
// `pnpm build` still checks. Run before any production migration so a type error
// cannot leave the schema ahead of the code that would have used it.
if (process.env.VERCEL === "1") {
  run("pnpm", ["exec", "next", "typegen"], SUBPROCESS_TIMEOUTS.build);
  run("pnpm", ["typecheck"], SUBPROCESS_TIMEOUTS.build);
}

// VERCEL_ENV is available only when Vercel's System Environment Variables are enabled.
// Keep previews read-only: schema changes apply only to the production deployment of main.
if (process.env.VERCEL_ENV === "production") {
  // First of all, the deploy gate (scripts/deploy-gate.mjs, H-20261021-deploy-gate-from-first). Once
  // DEPLOY_REQUIRES_GREEN is on, production builds only the commit
  // deploy-gate.yml proved green on main. The Ignored Build Step already
  // cancels a push-triggered build; this catches the paths that skip that
  // step, such as a dashboard "Redeploy", before anything below migrates. Off
  // (the default), it passes every build, as before.
  run("node", ["scripts/deploy-gate.mjs", "check"], SUBPROCESS_TIMEOUTS.nodeScript);
  // Then the cheapest refusal a human has to act on: every registry row
  // marked `requiredInProduction` (the Upstash pair, without which every rate
  // limit is per serverless instance, and SECRET_ENCRYPTION_KEY, without which
  // two-factor sign-in and the retry queue stop) must be set on the Vercel
  // project, or the deploy fails here naming the keys. A deploy that fails
  // loudly beats a feature that fails quietly; decided 2026-10-07 (issue
  // #2244). Previews and local builds are not asked.
  run("node", ["scripts/check-env.mjs"], SUBPROCESS_TIMEOUTS.nodeScript);
  // The last thing standing between a contracting migration and the database.
  // This build applies DDL while the *previous* release is still serving
  // traffic, and there are no down migrations — so the guard refuses a `DROP`,
  // a rename, or a type change that carries no in-SQL acknowledgement, and it
  // refuses before `db:migrate` has touched anything. `pnpm check:repo` runs the
  // same guard on every branch, so reaching this line red means a merge slipped
  // past CI, not that a session was surprised here.
  // ADR 20260806-destructive-migration-guard.
  run("node", ["scripts/check-migrations.mjs"], SUBPROCESS_TIMEOUTS.nodeScript);
  // `drizzle-kit migrate` runs this same commutativity walk itself, and would
  // refuse the tree two lines below on its own -- but it prints a diagram and
  // no remedy, which is how a build once died here naming two migrations and
  // no way forward. Running it first means the deploy log carries the fix.
  run("node", ["scripts/check-migration-graph.mjs"], SUBPROCESS_TIMEOUTS.nodeScript);
  // Five minutes, and the tightest bound in this file on purpose: a migration
  // blocked on a lock held by the previous release is the one wedge here that
  // would otherwise spend the platform's whole build budget before saying so.
  run("pnpm", ["db:migrate"], SUBPROCESS_TIMEOUTS.migrate);
  // check-env refused a malformed sealing key; a well-formed wrong one shows
  // only against the stored data. A rotated SECRET_ENCRYPTION_KEY without its
  // _PREVIOUS, or a wrong _PREVIOUS, would lock out every two-factor staffer,
  // so the deploy trial-opens their secrets and stops before serving, naming
  // the variables and never their values (issue #2999). After the migration,
  // so it reads the schema this release serves.
  run("pnpm", ["exec", "tsx", "scripts/check-sealing-keys.ts"], SUBPROCESS_TIMEOUTS.nodeScript);
}

run("pnpm", ["build"], SUBPROCESS_TIMEOUTS.build);
