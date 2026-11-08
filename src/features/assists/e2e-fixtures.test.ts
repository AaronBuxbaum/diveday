import { afterEach, describe, expect, it } from "vitest";
import { importMappingCall } from "../../lib/assists/import-mapping";
import { groundedReply, inboundTriageCall, replyDraftCall } from "../../lib/assists/inbox";
import { callStructured } from "../../lib/claude/structured";
import { benchNoteCall } from "../bench-note/rules";
import { websiteReadingCall } from "../website-reading/rules";
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

  it("answers the front-of-house features too, each passing its own guard", async () => {
    armClaudeFixtures("shop-1", true);
    const provider = e2eClaudeFixtureProvider("shop-1", fleet);
    if (!provider) throw new Error("expected a provider");
    const triage = await callStructured(
      provider,
      inboundTriageCall({
        subject: null,
        body: "Hola, podemos cambiar el buceo?",
        targetLocale: "en-US",
      }),
    );
    expect(triage.value?.translation).toBeTruthy();
    const facts = ["Morning two-tank: 4 seats open"];
    const thread = [{ from: "diver" as const, text: "Can we move to tomorrow?" }];
    const draft = await callStructured(provider, replyDraftCall({ window: "", facts, thread }));
    expect(draft.value && groundedReply(draft.value, { facts, thread })).toBeTruthy();
    const mapping = await callStructured(
      provider,
      importMappingCall({
        columns: [{ header: "Mobile No", samples: ["+1 •••"] }],
        levelSpellings: [],
      }),
    );
    expect(mapping.value?.columns).toEqual([{ header: "Mobile No", field: "phone" }]);
    const call = websiteReadingCall({ site: "reef-divers.com", currency: "usd", courses: [] });
    if (!call) throw new Error("expected a call");
    expect((await callStructured(provider, call)).outcome).toBe("ok");
  });
});
