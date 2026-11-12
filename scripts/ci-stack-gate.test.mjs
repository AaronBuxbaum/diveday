import { describe, expect, it } from "vitest";

import { decide, gate, resolveDiffScope } from "./ci-stack-gate.mjs";

const stack = (number, ...prs) => ({ number, pull_requests: prs.map((n) => ({ number: n })) });

describe("decide", () => {
  it("runs the top layer", () => {
    expect(decide({ number: 3, baseIsDefault: false, stacks: [stack(9, 1, 2, 3)] }).run).toBe(true);
  });
  it("skips every layer below the top and names the one that runs", () => {
    const result = decide({ number: 2, baseIsDefault: false, stacks: [stack(9, 1, 2, 3)] });
    expect(result.run).toBe(false);
    expect(result.why).toContain("CI runs on #3");
  });
  it("names the bottom layer so the diff base can be the stack's own", () => {
    expect(decide({ number: 3, baseIsDefault: false, stacks: [stack(9, 1, 2, 3)] }).bottom).toBe(1);
  });
  it("runs a lower layer that carries the ci-now label", () => {
    const stacks = [stack(9, 1, 2, 3)];
    expect(decide({ number: 2, baseIsDefault: false, stacks, labels: ["ci-now"] }).run).toBe(true);
    expect(decide({ number: 2, baseIsDefault: false, stacks, labels: ["P2"] }).run).toBe(false);
  });
  it("runs a pull request on the default branch that is in no stack", () => {
    expect(decide({ number: 5, baseIsDefault: true, stacks: [stack(9, 1, 2)] }).run).toBe(true);
  });
  it("waits on a chained base that is not registered yet", () => {
    expect(decide({ number: 5, baseIsDefault: false, stacks: [] }).run).toBeNull();
  });
});

describe("gate", () => {
  const env = {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: "2",
    PR_BASE_REF: "x",
    DEFAULT_BRANCH: "main",
  };
  it("runs anything that is not a pull request", async () => {
    expect((await gate({ GITHUB_EVENT_NAME: "push" }, async () => [])).run).toBe(true);
  });
  it("retries until the stack registers, then skips a lower layer", async () => {
    let calls = 0;
    const result = await gate(
      env,
      async () => (++calls < 3 ? [] : [stack(9, 1, 2, 3)]),
      async () => {},
    );
    expect(result.run).toBe(false);
    expect(calls).toBe(3);
  });
  it("runs rather than wait forever for a registration", async () => {
    expect(
      (
        await gate(
          env,
          async () => [],
          async () => {},
        )
      ).run,
    ).toBe(true);
  });
  it("fails open when the API errors", async () => {
    const result = await gate(env, async () => {
      throw new Error("HTTP 500");
    });
    expect(result.run).toBe(true);
  });
});

describe("change-detection scope", () => {
  const env = { DEFAULT_BRANCH: "main" };
  const sha = "a".repeat(40);
  it("forces every check after unregistered-base timeout or API failure", async () => {
    const input = {
      GITHUB_EVENT_NAME: "pull_request",
      PR_NUMBER: "2",
      PR_BASE_REF: "layer",
      ...env,
    };
    for (const fetchStacks of [
      async () => [],
      async () => {
        throw new Error("HTTP 500");
      },
    ]) {
      const decision = await gate(input, fetchStacks, async () => {});
      expect(
        await resolveDiffScope(decision, env, async () => {
          throw new Error("unexpected lookup");
        }),
      ).toMatchObject({ run: true, forceFull: true, diffBase: "" });
    }
  });
  it("keeps an ordinary standalone PR and skipped lower layer scoped", async () => {
    for (const decision of [
      decide({ number: 5, baseIsDefault: true, stacks: [] }),
      decide({ number: 2, stacks: [stack(9, 1, 2, 3)] }),
    ]) {
      expect(
        await resolveDiffScope(decision, env, async () => {
          throw new Error("unexpected lookup");
        }),
      ).toMatchObject({ forceFull: false, diffBase: "" });
    }
  });
  it("uses the validated registered bottom's default-branch base", async () => {
    const decision = decide({ number: 3, stacks: [stack(9, 1, 2, 3)] });
    expect(
      await resolveDiffScope(decision, env, async (number) => {
        expect(number).toBe(1);
        return { base: { sha, ref: "main" } };
      }),
    ).toMatchObject({ forceFull: false, diffBase: sha });
  });
  it("forces full scope for failed, malformed or nondefault bottom-base lookups", async () => {
    const decision = decide({ number: 3, stacks: [stack(9, 1, 2, 3)] });
    for (const read of [
      async () => {
        throw new Error("HTTP 500");
      },
      async () => ({ base: { sha: "", ref: "main" } }),
      async () => ({ base: { sha, ref: "layer" } }),
    ]) {
      expect(await resolveDiffScope(decision, env, read)).toMatchObject({
        run: true,
        forceFull: true,
        diffBase: "",
      });
    }
  });
});
