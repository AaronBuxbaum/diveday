#!/usr/bin/env node
// `pnpm check` — the pre-commit gate — as one concurrent, fail-slow pass.
//
// It used to be a serial chain: `check:repo && check:critical-text && lint && typecheck
// && test`. Two costs, both paid by whoever is iterating rather than by the machine.
//
// The chain **stopped at the first failure**, so a change that broke lint and typecheck
// and a test reported one of the three. Fixing it and re-running surfaced the second,
// fixing that surfaced the third: three full gates, three waits, three rounds of reading
// output, to learn what one run already knew. That is the exact argument
// `scripts/check-repo.mjs` makes for the guards it spawns — this file is the same
// argument one level up.
//
// And the chain was **serial** where nothing about it is ordered. The three static phases
// take about twenty seconds between them and the unit suite takes minutes; run
// concurrently they cost nothing at all, because they finish long before the suite does.
//
// It also ran `check:critical-text` twice — once on its own and once inside `check:repo`,
// which has spawned it since the guards table was written.
//
// Output is grouped per phase and buffered rather than interleaved, and the failures print
// **last**, after the one-line summaries of everything that passed. A session reading the
// tail of a long run then lands on what it has to fix instead of on a wall of green.

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// A backstop, deliberately not a schedule. The point is that a wedged phase becomes a named
// failure instead of a session waiting on a gate that will never return — so it is set well
// above any honest run rather than close to one. The unit suite is 13-16 minutes alone, and
// this repository expects several sessions working in parallel worktrees on one machine:
// during the run that introduced this file, two `pnpm check`s overlapped and the suite took
// 25. A timeout tight enough to catch that would report machine contention as a wedge, which
// is worse than useless — it is a red gate that tells you nothing and reruns green.
const PHASE_TIMEOUT_MS = 45 * 60_000;

/**
 * Each phase runs a command directly rather than through `pnpm <script>`, which would pay a
 * pnpm startup per phase and — for anything taking arguments — walk into the `--`
 * forwarding trap that silently drops flags.
 */
export const phases = [
  // Spawns the 37 repository guards itself, concurrently, and reports all of their
  // failures in one pass. `check:critical-text` is one of them; it is deliberately not
  // repeated here.
  { label: "repo", command: process.execPath, args: ["scripts/check-repo.mjs"] },
  { label: "lint", command: "pnpm", args: ["exec", "biome", "check", "."] },
  {
    label: "typecheck",
    command: "pnpm",
    // Both projects, as `pnpm typecheck` runs them — the service worker has its own
    // tsconfig and its own way of going red.
    args: ["exec", "tsc", "--noEmit"],
    // Not named `then`: an object carrying one is a thenable, and `await`ing a phase would
    // then call it. Biome's `noThenProperty` catches exactly this.
    andThen: { command: "pnpm", args: ["exec", "tsc", "--noEmit", "-p", "src/worker"] },
  },
  { label: "test", command: "pnpm", args: ["exec", "vitest", "run", "--reporter=dot"] },
];

function run({ label, command, args }) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Its own process group, so a timeout kills the whole tree rather than orphaning the
    // grandchildren — a vitest run is a pool of forks, and killing only the parent leaves
    // every one of them alive and holding a database. Same reasoning as check-repo.mjs.
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      shell: false,
    });

    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, PHASE_TIMEOUT_MS);

    const finish = (code, extra = "") => {
      clearTimeout(timer);
      resolve({
        label,
        code,
        seconds: (Date.now() - started) / 1000,
        output: (Buffer.concat(chunks).toString("utf8").trim() + extra).trim(),
      });
    };

    child.on("error", (error) =>
      finish(1, `\ncheck:${label} could not start ${command}: ${error.message}`),
    );
    child.on("close", (code) =>
      finish(
        timedOut ? 1 : code,
        timedOut
          ? `\ncheck:${label} timed out after ${PHASE_TIMEOUT_MS / 60_000} minutes and its process group was killed`
          : "",
      ),
    );
  });
}

/** A phase with an `andThen` is two commands that share one label and fail as one. */
async function runPhase(phase) {
  const first = await run(phase);
  if (first.code !== 0 || !phase.andThen) return first;
  const second = await run({ label: phase.label, ...phase.andThen });
  return {
    ...second,
    seconds: first.seconds + second.seconds,
    output: [first.output, second.output].filter(Boolean).join("\n"),
  };
}

async function main() {
  const started = Date.now();
  const results = await Promise.all(
    phases.map((phase) =>
      // Announce each phase as it lands, so a long run is legible while it is still
      // running rather than only in the block printed at the end.
      runPhase(phase).then((result) => {
        console.log(
          `${result.code === 0 ? "ok  " : "FAIL"} check:${result.label} (${result.seconds.toFixed(1)}s)`,
        );
        return result;
      }),
    ),
  );

  const failed = results.filter((result) => result.code !== 0);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  for (const result of results.filter((r) => r.code === 0)) {
    // A green phase has almost nothing anyone needs: `check:repo` alone prints an ok block
    // per guard, which is eighty lines saying nothing happened. Keep the one line from each
    // that states a count — how many guards ran, how many tests passed — because a number
    // is what distinguishes "everything passed" from "nothing ran".
    if (result.label === "repo" || result.label === "test") {
      const summary = result.output
        .split("\n")
        .filter((line) => /all checks passed|Test Files|Tests {2}/.test(line))
        .join("\n");
      if (summary) console.log(summary.trim());
    }
  }

  if (failed.length === 0) {
    console.log(`\ncheck: all ${results.length} phases passed in ${elapsed}s`);
    return;
  }

  for (const result of failed) {
    console.error(`\n===== check:${result.label} FAILED (exit ${result.code}) =====`);
    console.error(result.output);
  }
  console.error(
    `\ncheck: ${failed.length} of ${results.length} phases failed in ${elapsed}s — ${failed
      .map((result) => result.label)
      .join(
        ", ",
      )}. Every phase ran, so this is the whole list; fix them together rather than one round trip each.`,
  );
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
