import { afterEach, describe, expect, it } from "vitest";
import { callStructured } from "@/lib/claude/structured";
import { benchNoteCall } from "./bench-note";
import { armClaudeFixtures, e2eClaudeFixtureProvider } from "./e2e-fixtures";

const fleet = { DIVEDAY_E2E: "1" };

afterEach(() => armClaudeFixtures("shop-1", false));

describe("e2eClaudeFixtureProvider", () => {
  it("answers only for an armed shop inside the fleet", () => {
    expect(e2eClaudeFixtureProvider("shop-1", fleet)).toBeNull();
    armClaudeFixtures("shop-1", true);
    expect(e2eClaudeFixtureProvider("shop-1", fleet)).not.toBeNull();
    expect(e2eClaudeFixtureProvider("shop-2", fleet)).toBeNull();
  });

  it("is never available with a real database or outside the fleet", () => {
    armClaudeFixtures("shop-1", true);
    expect(
      e2eClaudeFixtureProvider("shop-1", { ...fleet, DATABASE_URL: "postgres://x" }),
    ).toBeNull();
    expect(e2eClaudeFixtureProvider("shop-1", {})).toBeNull();
  });

  it("answers each feature from its fixture, valid against the feature's schema", async () => {
    armClaudeFixtures("shop-1", true);
    const provider = e2eClaudeFixtureProvider("shop-1", fleet);
    if (!provider) throw new Error("expected a provider");
    const result = await callStructured(
      provider,
      benchNoteCall({
        reportedProblem: "Leaks",
        technicianNotes: "New o-ring",
        outcome: null,
        locale: "en-US",
      }),
    );
    expect(result.outcome).toBe("ok");
  });
});
