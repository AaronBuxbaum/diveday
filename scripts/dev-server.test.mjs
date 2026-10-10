import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  budgetIsUnreachable,
  cgroupAnonBytes,
  cgroupMemoryLimitBytes,
  countFutileRestart,
  DEV_STATE_IN_USE_MARKER,
  databaseDescription,
  devLockPid,
  devStateIsAbandoned,
  discardAbandonedDevState,
  formatMb,
  hardLimitBytes,
  hardLimitVerdict,
  lineSplitter,
  localPortFromLine,
  markDevStateClean,
  markDevStateInUse,
  memoryBudgetBytes,
  memoryCeilingBytes,
  parseProcessRows,
  portFromArgs,
  portInUseFromLine,
  treePids,
  treeRssBytes,
} from "./dev-server.mjs";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** A `readFileSync` over a fixture map, throwing for anything absent. */
function reader(files) {
  return (file) => {
    if (!(file in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return files[file];
  };
}

describe("cgroupMemoryLimitBytes", () => {
  it("reads the nested v1 limit Claude Code's containers put a session in", () => {
    // The real layout this was written against: the session's shell lives in a
    // per-session memory cgroup whose limit (13,663 MB) is well under the
    // host's 16,075 MB, and it is the one that does the killing.
    const files = {
      "/proc/self/cgroup": [
        "9:name=systemd:/",
        "4:memory:/process_api/01a068c5/claude-code-bash",
        "1:cpu:/",
        "0::/",
      ].join("\n"),
      "/sys/fs/cgroup/memory/process_api/01a068c5/claude-code-bash/memory.limit_in_bytes":
        "14327676928\n",
    };
    expect(cgroupMemoryLimitBytes(reader(files))).toBe(14327676928);
  });

  it("reads a v2 limit at the unified path", () => {
    const files = {
      "/proc/self/cgroup": "0::/user.slice/session.scope\n",
      "/sys/fs/cgroup/user.slice/session.scope/memory.max": "4294967296\n",
    };
    expect(cgroupMemoryLimitBytes(reader(files))).toBe(4 * GB);
  });

  it("reads a v2 limit at the mount root when the process sits at /", () => {
    const files = {
      "/proc/self/cgroup": "0::/\n",
      "/sys/fs/cgroup/memory.max": "2147483648\n",
    };
    expect(cgroupMemoryLimitBytes(reader(files))).toBe(2 * GB);
  });

  it("is null for v2's literal 'max'", () => {
    const files = {
      "/proc/self/cgroup": "0::/\n",
      "/sys/fs/cgroup/memory.max": "max\n",
    };
    expect(cgroupMemoryLimitBytes(reader(files))).toBeNull();
  });

  it("is null for v1's near-2^63 sentinel, which means 'no limit' and not 8 exabytes", () => {
    const files = {
      "/proc/self/cgroup": "4:memory:/\n",
      "/sys/fs/cgroup/memory//memory.limit_in_bytes": "9223372036854771712\n",
    };
    expect(cgroupMemoryLimitBytes(reader(files))).toBeNull();
  });

  it("is null on a machine with no cgroups at all", () => {
    expect(cgroupMemoryLimitBytes(reader({}))).toBeNull();
  });

  it("takes the smaller when both hierarchies answer", () => {
    const files = {
      "/proc/self/cgroup": ["4:memory:/limited", "0::/limited"].join("\n"),
      "/sys/fs/cgroup/memory/limited/memory.limit_in_bytes": String(2 * GB),
      "/sys/fs/cgroup/limited/memory.max": String(8 * GB),
    };
    expect(cgroupMemoryLimitBytes(reader(files))).toBe(2 * GB);
  });
});

describe("cgroupAnonBytes", () => {
  it("reads v1's total_rss, which is what the OOM report counted", () => {
    // The kill line reads `anon-rss:13,091,384kB`, and `total_rss` is that
    // number for the whole cgroup including descendants.
    const files = {
      "/proc/self/cgroup": "4:memory:/session\n",
      "/sys/fs/cgroup/memory/session/memory.stat": [
        "cache 3592499200",
        "rss 637325312",
        "total_cache 3592499200",
        "total_rss 1774321664",
      ].join("\n"),
    };
    expect(cgroupAnonBytes(reader(files))).toBe(1774321664);
  });

  it("reads v2's anon", () => {
    const files = {
      "/proc/self/cgroup": "0::/session\n",
      "/sys/fs/cgroup/session/memory.stat": ["anon 2147483648", "file 999"].join("\n"),
    };
    expect(cgroupAnonBytes(reader(files))).toBe(2 * GB);
  });

  it("never returns page cache, which is reclaimable and would restart the server for nothing", () => {
    // Measured on this container: 4,108 MB of `memory.usage_in_bytes` against
    // 637 MB of `total_rss`, the difference being warm filesystem cache.
    const files = {
      "/proc/self/cgroup": "4:memory:/session\n",
      "/sys/fs/cgroup/memory/session/memory.stat": ["total_cache 3592499200", "total_rss 668"].join(
        "\n",
      ),
    };
    expect(cgroupAnonBytes(reader(files))).toBe(668);
  });

  it("is null with no cgroup, so the caller falls back to its own tree", () => {
    expect(cgroupAnonBytes(reader({}))).toBeNull();
  });
});

describe("memoryCeilingBytes", () => {
  it("prefers the cgroup limit over the host's memory, which is the whole point", () => {
    // Reading `os.totalmem()` alone is how a budget ends up above the limit
    // that will actually kill the process.
    const files = {
      "/proc/self/cgroup": "4:memory:/capped\n",
      "/sys/fs/cgroup/memory/capped/memory.limit_in_bytes": String(13 * GB),
    };
    expect(memoryCeilingBytes({ readFile: reader(files), totalmem: () => 16 * GB })).toBe(13 * GB);
  });

  it("falls back to host memory when nothing is capped", () => {
    expect(memoryCeilingBytes({ readFile: reader({}), totalmem: () => 8 * GB })).toBe(8 * GB);
  });

  it("takes host memory when it is the smaller of the two", () => {
    const files = {
      "/proc/self/cgroup": "4:memory:/generous\n",
      "/sys/fs/cgroup/memory/generous/memory.limit_in_bytes": String(64 * GB),
    };
    expect(memoryCeilingBytes({ readFile: reader(files), totalmem: () => 4 * GB })).toBe(4 * GB);
  });
});

describe("memoryBudgetBytes", () => {
  it("takes the fraction when there is plenty of headroom above it", () => {
    // The measured container: 13,663 MB ceiling → 60% is 8,198 MB, and
    // ceiling-minus-headroom (10,591 MB) is the looser of the two.
    expect(memoryBudgetBytes(13663 * MB)).toBe(13663 * MB * 0.6);
  });

  it("takes the headroom rule when the fraction would leave less than one render's spare", () => {
    // 8 GB ceiling: 60% is 4,915 MB but a single render transiently wants
    // ~3 GB, so the budget has to come down to 5,120 MB… which is larger, so
    // the fraction still wins. At 6 GB the headroom rule binds: 3,686 MB
    // (fraction) vs 3,072 MB (ceiling − headroom).
    expect(memoryBudgetBytes(6 * GB)).toBe(6 * GB - 3072 * MB);
  });

  it("never drops below the floor, however small the ceiling", () => {
    expect(memoryBudgetBytes(2 * GB)).toBe(1 * GB);
  });

  it("is null when no ceiling could be determined, which turns supervision off", () => {
    expect(memoryBudgetBytes(null)).toBeNull();
  });

  it("honours an explicit override", () => {
    expect(memoryBudgetBytes(16 * GB, { overrideMb: "2048" })).toBe(2048 * MB);
  });

  it("treats an override of 0 as 'do not supervise'", () => {
    expect(memoryBudgetBytes(16 * GB, { overrideMb: "0" })).toBeNull();
  });

  it("ignores an override that is set but empty, the way an unset variable reads", () => {
    expect(memoryBudgetBytes(16 * GB, { overrideMb: "" })).toBe(16 * GB * 0.6);
  });

  it("is undefined for a malformed override, so the caller can refuse rather than guess", () => {
    expect(memoryBudgetBytes(16 * GB, { overrideMb: "lots" })).toBeUndefined();
    expect(memoryBudgetBytes(16 * GB, { overrideMb: "-1" })).toBeUndefined();
  });
});

describe("hardLimitBytes", () => {
  it("sits at 80% of the ceiling, above the budget", () => {
    // The measured container: 13,664 MB ceiling → budget 8,198 MB, hard 10,931.
    // The gap is what a staff-page capture matrix (peaked at 12,880 MB here)
    // gets to run in without the server being restarted underneath it.
    const ceiling = 13664 * MB;
    const hard = hardLimitBytes(ceiling, memoryBudgetBytes(ceiling));
    expect(Math.round(hard / MB)).toBe(10931);
    expect(hard).toBeGreaterThan(memoryBudgetBytes(ceiling));
  });

  it("never lands below the budget, which would make every restart an interrupting one", () => {
    // A ceiling small enough that the budget floor (1 GB) outruns 80% of it.
    const ceiling = 1.1 * GB;
    const budget = memoryBudgetBytes(ceiling);
    expect(hardLimitBytes(ceiling, budget)).toBeGreaterThanOrEqual(budget);
  });

  it("never lands above the ceiling", () => {
    expect(hardLimitBytes(2 * GB, 1.9 * GB)).toBeLessThanOrEqual(2 * GB);
  });

  it("is null when there is nothing to reckon against", () => {
    expect(hardLimitBytes(null, 1 * GB)).toBeNull();
    expect(hardLimitBytes(8 * GB, null)).toBeNull();
  });
});

describe("parseProcessRows", () => {
  it("reads pid, ppid and RSS, and converts ps's kilobytes to bytes", () => {
    const raw = ["  2542  2525 3375708", "  2525  2492   78272", "not a process row"].join("\n");
    expect(parseProcessRows(raw)).toEqual([
      { pid: 2542, ppid: 2525, rssBytes: 3375708 * 1024 },
      { pid: 2525, ppid: 2492, rssBytes: 78272 * 1024 },
    ]);
  });

  it("is empty rather than throwing when ps prints nothing usable", () => {
    expect(parseProcessRows("")).toEqual([]);
  });
});

describe("treeRssBytes", () => {
  const rows = [
    { pid: 100, ppid: 1, rssBytes: 10 },
    { pid: 200, ppid: 100, rssBytes: 3000 },
    { pid: 300, ppid: 200, rssBytes: 500 },
    { pid: 900, ppid: 1, rssBytes: 99999 },
  ];

  it("sums the whole tree, because the cgroup charges the tree", () => {
    // `next dev` is the bin (100), `next-server` (200) and Turbopack's Node
    // evaluation pool (300). Watching only the biggest under-counts.
    expect(treeRssBytes(rows, 100)).toBe(3510);
  });

  it("leaves an unrelated process out of it", () => {
    expect(treeRssBytes(rows, 200)).toBe(3500);
  });

  it("is zero for a pid that has already gone", () => {
    expect(treeRssBytes(rows, 12345)).toBe(0);
  });

  it("terminates on a parent cycle rather than spinning", () => {
    const cyclic = [
      { pid: 1, ppid: 2, rssBytes: 5 },
      { pid: 2, ppid: 1, rssBytes: 7 },
    ];
    expect(treeRssBytes(cyclic, 1)).toBe(12);
  });
});

describe("treePids", () => {
  const rows = [
    { pid: 100, ppid: 1, rssBytes: 10 },
    { pid: 200, ppid: 100, rssBytes: 3000 },
    { pid: 300, ppid: 200, rssBytes: 500 },
    { pid: 900, ppid: 1, rssBytes: 99999 },
  ];

  it("is the root and everything under it", () => {
    expect([...treePids(rows, 100)].sort()).toEqual([100, 200, 300]);
  });

  it("does not claim a sibling tree — which is what tells another checkout's dev server from ours", () => {
    expect(treePids(rows, 100).has(900)).toBe(false);
  });
});

describe("devLockPid", () => {
  it("reads the pid Next records in its dev lockfile", () => {
    expect(
      devLockPid(
        '{"pid":16223,"port":3000,"hostname":"localhost","appUrl":"http://localhost:3000","startedAt":1788466241310}',
      ),
    ).toBe(16223);
  });

  it("is null for an absent or half-written lockfile rather than throwing", () => {
    expect(devLockPid("")).toBeNull();
    expect(devLockPid('{"pid":')).toBeNull();
    expect(devLockPid("{}")).toBeNull();
  });
});

describe("portFromArgs", () => {
  it("defaults to 3000", () => {
    expect(portFromArgs([])).toBe(3000);
  });

  it("reads --port, -p and --port=", () => {
    expect(portFromArgs(["--port", "3200"])).toBe(3200);
    expect(portFromArgs(["-p", "4000"])).toBe(4000);
    expect(portFromArgs(["--port=3210"])).toBe(3210);
  });

  it("ignores a --port with no number after it", () => {
    expect(portFromArgs(["--port", "--turbo"])).toBe(3000);
  });
});

describe("localPortFromLine", () => {
  it("reads the port off Next's own banner", () => {
    expect(localPortFromLine("   - Local:         http://localhost:3001")).toBe(3001);
  });

  it("reads it off the network line's host too", () => {
    expect(localPortFromLine("- Local:   http://192.0.2.2:3000")).toBe(3000);
  });

  it("is null for any other line", () => {
    expect(localPortFromLine("✓ Ready in 407ms")).toBeNull();
  });
});

describe("hardLimitVerdict (issue #2148)", () => {
  const MB = 1024 * 1024;
  const hardLimit = 10_944 * MB;

  it("restarts when this server's share can bring the cgroup under the mark", () => {
    expect(hardLimitVerdict({ pressure: 11_500 * MB, hardLimit, ownRss: 9_000 * MB })).toBe(
      "restart",
    );
  });

  it("refuses the restart when the pressure belongs to other processes", () => {
    // The incident: 12,784 MB against a 10,944 MB mark, 272 MB of it this
    // server. Restarting it 27 times could never free 12.5 GB.
    expect(hardLimitVerdict({ pressure: 12_784 * MB, hardLimit, ownRss: 272 * MB })).toBe(
      "elsewhere",
    );
  });

  it("refuses at the edge, where freeing everything we hold still lands on the mark", () => {
    expect(hardLimitVerdict({ pressure: 11_944 * MB, hardLimit, ownRss: 1_000 * MB })).toBe(
      "elsewhere",
    );
    expect(hardLimitVerdict({ pressure: 11_943 * MB, hardLimit, ownRss: 1_000 * MB })).toBe(
      "restart",
    );
  });

  it("is under below the mark, and with no mark at all", () => {
    expect(hardLimitVerdict({ pressure: 4_000 * MB, hardLimit, ownRss: 3_000 * MB })).toBe("under");
    expect(hardLimitVerdict({ pressure: 99_000 * MB, hardLimit: null, ownRss: 1 })).toBe("under");
  });

  it("gives up on the mark after the same three quick restarts the budget does", () => {
    // Restarts that come straight back over the mark count with the budget's
    // own rule, so a repeat stops instead of looping.
    let futile = 0;
    for (const sinceLast of [null, 8_000, 9_000, 7_000]) {
      futile = countFutileRestart(futile, sinceLast);
    }
    expect(budgetIsUnreachable(futile)).toBe(true);
  });
});

describe("countFutileRestart / budgetIsUnreachable", () => {
  it("counts a restart that came back over the line within a minute", () => {
    expect(countFutileRestart(0, 12_000)).toBe(1);
    expect(countFutileRestart(1, 30_000)).toBe(2);
    expect(budgetIsUnreachable(countFutileRestart(2, 5_000))).toBe(true);
  });

  it("resets when the server ran a long time before needing another", () => {
    // Real growth takes minutes here — about thirty route requests to cross
    // 8 GB — so a restart an hour later is the supervisor working, not thrashing.
    expect(countFutileRestart(2, 20 * 60_000)).toBe(0);
  });

  it("does not count the first restart of a session", () => {
    expect(countFutileRestart(0, null)).toBe(0);
  });

  it("needs three in a row before giving up", () => {
    expect(budgetIsUnreachable(0)).toBe(false);
    expect(budgetIsUnreachable(2)).toBe(false);
    expect(budgetIsUnreachable(3)).toBe(true);
  });

  it("does not treat the post-restart dip as relief", () => {
    // The bug in the first version of this check: a restarted server boots at
    // ~150 MB and is briefly under any budget, so "did it ever go under?" was
    // always yes and the check never fired. Elapsed time cannot be fooled that
    // way — three quick restarts still count as three.
    let futile = 0;
    for (const gap of [null, 8_000, 9_000, 7_000]) futile = countFutileRestart(futile, gap);
    expect(futile).toBe(3);
    expect(budgetIsUnreachable(futile)).toBe(true);
  });
});

describe("lineSplitter", () => {
  it("joins a line split across two chunks, which is what a data event does", () => {
    // The failure this exists for: Next's port banner arriving as
    // "- Local:   http://localho" + "st:3001\n" matched neither reader, so the
    // health probe knocked on the requested port for its whole deadline.
    const split = lineSplitter();
    expect(split.push("- Local:   http://localho")).toEqual([]);
    expect(split.push("st:3001\n")).toEqual(["- Local:   http://localhost:3001"]);
  });

  it("returns every complete line in one chunk and holds back the tail", () => {
    const split = lineSplitter();
    expect(split.push("one\ntwo\nthr")).toEqual(["one", "two"]);
    expect(split.push("ee\n")).toEqual(["three"]);
  });

  it("flushes an unterminated last line, which is what a dying process leaves", () => {
    // `⨯ Another next dev server is already running.` with no trailing newline
    // decides whether the supervisor retries or stands down.
    const split = lineSplitter();
    expect(split.push("⨯ Another next dev server is already running.")).toEqual([]);
    expect(split.flush()).toEqual(["⨯ Another next dev server is already running."]);
    expect(split.flush()).toEqual([]);
  });

  it("holds nothing back when the chunk ends on a newline", () => {
    const split = lineSplitter();
    expect(split.push("done\n")).toEqual(["done"]);
    expect(split.flush()).toEqual([]);
  });
});

describe("portInUseFromLine", () => {
  it("reads Next's own drift notice", () => {
    expect(
      portInUseFromLine(
        "⚠ Port 3000 is in use by an unknown process, using available port 3001 instead.",
      ),
    ).toEqual({ requested: 3000, chosen: 3001 });
  });

  it("is null for the refusal Next prints when this directory already has a dev server", () => {
    // That message carries a `- Local: http://localhost:3210` naming the
    // *running* server, and reading it as a drift contradicts a message that is
    // already right — which is exactly what the first version of this did.
    expect(portInUseFromLine("⨯ Another next dev server is already running.")).toBeNull();
    expect(portInUseFromLine("- Local:        http://localhost:3210")).toBeNull();
  });

  it("is null for the ordinary banner", () => {
    expect(portInUseFromLine("- Local:         http://localhost:3000")).toBeNull();
  });
});

describe("databaseDescription", () => {
  it("names the embedded database and where it lives", () => {
    expect(databaseDescription({})).toBe("PGlite in .pglite");
    expect(databaseDescription({ PGLITE_DATA_DIR: ".pglite-e2e" })).toBe("PGlite in .pglite-e2e");
    expect(databaseDescription({ PGLITE_DATA_DIR: "memory" })).toBe("PGlite, in memory");
  });

  it("says plainly when DATABASE_URL has repointed local dev at a real Postgres", () => {
    // The failure this exists for: `pnpm infra:deploy` writes and overwrites
    // `.env.local`, and a stale one silently moves local development onto a
    // real database with nothing else in the boot output to say so.
    expect(databaseDescription({ DATABASE_URL: "postgres://u:p@db.example.com:5432/app" })).toBe(
      "postgres at db.example.com:5432 (DATABASE_URL is set — this is not the embedded local database)",
    );
  });

  it("still reports a set-but-unparseable DATABASE_URL rather than throwing", () => {
    expect(databaseDescription({ DATABASE_URL: "not-a-url" })).toContain("a configured host");
  });

  it("carries no credential out of the connection string", () => {
    const said = databaseDescription({ DATABASE_URL: "postgres://user:secret@db.example.com/app" });
    expect(said).not.toContain("secret");
    expect(said).not.toContain("user");
  });
});

/**
 * Issue #1882: a `next-server` killed mid-compile left `.next/dev` describing a
 * route it never finished, and every later server — restarts and clean starts
 * alike — answered that route 404 before any page code ran. The supervisor
 * marks `.next/dev` in use while a child owns it and clears the mark only on a
 * clean exit, so the state a killed server leaves is thrown away before the
 * next one restores it.
 */
describe("abandoned dev state", () => {
  const roots = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A checkout with the `.next/dev` a server leaves behind. */
  function checkout({ lockPid } = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), "dev-state-"));
    roots.push(root);
    const dev = path.join(root, ".next/dev");
    mkdirSync(path.join(dev, "cache/turbopack"), { recursive: true });
    mkdirSync(path.join(dev, "server/app"), { recursive: true });
    mkdirSync(path.join(dev, "logs"), { recursive: true });
    writeFileSync(path.join(dev, "cache/turbopack/00000007.sst"), "persisted");
    writeFileSync(path.join(dev, "routes-manifest.json"), "{}");
    writeFileSync(path.join(dev, "logs/next-development.log"), "why it died");
    if (lockPid !== undefined)
      writeFileSync(path.join(dev, "lock"), JSON.stringify({ pid: lockPid }));
    return root;
  }
  const at = (root, file) => existsSync(path.join(root, file));

  it("throws away everything a killed server left except Next's logs", () => {
    const root = checkout({ lockPid: 4242 });
    markDevStateInUse(root);
    // The child was killed: nothing cleared the mark.
    expect(discardAbandonedDevState(root, { alive: () => false })).toBe(true);
    expect(at(root, ".next/dev/cache/turbopack")).toBe(false);
    expect(at(root, ".next/dev/routes-manifest.json")).toBe(false);
    expect(at(root, ".next/dev/server")).toBe(false);
    expect(at(root, ".next/dev/lock")).toBe(false);
    expect(at(root, DEV_STATE_IN_USE_MARKER)).toBe(false);
    expect(at(root, ".next/dev/logs/next-development.log")).toBe(true);
  });

  it("keeps the warm cache a cleanly stopped server left", () => {
    const root = checkout();
    markDevStateInUse(root);
    markDevStateClean(root);
    expect(discardAbandonedDevState(root, { alive: () => false })).toBe(false);
    expect(at(root, ".next/dev/cache/turbopack/00000007.sst")).toBe(true);
  });

  it("keeps a checkout no supervised server has used", () => {
    const root = checkout();
    expect(discardAbandonedDevState(root, { alive: () => false })).toBe(false);
    expect(at(root, ".next/dev/cache/turbopack/00000007.sst")).toBe(true);
  });

  it("never deletes state under a server that is still running", () => {
    // Another server holds the checkout; Next will refuse this start on its own,
    // and deleting `.next/dev` from under the live one would break it.
    const root = checkout({ lockPid: 4242 });
    markDevStateInUse(root);
    expect(discardAbandonedDevState(root, { alive: (pid) => pid === 4242 })).toBe(false);
    expect(at(root, ".next/dev/cache/turbopack/00000007.sst")).toBe(true);
    expect(at(root, DEV_STATE_IN_USE_MARKER)).toBe(true);
  });

  it("treats a lock naming a dead process as no lock", () => {
    const root = checkout({ lockPid: 4242 });
    markDevStateInUse(root);
    expect(discardAbandonedDevState(root, { alive: () => false })).toBe(true);
  });

  it("decides on the mark and the lock together", () => {
    expect(devStateIsAbandoned({ markerPresent: true, lockHolderAlive: false })).toBe(true);
    expect(devStateIsAbandoned({ markerPresent: true, lockHolderAlive: true })).toBe(false);
    expect(devStateIsAbandoned({ markerPresent: false, lockHolderAlive: false })).toBe(false);
  });

  it("works on a checkout with no .next at all", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dev-state-"));
    roots.push(root);
    expect(discardAbandonedDevState(root)).toBe(false);
    markDevStateInUse(root);
    expect(at(root, DEV_STATE_IN_USE_MARKER)).toBe(true);
  });
});

describe("formatMb", () => {
  it("rounds to whole megabytes", () => {
    expect(formatMb(1536 * MB)).toBe("1536 MB");
    expect(formatMb(1_500_000)).toBe("1 MB");
  });
});
