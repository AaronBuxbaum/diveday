import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";

// Entire committed tree, full inherited environment (hashed, never serialized), dependency
// installation and executable identities. Only deterministic local static stages opt in.
export function stageKey({ tree, step, env, tools, dependencies }) {
  if (!tree || !tools || !dependencies) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        tree,
        step,
        env: Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
        tools,
        dependencies,
      }),
    )
    .digest("hex");
}
export function installationIdentity(root) {
  try {
    return ["node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml"].map((file) => {
      const full = `${root}/${file}`;
      return [file, readFileSync(full, "utf8"), statSync(full).mtimeMs];
    });
  } catch {
    return null;
  }
}
const ownedGroups = new Set();
function reapGroups() {
  for (const pid of ownedGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
}
function interrupted() {
  reapGroups();
  process.exit(130);
}
function terminated() {
  reapGroups();
  process.exit(143);
}
function registerGroup(pid) {
  if (!pid) return;
  if (ownedGroups.size === 0) {
    process.on("exit", reapGroups);
    process.on("SIGINT", interrupted);
    process.on("SIGTERM", terminated);
  }
  ownedGroups.add(pid);
}
function releaseGroup(pid) {
  ownedGroups.delete(pid);
  if (ownedGroups.size === 0) {
    process.off("exit", reapGroups);
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", terminated);
  }
}

/** Bounded asynchronous equivalent of runStep; owns and reaps the whole process group. */
export function runStageAsync(command, args, { timeoutMs, ...options }) {
  if (
    !(timeoutMs > 0) ||
    options.shell ||
    [command, ...args].some((value) => typeof value !== "string" || value.includes("\0"))
  )
    throw new Error("A stage requires bounded argv without a shell.");
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, { ...options, detached: true });
    registerGroup(child.pid);
    const kill = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      kill();
      releaseGroup(child.pid);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: 124, error: "ETIMEDOUT" }), timeoutMs);
    child.once("error", (error) => finish({ status: 1, error: error.code }));
    child.once("exit", (status, signal) => finish({ status: status ?? 1, signal }));
  });
}
export async function collectStages(steps, run, concurrency = 2) {
  const results = new Array(steps.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, steps.length) }, async () => {
      while (next < steps.length) {
        const index = next++;
        try {
          results[index] = await run(steps[index]);
        } catch (error) {
          results[index] = { name: steps[index].name, status: "failed", error: String(error) };
        }
      }
    }),
  );
  return results;
}

/** Reuse only the directly invoked, checksum-identified Biome binary on known platforms. */
export function lintToolIdentity(root) {
  if (process.env.BIOME_BINARY || !["darwin", "win32"].includes(process.platform)) return null; // libc resolution is uncertain on Linux
  try {
    const require = createRequire(`${root}/package.json`);
    const biomeRequire = createRequire(require.resolve("@biomejs/biome/package.json"));
    const binary = biomeRequire.resolve(
      `@biomejs/cli-${process.platform}-${process.arch}/biome${process.platform === "win32" ? ".exe" : ""}`,
    );
    return { binary, digest: createHash("sha256").update(readFileSync(binary)).digest("hex") };
  } catch {
    return null;
  }
}

export function verificationInputsStable({ head, tree, status }, initial) {
  return head === initial.head && tree === initial.tree && status === "";
}
