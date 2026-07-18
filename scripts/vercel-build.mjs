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
  run("pnpm", ["db:migrate"]);
}

run("pnpm", ["build"]);
