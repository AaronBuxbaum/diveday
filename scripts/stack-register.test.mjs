import { expect, it, describe as suite } from "vitest";

import { chainThrough, describe, MAX_LAYERS, planRegistration, run } from "./stack-register.mjs";

/**
 * The registrar acts unattended on every pull request event, so both halves of
 * its judgement are pinned here: which pull requests it decides are one chain,
 * and what it does about a repository that already holds part of that chain.
 *
 * Getting either wrong is expensive in a way CI cannot report. A chain read in
 * the wrong order registers a merge order nobody chose, and a stack merges
 * bottom-up and atomically — so the first thing anyone learns about a wrong
 * order is that the wrong pull request has landed. Every shape this cannot
 * account for therefore has a test asserting it is *refused* rather than
 * guessed at.
 */

/** A pull request, as much of one as the planner reads. */
const pr = (number, head, base) => ({ number, head: { ref: head }, base: { ref: base } });

/** A three-layer chain: #1 on main, #2 on #1's branch, #3 on #2's. */
const chain3 = [pr(1, "l1", "main"), pr(2, "l2", "l1"), pr(3, "l3", "l2")];

suite("chainThrough", () => {
  it("walks down to the default branch from the top layer", () => {
    const { chain } = chainThrough(chain3, chain3[2], "main");
    expect(chain.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("walks up as well, so an event on the bottom layer still sees the chain", () => {
    const { chain } = chainThrough(chain3, chain3[0], "main");
    expect(chain.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("walks both ways from a middle layer", () => {
    const { chain } = chainThrough(chain3, chain3[1], "main");
    expect(chain.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("is a chain of one for an ordinary pull request on the default branch", () => {
    const { chain } = chainThrough([pr(1, "l1", "main")], pr(1, "l1", "main"), "main");
    expect(chain.map((p) => p.number)).toEqual([1]);
  });

  it("refuses a chain whose bottom is based on a branch with no pull request", () => {
    const orphan = [pr(2, "l2", "l1")];
    expect(chainThrough(orphan, orphan[0], "main").error).toMatch(/neither `main`/);
  });

  it("refuses a fork, where two layers share one base", () => {
    const forked = [...chain3, pr(4, "l4", "l2")];
    expect(chainThrough(forked, forked[0], "main").error).toMatch(/forks and is not a stack/);
  });

  it("refuses a fork below where the walk started, which neither walk can see", () => {
    // #3's own chain down to main is [1, 2, 3] and reads perfectly linear; the
    // branch point is at l2, below it. Registering it would leave #4 looking
    // like an ordinary extension of a stack whose top is not #4's base.
    const forked = [...chain3, pr(4, "l4", "l2")];
    expect(chainThrough(forked, forked[2], "main").error).toMatch(/forks and is not a stack/);
  });

  it("refuses a cycle rather than looping", () => {
    const cyclic = [pr(1, "a", "b"), pr(2, "b", "a")];
    expect(chainThrough(cyclic, cyclic[0], "main").error).toMatch(/cycle/);
  });

  it("refuses two open pull requests sharing a head branch", () => {
    const twinned = [pr(1, "l1", "main"), pr(2, "l1", "main")];
    expect(chainThrough(twinned, twinned[0], "main").error).toMatch(/share the head branch/);
  });

  it("reads a default branch that is not called main", () => {
    const onTrunk = [pr(1, "l1", "trunk"), pr(2, "l2", "l1")];
    expect(chainThrough(onTrunk, onTrunk[1], "trunk").chain.map((p) => p.number)).toEqual([1, 2]);
  });
});

suite("planRegistration", () => {
  it("registers a chain no stack holds", () => {
    expect(planRegistration(chain3, [])).toEqual({ op: "create", numbers: [1, 2, 3] });
  });

  it("does nothing for a chain of one", () => {
    expect(planRegistration([chain3[0]], []).op).toBe("skip");
  });

  it("refuses a chain past GitHub's layer cap instead of sending a doomed request", () => {
    const long = Array.from({ length: MAX_LAYERS + 1 }, (_, i) =>
      pr(i + 1, `l${i + 1}`, i === 0 ? "main" : `l${i}`),
    );
    expect(planRegistration(long, []).op).toBe("refuse");
  });

  it("does nothing when the stack already holds every layer", () => {
    const stacks = [{ number: 9, pull_requests: [{ number: 1 }, { number: 2 }, { number: 3 }] }];
    expect(planRegistration(chain3, stacks)).toEqual({
      op: "none",
      stack: 9,
      why: "already registered",
    });
  });

  it("extends a stack that holds the bottom of the chain", () => {
    const stacks = [{ number: 9, pull_requests: [{ number: 1 }, { number: 2 }] }];
    expect(planRegistration(chain3, stacks)).toEqual({ op: "add", stack: 9, numbers: [3] });
  });

  it("extends by more than one layer at a time", () => {
    const stacks = [{ number: 9, pull_requests: [{ number: 1 }] }];
    expect(planRegistration(chain3, stacks)).toEqual({ op: "add", stack: 9, numbers: [2, 3] });
  });

  it("refuses when the registered layers are not the bottom of the chain", () => {
    const stacks = [{ number: 9, pull_requests: [{ number: 2 }, { number: 3 }] }];
    const plan = planRegistration(chain3, stacks);
    expect(plan.op).toBe("refuse");
    expect(plan.why).toMatch(/not the bottom of this chain/);
  });

  it("refuses when the chain is spread across two stacks", () => {
    const stacks = [
      { number: 8, pull_requests: [{ number: 1 }] },
      { number: 9, pull_requests: [{ number: 3 }] },
    ];
    expect(planRegistration(chain3, stacks).op).toBe("refuse");
  });

  it("ignores stacks that hold none of this chain", () => {
    const stacks = [{ number: 8, pull_requests: [{ number: 99 }, { number: 98 }] }];
    expect(planRegistration(chain3, stacks)).toEqual({ op: "create", numbers: [1, 2, 3] });
  });

  it("tolerates a stack the API returned without a pull_requests list", () => {
    expect(planRegistration(chain3, [{ number: 8 }])).toEqual({ op: "create", numbers: [1, 2, 3] });
  });
});

suite("describe", () => {
  it("names the order it registered, so the log says what merges first", () => {
    expect(describe({ op: "create", numbers: [1, 2, 3] }, chain3)).toBe(
      "Registered #1 -> #2 -> #3 as a new stack.",
    );
  });

  it("says why it left a chain alone", () => {
    expect(describe({ op: "refuse", why: "the chain forks" }, chain3)).toBe(
      "Left alone: the chain forks.",
    );
  });
});

suite("run", () => {
  const env = {
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_TOKEN: "t",
    STACK_PULL_REQUEST: "3",
    STACK_DEFAULT_BRANCH: "main",
  };

  /**
   * A stand-in for the API. `stacks` is read fresh on every call, so a test can
   * mutate it between calls the way a concurrent run would.
   */
  const fake = ({ pulls = chain3, stacks = [], refuse = () => false } = {}) => {
    const calls = [];
    const call = async (pathname, init = {}) => {
      calls.push({ pathname, method: init.method ?? "GET", body: init.body });
      if (pathname.includes("/pulls?")) return pathname.includes("page=1") ? pulls : [];
      if (init.method === "POST" && refuse(calls)) throw new Error("422 Unprocessable Entity");
      if (init.method === "POST") return {};
      return stacks;
    };
    return { call, calls };
  };

  it("registers a chain, bottom to top", async () => {
    const { call, calls } = fake();
    expect(await run(env, call)).toBe("Registered #1 -> #2 -> #3 as a new stack.");
    const post = calls.find((c) => c.method === "POST");
    expect(post.pathname).toBe("/repos/owner/repo/stacks");
    expect(post.body).toEqual({ pull_requests: [1, 2, 3] });
  });

  it("writes nothing for a chain of one", async () => {
    const { call, calls } = fake({ pulls: [pr(3, "l3", "main")] });
    expect(await run(env, call)).toMatch(/chain of one/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("writes nothing when the chain is not linear", async () => {
    const forked = [...chain3, pr(4, "l4", "l2")];
    const { call, calls } = fake({ pulls: forked });
    expect(await run(env, call)).toMatch(/forks and is not a stack/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("reports success when a concurrent run registered the chain first", async () => {
    const stacks = [];
    const calls = [];
    const call = async (pathname, init = {}) => {
      calls.push({ pathname, method: init.method ?? "GET" });
      if (pathname.includes("/pulls?")) return pathname.includes("page=1") ? chain3 : [];
      if (init.method === "POST") {
        // the other run won between our read and our write
        stacks.push({ number: 7, pull_requests: [{ number: 1 }, { number: 2 }, { number: 3 }] });
        throw new Error("422 Unprocessable Entity");
      }
      return stacks;
    };
    expect(await run(env, call)).toMatch(/already stack #7.*concurrent run got there first/s);
  });

  it("rethrows when the refusal was not a lost race", async () => {
    const { call } = fake({ refuse: () => true });
    await expect(run(env, call)).rejects.toThrow(/422/);
  });

  it("refuses to run without its environment", async () => {
    const { call } = fake();
    await expect(run({ GITHUB_REPOSITORY: "owner/repo" }, call)).rejects.toThrow(
      /positive STACK_PULL_REQUEST/,
    );
  });

  it("refuses an unresolved pull request number rather than looking up #0", async () => {
    const { call, calls } = fake();
    await expect(run({ ...env, STACK_PULL_REQUEST: "" }, call)).rejects.toThrow(
      /positive STACK_PULL_REQUEST/,
    );
    expect(calls).toHaveLength(0);
  });
});
