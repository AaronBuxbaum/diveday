import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}.`);
  }
}

// VERCEL_ENV is available only when Vercel's System Environment Variables are enabled.
// Keep previews read-only: schema changes apply only to the production deployment of main.
if (process.env.VERCEL_ENV === "production") {
  // The last thing standing between a contracting migration and the database.
  // This build applies DDL while the *previous* release is still serving
  // traffic, and there are no down migrations — so the guard refuses a `DROP`,
  // a rename, or a type change that carries no in-SQL acknowledgement, and it
  // refuses before `db:migrate` has touched anything. `pnpm check:repo` runs the
  // same guard on every branch, so reaching this line red means a merge slipped
  // past CI, not that a session was surprised here.
  // ADR 20260806-destructive-migration-guard.
  run("node", ["scripts/check-migrations.mjs"]);
  run("pnpm", ["db:migrate"]);
}

run("pnpm", ["build"]);
