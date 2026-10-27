import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * **What the waiver page is, and what it stopped being** — ADR
 * 20260827-the-divers-thread, decision 5 (slice 7e), pinned as rules.
 *
 * Only the rules about what the page reads and records stay here: the medical
 * hold, the emergency contact pair, the release and signature semantics, the
 * held seat and the locale. Its layout is the visual suite's to photograph.
 *
 * It reads the route's source because the thing being pinned is a *server*
 * page's composition: there is no render to inspect without a database, a
 * request, a shop and a live capability token, and an e2e spec that scrolls the
 * real page cannot say *why* a section is where it is. Same shape as
 * `src/app/ready/[token]/page.composition.test.ts`, for the same reason.
 */

const SOURCE = component("page.tsx");

/**
 * The source of a file the page composes, read by name: beside the page, or
 * under `src/components/`. A section that moves out of the page moves its pins
 * with it by changing only the name passed here; the gates themselves (the
 * hold, the rail's progress, the held seat's early return) stay in the page.
 */
function component(file: string): string {
  return routeSource(import.meta.dirname, file);
}

/** The two signing doors, which moved out of the page into the route's `actions.ts`. */
const ACTIONS = component("actions.ts");
const RELEASE = component("WaiverRelease.tsx");
const COMPLETED = component("WaiverCompleted.tsx");

function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

describe("the waiver's pacing", () => {
  it("does not close Medical on a record the shop is still holding", () => {
    expect(SOURCE).toContain("const needsReview = isUnresolvedMedicalHold(state.record)");
    expect(SOURCE).toContain("completedWaiverRail(needsReview, !!state.record.shopAnswers)");
    expect(positionOf("const needsReview")).toBeLessThan(positionOf("completedWaiverRail("));
    expect(SOURCE).toContain("signedRail={signedRail}");
    expect(COMPLETED).toContain("medicalStillOpen: needsReview");
    expect(COMPLETED.split("waiverRailProgress(").length - 1).toBe(1);
  });
});

/**
 * **The emergency contact's two boxes move together** — the one rule on this
 * page that no markup can express, so what is asserted here is that the page
 * reads it (`readEmergencyContact`, whose docblock in `src/lib/contact.ts` is
 * where the rule and the hazard behind it are written out) on both submits and
 * refuses where the diver can see it.
 */
describe("the emergency contact's two boxes", () => {
  it("refuses a half-filled pair rather than sending half of it to a writer", () => {
    // Both submits read the pair through the one rule, and the complete path
    // refuses on it alongside the medical answers and the signature.
    const actionsCount = (marker: string) => ACTIONS.split(marker).length - 1;
    expect(actionsCount("refusedContactField(submittedContact)")).toBe(2);
    // One refusal, with the shop's own questions and the medical alert's
    // shape beside it (glossary *Shop question*, *Medical alert for the
    // crew*); read with its line breaks folded, as the formatter wraps it.
    expect(ACTIONS.replace(/\s+/g, " ")).toContain(
      "if ( !parsed.success || !answers || (guardian && !guardian.success) || refusedContact || refusedShop || refusedAlert ) {",
    );
    // Every write of the contact — the draft save, the signature, and the
    // re-save after a refused signature — is gated on a complete pair.
    expect(actionsCount('submittedContact?.kind === "pair"')).toBe(3);
  });
});

describe("what this slice was forbidden to touch", () => {
  it("presents the release in full", () => {
    // "Presenting the full text is part of what typed consent means here" —
    // the ADR rejected collapsing it behind a disclosure outright. No details
    // element, no clamp, no scroll box around the template body.
    expect(RELEASE).toContain("{record.templateBody}");
    for (const source of [SOURCE, RELEASE]) {
      expect(source).not.toContain("AutoOpenDetails");
      expect(source).not.toMatch(/line-clamp|max-h-\d+\s+overflow-y-auto/);
    }
  });

  it("leaves the signature and medical semantics where it found them", () => {
    // `readFormMedicalAnswers` is the `FormData` adapter over
    // `readMedicalAnswers`, which moved to src/lib/medical.ts in issue #1135 —
    // it is the one function deciding what enters a signed medical record, it
    // is written by three callers that have to agree, and it had no test at all
    // while it was a private helper in this file. What this line guards is
    // unchanged: the complete path still reads the questionnaire, and reads it
    // without `allowIncomplete`.
    for (const guard of [
      "completeSignatureSchema",
      "readFormMedicalAnswers(formData, questionnaire)",
      "refusedSubmitPath",
      "questionnaireForJurisdiction(shop.jurisdiction)",
      "name_mismatch",
      "invalid_medical",
    ]) {
      expect(ACTIONS).toContain(guard);
    }
  });
});

/**
 * **A held seat's link names nobody** (issue #2125). The signer hint is the
 * matched person's full name and the guardian section says whether they are a
 * minor, so the held state returns before either is read.
 */
describe("a held seat's release", () => {
  it("returns its held card before the signer on file is read", () => {
    const held = positionOf('state.state === "held"');
    expect(held).toBeGreaterThan(-1);
    expect(held).toBeLessThan(positionOf("getWaiverSignerOnFile("));
    expect(held).toBeLessThan(positionOf("guardianSignatureRequired("));
  });
});

/**
 * **A refused submit records nothing about the person** (security review of
 * issue #2125). The diver's own language is first-hand evidence only once the
 * writer accepted the form; recorded before it, a held or dead link wrote a
 * locale onto the matched person's record. The held branch returns before any
 * form renders, so the page keeps no held-seat branches of its own.
 */
describe("the diver's own locale", () => {
  it("is recorded only after the draft or the signature is taken", () => {
    const draft = ACTIONS.slice(ACTIONS.indexOf("export async function saveWaiverDraftAction"));
    expect(draft.indexOf("if (savedDraft) {")).toBeGreaterThan(-1);
    expect(draft.indexOf("recordDiverOwnLocale(")).toBeGreaterThan(
      draft.indexOf("const savedDraft = await saveWaiverDraft("),
    );
    const complete = ACTIONS.slice(ACTIONS.indexOf("export async function completeWaiverAction"));
    expect(complete.indexOf("recordDiverOwnLocale(")).toBeGreaterThan(
      complete.indexOf("if (!outcome.ok) {"),
    );
    expect(SOURCE).not.toContain("identityHeld");
  });
});
