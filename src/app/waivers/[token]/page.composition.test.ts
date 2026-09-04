import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **What the waiver page is, and what it stopped being** — ADR
 * 20260827-the-divers-thread, decision 5 (slice 7e), pinned as rules.
 *
 * The page it replaced was a wall: the full release, then eleven medical
 * questions, before the diver reached anything they could finish; four
 * different banner treatments for four adjacent messages; and two submits
 * sharing one row with inverted weight on a phone, so the page's one act was
 * the second thing a thumb reached. Every assertion below is one of those
 * defects, written so it cannot come back — plus the three things this slice
 * was forbidden to touch.
 *
 * It reads the route's source because the thing being pinned is a *server*
 * page's composition: there is no render to inspect without a database, a
 * request, a shop and a live capability token, and an e2e spec that scrolls the
 * real page cannot say *why* a section is where it is. Same shape as
 * `src/app/ready/[token]/page.composition.test.ts`, for the same reason.
 */

const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

function countOf(marker: string): number {
  return SOURCE.split(marker).length - 1;
}

describe("the waiver's pacing", () => {
  it("puts the rail under the header and above everything it paces", () => {
    const rail = positionOf("<WaiverPacing");
    const release = positionOf("data-waiver-template-body");
    const form = positionOf("<form action={completeAction}");
    for (const marker of [rail, release, form]) expect(marker).toBeGreaterThan(-1);
    expect(rail).toBeLessThan(release);
    expect(release).toBeLessThan(form);
  });

  it("counts the questions the diver was handed, never the follow-ups their answers open", () => {
    // A denominator that grows when you answer honestly is a rail that
    // punishes honesty. Both readers of the count — the rail and the sticky
    // counter — are handed the same page-one total.
    expect(SOURCE).toContain('(question) => question.section === "primary",');
    expect(countOf("primaryQuestionCount")).toBeGreaterThanOrEqual(3);
  });

  it("makes the rail a navigator only for the segment a refusal named", () => {
    // Nothing ever links forward: a diver cannot tap "Sign" to skip the
    // release, so the anchors bag is empty unless `fieldError` is set.
    const anchors = positionOf("const railAnchors");
    expect(anchors).toBeGreaterThan(-1);
    expect(SOURCE).toContain(
      "const railAnchors: Partial<Record<WaiverRailSegmentId, string>> = fieldError",
    );
    expect(SOURCE).toContain("{ medical: fieldError.anchor }");
    expect(SOURCE).toContain("{ sign: fieldError.anchor }");
    expect(SOURCE).not.toContain("{ release: fieldError.anchor }");
  });

  it("closes the rail at 3 of 3 on the completed state, and only there", () => {
    // Sign settles when `completeWaiver` has taken the signature and at no
    // earlier moment: `signed: true` appears once in this file, inside the
    // completed branch.
    expect(countOf("signed: true")).toBe(1);
    expect(positionOf("signed: true")).toBeLessThan(positionOf("<form action={completeAction}"));
  });

  it("does not close Medical on a record the shop is still holding", () => {
    // The hold is threaded into the one call rather than rendered as a second
    // rail beside it — which is what keeps `signed: true` a single occurrence
    // above. Without it this screen read "3 of 3 done" three lines under copy
    // telling the diver a doctor must confirm in writing before they can go
    // out: the product ticking its own blocking state.
    expect(SOURCE).toContain("medicalStillOpen: needsReview");
    expect(positionOf("const needsReview")).toBeLessThan(
      positionOf("medicalStillOpen: needsReview"),
    );
    expect(countOf("waiverRailProgress(")).toBe(1);
  });

  it("seeds the count from the draft the server is already holding", () => {
    // `WaiverPacing`'s listener is delegated, so it sees nothing that happened
    // before it mounted. Without these the HTML ships "0 of 3 done" over radios
    // the server has just rendered checked from a saved draft — wrong until the
    // bundle boots on dock wifi, and permanent with JavaScript off, which this
    // page still supports (the save control is a real `formNoValidate` submit).
    expect(SOURCE).toContain("initialAnswered={draftAnsweredFields}");
    expect(SOURCE).toContain(
      "initialFollowUpsRemaining={draftProgress.remaining - draftProgress.primaryRemaining}",
    );
    expect(positionOf("const draftProgress")).toBeLessThan(positionOf("<WaiverPacing"));
  });

  it("keeps one scale of progress on the page", () => {
    // The rail counts Release · Medical · Sign. The body's headings used to
    // number *themselves* 1-2-3 over a different membership — the medical form,
    // the emergency contact, the signature — so a diver met "2 of 3 done" at the
    // top of the same viewport as "step 2 of 3" below it, and the step the two
    // silently disagreed about was the emergency contact: a name *and* a
    // reachable number the crew calls in an incident, which this page is the
    // main place anyone captures.
    expect(SOURCE).not.toMatch(/StepHeading/);
    expect(countOf("<SectionHeading>")).toBe(3);
  });
});

describe("one notice grammar", () => {
  it("renders every banner through the one component", () => {
    // Four treatments, one per message, converged: the refusal, the saved
    // draft, the English-only note about the document, and the expired link's
    // rescue outcome.
    expect(countOf("<ShopNotice")).toBe(4);
  });

  it("keeps no hand-rolled tint band of its own", () => {
    for (const band of [
      "bg-danger-tint px-4",
      "bg-success-tint px-4",
      "bg-warning-tint px-4",
      "NOTICE_TONE",
    ]) {
      expect(SOURCE).not.toContain(band);
    }
  });

  it("stacks them in one slot above the release", () => {
    const slot = positionOf("<ShopNotice");
    expect(slot).toBeLessThan(positionOf("data-waiver-template-body"));
    // The English-only note used to sit *inside* the release section, as a
    // fifth treatment attached to the document. It is a notice; it renders
    // where the notices render.
    expect(positionOf('t("waiver.englishOnlyNotice")')).toBeLessThan(
      positionOf("data-waiver-template-body"),
    );
  });
});

describe("one primary", () => {
  it("gives Sign the full width and demotes saving to a text link", () => {
    expect(SOURCE).toContain('buttonClass({ variant: "link", size: "sm", flush: true })');
    // The bordered secondary that used to sit above the primary on a phone.
    expect(SOURCE).not.toContain('variant: "secondary"');
    expect(SOURCE).toContain("mt-6 w-full disabled:opacity-70");
  });

  it("keeps saving a real submit, so the page still works with no JavaScript", () => {
    // A `<button formAction>` inside the same form, not a link to a GET route:
    // demoting the affordance must not demote the mechanism, or a diver on a
    // dead connection loses the answers they came back to finish.
    expect(SOURCE).toContain("formAction={saveDraftAction}");
    expect(SOURCE).toContain("formNoValidate");
  });

  it("sets the expiry sentence beside it rather than on a line of its own", () => {
    const link = positionOf('t("waiver.saveForLater")');
    const expiry = positionOf('t("waiver.linkExpiresAt"');
    expect(link).toBeGreaterThan(-1);
    expect(expiry).toBeGreaterThan(link);
    expect(expiry - link).toBeLessThan(600);
  });
});

describe("what this slice was forbidden to touch", () => {
  it("presents the release in full", () => {
    // "Presenting the full text is part of what typed consent means here" —
    // the ADR rejected collapsing it behind a disclosure outright. No details
    // element, no clamp, no scroll box around the template body.
    expect(SOURCE).toContain("{record.templateBody}");
    expect(SOURCE).not.toContain("AutoOpenDetails");
    expect(SOURCE).not.toMatch(/line-clamp|max-h-\d+\s+overflow-y-auto/);
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
      expect(SOURCE).toContain(guard);
    }
  });

  it("spends the thread's coral exactly once, on the completed state", () => {
    // "Paperwork done" is this page's moment and the thread's second (ADR
    // 20260827-the-divers-thread, decision 6). The page a diver is still
    // filling in celebrates nothing.
    expect(countOf("<EarnedMoment")).toBe(1);
    expect(positionOf("<EarnedMoment")).toBeLessThan(positionOf("<form action={completeAction}"));
  });
});
