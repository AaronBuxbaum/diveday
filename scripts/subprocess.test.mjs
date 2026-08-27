// The wedged-subprocess cases these cover are the ones that hung `pnpm check`
// permanently on a cloud runner (2026-08-14): a child that never exits, with no
// output and no diagnosis. Each case below wedges a real `sleep` and asserts
// the wrapper stops waiting, says which command it stopped waiting on, and
// carries nothing from the child's environment into that message.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isTimeout,
  readBounded,
  runBounded,
  SUBPROCESS_TIMEOUTS,
  TIMEOUT_EXIT_CODE,
} from "./subprocess.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * `sleep` is the wedge: a child that will outlive any bound this suite sets and
 * exits only when killed, which is what a hung `git`/`aws`/`cdk` looks like
 * from the parent's side.
 */
const WEDGE = ["sleep", ["30"]];

describe("runBounded", () => {
  it("kills a wedged child and reports which command it was", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = runBounded(...WEDGE, { timeoutMs: 250, stdio: "ignore" });

    expect(isTimeout(result)).toBe(true);
    expect(result.status).toBe(TIMEOUT_EXIT_CODE);
    expect(result.error.message).toContain("sleep 30");
    expect(result.error.message).toContain("0.25s");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("sleep 30"));
    error.mockRestore();
  });

  it("leaves an ordinary run untouched", () => {
    const result = runBounded("node", ["-e", "process.stdout.write('ok')"], {
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(isTimeout(result)).toBe(false);
  });

  it("leaves an ordinary non-zero exit distinguishable from a timeout", () => {
    const result = runBounded("node", ["-e", "process.exit(3)"], {
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
      stdio: "ignore",
    });

    expect(result.status).toBe(3);
    expect(isTimeout(result)).toBe(false);
  });

  it("refuses a call with no bound at all -- the failure this whole module exists to prevent", () => {
    expect(() => runBounded("node", ["-e", ""])).toThrow(/SUBPROCESS_TIMEOUTS/);
  });
});

describe("readBounded", () => {
  it("throws a timeout naming the command rather than Node's bare ETIMEDOUT", () => {
    let thrown;
    try {
      readBounded(...WEDGE, { timeoutMs: 250, stdio: "ignore" });
    } catch (error) {
      thrown = error;
    }

    expect(isTimeout(thrown)).toBe(true);
    // Node's own text is `spawnSync sleep ETIMEDOUT` -- it names neither the
    // subcommand that wedged nor the bound it blew.
    expect(thrown.message).toContain("sleep 30");
    expect(thrown.message).toContain("did not finish within");
  });

  it("rethrows an ordinary failure untouched, so a caller reading stderr still sees it", () => {
    let thrown;
    try {
      readBounded("node", ["-e", "process.stderr.write('ParameterNotFound'); process.exit(1)"], {
        timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      thrown = error;
    }

    // import-vercel-env.mjs's readCheckpoint() tests exactly this string to tell
    // "nothing synced yet" from a real permissions failure.
    expect(thrown.stderr.toString()).toContain("ParameterNotFound");
    expect(isTimeout(thrown)).toBe(false);
  });

  it("returns stdout unchanged", () => {
    expect(
      readBounded("node", ["-e", "process.stdout.write('ok')"], {
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
      }),
    ).toBe("ok");
  });

  it("refuses a call with no bound", () => {
    expect(() => readBounded("node", ["-e", ""])).toThrow(/SUBPROCESS_TIMEOUTS/);
  });
});

describe("the timeout message", () => {
  it("carries nothing from the child's environment or its stdin", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = runBounded(...WEDGE, {
      timeoutMs: 250,
      stdio: "ignore",
      env: { AWS_SECRET_ACCESS_KEY: "sk-not-in-any-message", PATH: process.env.PATH },
    });

    // Half these call sites run with live AWS credentials in `env` and one
    // writes a secret to the child's stdin. The call sites carry CodeQL
    // clear-text-logging comments saying so; this is the wrapper's half of it.
    const printed = error.mock.calls.flat().join("\n");
    expect(printed).not.toContain("sk-not-in-any-message");
    expect(result.error.message).not.toContain("sk-not-in-any-message");
    error.mockRestore();
  });
});

describe("scripts/", () => {
  it("has no unbounded subprocess call left in it", () => {
    // The durable half of the fix. Bounding today's call sites one by one only
    // holds until somebody adds the next `spawnSync`, which is how the class
    // survived long enough to hang a cloud runner in the first place. The rule
    // is import-level rather than call-level on purpose: it is exact, it needs
    // no parser, and `scripts/subprocess.mjs` is the one door.
    const exempt = new Map([
      [
        "subprocess.mjs",
        "the wrappers themselves -- this is the module every other script goes through",
      ],
      [
        "check-repo.mjs",
        "already bounded, and by a stronger mechanism: an async detached process group SIGKILLed as a whole, which spawnSync cannot do",
      ],
      [
        "check-all.mjs",
        "the gate one level above check-repo.mjs, and bounded the same way: each phase is an async detached process group SIGKILLed as a whole on its own deadline, which is what a vitest run needs -- a spawnSync timeout kills the parent and leaves its pool of forks holding databases",
      ],
      [
        "e2e-server.mjs",
        "an intentionally long-lived async supervisor; its detached process group is the bound and its signal/exit handlers reap the whole group",
      ],
    ]);

    const offenders = readdirSync(HERE)
      .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
      .filter((name) => !exempt.has(name))
      .filter((name) =>
        /from "node:child_process"/.test(readFileSync(path.join(HERE, name), "utf8")),
      );

    expect(
      offenders,
      `${offenders.join(", ")}: import from scripts/subprocess.mjs instead, so the call carries a timeout`,
    ).toEqual([]);
  });
});
