import { describe, expect, it } from "vitest";
import {
  containedLayer,
  readPullRequestBase,
  resolveVerificationBase,
} from "./verification-base.mjs";

const fake = (answers) => (args) => answers[args.join(" ")] ?? null;
describe("verification parent policy", () => {
  for (const provider of ["codex", "claude", "feature"])
    it(`uses actual ${provider} PR base over config`, () => {
      expect(
        resolveVerificationBase(
          fake({
            "rev-parse --verify --quiet origin/main": "main",
            [`rev-parse --verify --quiet origin/${provider}/parent`]: "parent",
          }),
          { prBase: `${provider}/parent`, explicitBase: "main", env: {} },
        ),
      ).toMatchObject({ ref: `origin/${provider}/parent`, source: "pull-request" });
    });
  it("uses the hosted PR base ahead of a configured local layer", () => {
    expect(
      resolveVerificationBase(
        fake({
          "rev-parse --abbrev-ref HEAD": "codex/top",
          "config --get branch.codex/top.divedayBase": "origin/codex/middle",
          "rev-parse --verify --quiet origin/main": "main",
          "rev-parse --verify --quiet origin/codex/middle": "middle",
        }),
        { env: { GITHUB_BASE_REF: "main" } },
      ),
    ).toMatchObject({
      ref: "origin/main",
      source: "pull-request",
    });
  });
  it("does not guess a merged side branch or use push upstream", () => {
    expect(
      resolveVerificationBase(
        fake({
          "rev-parse --abbrev-ref HEAD": "codex/task",
          "rev-parse --verify --quiet origin/main": "main",
          "rev-parse --abbrev-ref @{upstream}": "origin/codex/task",
        }),
        { env: {} },
      ),
    ).toMatchObject({ ref: "origin/main", source: "conservative-fallback" });
  });
  it("finds the layer below a stacked branch with no PR and no config", () => {
    const git = fake({
      "rev-parse HEAD": "top",
      "rev-parse --abbrev-ref HEAD": "claude/top",
      "for-each-ref --format=%(refname:short) --merged HEAD refs/remotes/origin":
        "origin/main\norigin/claude/top\norigin/claude/bottom\norigin/claude/mid\norigin/old",
      "rev-parse origin/claude/top": "top",
      "rev-parse origin/claude/bottom": "b",
      "rev-parse origin/claude/mid": "m",
      "rev-parse origin/old": "o",
      "rev-list --count origin/main..origin/claude/bottom": "3",
      "rev-list --count origin/main..origin/claude/mid": "7",
      "rev-list --count origin/main..origin/old": "0",
      "rev-parse --verify --quiet origin/claude/mid": "m",
      "rev-parse --verify --quiet origin/main": "main",
    });
    expect(containedLayer(git)).toBe("origin/claude/mid");
    expect(resolveVerificationBase(git, { env: {} })).toMatchObject({
      ref: "origin/claude/mid",
      source: "stack",
      warning: null,
    });
  });
  it("falls back broadly when configured parent was deleted", () => {
    expect(
      resolveVerificationBase(fake({ "rev-parse --verify --quiet origin/main": "main" }), {
        prBase: "deleted",
        explicitBase: "wrong",
        env: {},
      }).ref,
    ).toBe("origin/main");
  });
  it("refuses to guess without history", () =>
    expect(resolveVerificationBase(fake({}), { env: {} }).ref).toBeNull());
  it("degrades offline and rejects ambiguous open PRs", () => {
    const git = fake({
      "rev-parse --abbrev-ref HEAD": "topic",
      "remote get-url origin": "git@github.com:owner/repo.git",
    });
    expect(
      readPullRequestBase(git, {
        run: () => {
          throw new Error("offline");
        },
      }),
    ).toBeNull();
    expect(
      readPullRequestBase(git, {
        run: () => JSON.stringify([{ base: { ref: "main" } }, { base: { ref: "other" } }]),
      }),
    ).toBeNull();
    expect(
      readPullRequestBase(git, { run: () => JSON.stringify([{ base: { ref: "topic/parent" } }]) }),
    ).toBe("topic/parent");
  });
});
