import { describe, expect, it } from "vitest";

import { COMMIT_SHA, resolveRegSuitKeys } from "./reg-suit-keys.mjs";

const HEAD = "1111111111111111111111111111111111111111";
const PARENT = "2222222222222222222222222222222222222222";
const LAYER_ONE_HEAD = "3333333333333333333333333333333333333333";
const MAIN_FORK = "4444444444444444444444444444444444444444";

/**
 * A stub `git` reader. Keys are the argv joined by a space, which keeps each
 * test's expectations readable as the commands they stand for; anything not
 * listed throws, exactly as `git` does for an unknown ref.
 */
function git(answers) {
  return (args) => {
    const key = args.join(" ");
    if (!(key in answers)) throw new Error(`stub git: no answer for \`git ${key}\``);
    return answers[key];
  };
}

describe("resolveRegSuitKeys", () => {
  it("keys a pull request to its fork point from the base branch", () => {
    const keys = resolveRegSuitKeys({
      env: { GITHUB_EVENT_NAME: "pull_request", PR_BASE_REF: "main", PR_HEAD_SHA: HEAD },
      git: git({ "rev-parse HEAD": HEAD, "merge-base origin/main HEAD": MAIN_FORK }),
    });
    expect(keys).toMatchObject({ actualKey: HEAD, expectedKey: MAIN_FORK, stacked: false });
  });

  // The whole of the change in ADR 20260919-stack-ci-cancels-superseded-layers,
  // in one assertion. A stacked layer used to be keyed to the layer below's
  // head, which only the layer below's own run could publish — so the layer
  // above waited on it, and every middle layer had to spend six jobs to keep
  // that promise. The fork point from `main` was published by `main`'s own run
  // long ago, so nothing waits and a middle layer can skip everything.
  it("keys a stacked layer to the stack's fork point from main, not the layer below", () => {
    const keys = resolveRegSuitKeys({
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_BASE_REF: "claude/thing-1-schema",
        PR_HEAD_SHA: HEAD,
        DEFAULT_BRANCH: "main",
      },
      git: git({
        "rev-parse HEAD": HEAD,
        "merge-base origin/main HEAD": MAIN_FORK,
        // Present, and deliberately never asked for.
        "merge-base origin/claude/thing-1-schema HEAD": LAYER_ONE_HEAD,
      }),
    });
    expect(keys).toMatchObject({ actualKey: HEAD, expectedKey: MAIN_FORK, stacked: true });
  });

  // An auto-merged layer deletes its head branch, and this job runs 6-10
  // minutes after the run starts. Only for a pull request that targets the
  // default branch: for a stacked layer `PR_BASE_SHA` *is* the layer below's
  // head, and falling back to it would key exactly the commit this no longer
  // wants to depend on.
  it("falls back to the event's base sha when the base branch is gone", () => {
    const keys = resolveRegSuitKeys({
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_BASE_REF: "main",
        PR_BASE_SHA: MAIN_FORK,
        PR_HEAD_SHA: HEAD,
      },
      git: git({ "rev-parse HEAD": HEAD, [`merge-base ${MAIN_FORK} HEAD`]: MAIN_FORK }),
    });
    expect(keys.expectedKey).toBe(MAIN_FORK);
  });

  it("refuses the layer below's head as a fallback for a stacked layer", () => {
    const keys = resolveRegSuitKeys({
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_BASE_REF: "claude/thing-1-schema",
        PR_BASE_SHA: LAYER_ONE_HEAD,
        PR_HEAD_SHA: HEAD,
      },
      // `origin/main` is not in the checkout, so there is no fork point to find.
      git: git({ "rev-parse HEAD": HEAD }),
    });
    expect(keys.expectedKey).toBeNull();
    expect(keys.source).toBe("nothing to compare against");
  });

  it("keys a push to main to the previous commit", () => {
    const keys = resolveRegSuitKeys({
      env: { GITHUB_EVENT_NAME: "push" },
      git: git({ "rev-parse HEAD": HEAD, "rev-parse HEAD^": PARENT }),
    });
    expect(keys).toMatchObject({ actualKey: HEAD, expectedKey: PARENT, stacked: false });
  });

  it("keys a local run on a topic branch to its fork point from main", () => {
    const keys = resolveRegSuitKeys({
      env: {},
      git: git({
        "rev-parse HEAD": HEAD,
        "rev-parse main": MAIN_FORK,
        "merge-base origin/main HEAD": MAIN_FORK,
      }),
    });
    expect(keys.expectedKey).toBe(MAIN_FORK);
  });

  it("keys a local run on main itself to the previous commit", () => {
    const keys = resolveRegSuitKeys({
      env: {},
      git: git({ "rev-parse HEAD": HEAD, "rev-parse main": HEAD, "rev-parse HEAD^": PARENT }),
    });
    expect(keys.expectedKey).toBe(PARENT);
  });

  // Comparing a commit against itself resolves a baseline that is this run's
  // own upload, so every surface passes against a copy of itself.
  it("never compares a commit against itself", () => {
    const keys = resolveRegSuitKeys({
      env: { GITHUB_EVENT_NAME: "pull_request", PR_BASE_REF: "main" },
      git: git({
        "rev-parse HEAD": HEAD,
        "merge-base origin/main HEAD": HEAD,
        "rev-parse HEAD^": PARENT,
      }),
    });
    expect(keys.expectedKey).toBe(PARENT);
  });

  it("returns a null expected key rather than inventing one", () => {
    const keys = resolveRegSuitKeys({
      env: { GITHUB_EVENT_NAME: "push" },
      git: git({ "rev-parse HEAD": HEAD }),
    });
    expect(keys).toMatchObject({ actualKey: HEAD, expectedKey: null });
  });

  // The whole published history is keyed by 40-character sha. A prettier key
  // makes every baseline in the bucket unreachable, and the first symptom is a
  // push to main reporting every surface as new.
  it("only ever produces full commit shas", () => {
    const keys = resolveRegSuitKeys({
      env: { GITHUB_EVENT_NAME: "push" },
      git: git({ "rev-parse HEAD": `${HEAD}\n`, "rev-parse HEAD^": `${PARENT}\n` }),
    });
    expect(keys.actualKey).toMatch(COMMIT_SHA);
    expect(keys.expectedKey).toMatch(COMMIT_SHA);
  });

  it("refuses a checkout that is not the pull request's head commit", () => {
    expect(() =>
      resolveRegSuitKeys({
        env: { GITHUB_EVENT_NAME: "pull_request", PR_BASE_REF: "main", PR_HEAD_SHA: PARENT },
        git: git({ "rev-parse HEAD": HEAD }),
      }),
    ).toThrow(/head/i);
  });

  it("refuses a base ref that could not be a ref", () => {
    expect(() =>
      resolveRegSuitKeys({
        env: { GITHUB_EVENT_NAME: "pull_request", PR_BASE_REF: "main; rm -rf /" },
        git: git({ "rev-parse HEAD": HEAD }),
      }),
    ).toThrow(/base ref/);
  });
});
