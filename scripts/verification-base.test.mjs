import { describe, expect, it } from "vitest";
import { readPullRequestBase, resolveVerificationBase } from "./verification-base.mjs";

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
