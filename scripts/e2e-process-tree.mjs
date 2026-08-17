import { spawnSync } from "node:child_process";
import process from "node:process";

function directChildren(pid) {
  if (process.platform === "win32") return [];
  const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger);
}

function collectDescendants(pid, seen = new Set()) {
  for (const childPid of directChildren(pid)) {
    if (seen.has(childPid)) continue;
    seen.add(childPid);
    collectDescendants(childPid, seen);
  }
  return seen;
}

/** Signal a process and its descendants without touching the caller's group. */
export function signalProcessTree(pid, signal) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])], {
      stdio: "ignore",
    });
    return;
  }

  const descendants = [...collectDescendants(pid)].reverse();
  for (const descendantPid of descendants) {
    try {
      process.kill(descendantPid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}
