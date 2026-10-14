import { describe, expect, it } from "vitest";
import type { AgencyCheckCopy } from "./agency-check-copy";
import {
  agencyCheckFailure,
  agencyCheckForm,
  agencyCheckMatchedText,
  agencyCheckOutcome,
  agencyCheckOutcomeText,
} from "./agency-check-outcome";

const COPY = {
  check: "Check with SSI",
  link: "Check with SSI",
  checking: "Checking with SSI…",
  matched: "matched",
  matchedConfirmed: "matchedConfirmed",
  levelUnconfirmed: "levelUnconfirmed",
  noRecord: "noRecord",
  severalRecords: "severalRecords",
  unreadable: "unreadable",
  notFoundOnPage: "notFoundOnPage {name}",
  noAnswer: "noAnswer",
  signedOut: "signedOut",
  invalid: "invalid",
  undo: "Undo",
  undoPending: "Undoing…",
  undoFailed: "undoFailed",
} satisfies AgencyCheckCopy;

describe("agencyCheckOutcome", () => {
  /**
   * The extension came back with no page (it timed out, or could not fill the
   * agency's form): that is the page, said as the page, and it counts toward
   * the two in a row that stop a "Check all".
   */
  it("reads the extension's silence as a page it could not read, whatever came before", () => {
    for (const reason of ["fill_failed", "timeout", "tab_failed", "unsupported"] as const) {
      expect(agencyCheckFailure(reason)).toBe("page");
    }
    expect(agencyCheckOutcome(null, "page")).toBe("unreadable");
    expect(agencyCheckOutcomeText(null, "page", COPY, "Lena Ortiz")).toBe("unreadable");
    expect(agencyCheckOutcome({ ok: true, verdict: "match", effect: "certified" }, "page")).toBe(
      "unreadable",
    );
  });

  /**
   * DiveDay's own server did not answer: the card may or may not have been
   * written, so the staffer is told to reload, never that the agency's page
   * could not be read.
   */
  it("tells the staffer to reload when DiveDay itself did not answer", () => {
    expect(agencyCheckOutcome(null, "transport")).toBe("transport");
    expect(agencyCheckOutcomeText(null, "transport", COPY, "Lena Ortiz")).toBe("noAnswer");
  });

  it("tells a signed-out staffer to sign in, never that the page could not be read", () => {
    expect(agencyCheckFailure("signed_out")).toBe("signed_out");
    expect(agencyCheckOutcome(null, "signed_out")).toBe("signed_out");
    expect(agencyCheckOutcomeText(null, "signed_out", COPY, "Lena Ortiz")).toBe("signedOut");
  });

  /** One diver the page does not show cleanly is that diver's: named, with the page to open. */
  it("names the diver when the agency's page came back but did not show them", () => {
    expect(
      agencyCheckOutcomeText({ ok: true, verdict: "unreadable" }, null, COPY, "Lena Ortiz"),
    ).toBe("notFoundOnPage Lena Ortiz");
  });

  it("leaves a page listing several divers for the staffer, in its own words", () => {
    expect(agencyCheckOutcome({ ok: true, verdict: "several_records" }, null)).toBe(
      "several_records",
    );
    expect(
      agencyCheckOutcomeText({ ok: true, verdict: "several_records" }, null, COPY, "Lena Ortiz"),
    ).toBe("severalRecords");
  });

  it("reads each verdict as the queue sees it", () => {
    expect(agencyCheckOutcome(null, null)).toBeNull();
    expect(agencyCheckOutcome({ ok: true, verdict: "match", effect: "certified" }, null)).toBe(
      "certified",
    );
    expect(agencyCheckOutcome({ ok: true, verdict: "match", effect: "confirmed" }, null)).toBe(
      "confirmed",
    );
    expect(
      agencyCheckOutcome({ ok: true, verdict: "level_unconfirmed", evidence: "x" }, null),
    ).toBe("level_unconfirmed");
    expect(agencyCheckOutcome({ ok: true, verdict: "no_record" }, null)).toBe("no_record");
    expect(agencyCheckOutcome({ ok: true, verdict: "unreadable" }, null)).toBe("unreadable");
    expect(agencyCheckOutcome({ ok: false, reason: "invalid" }, null)).toBe("refused");
    expect(agencyCheckOutcome({ ok: true, verdict: "undone" }, null)).toBeNull();
  });

  it("says nothing beside a match or an undo: the card says it", () => {
    const say = (result: Parameters<typeof agencyCheckOutcomeText>[0]) =>
      agencyCheckOutcomeText(result, null, COPY, "Lena Ortiz");
    expect(say({ ok: true, verdict: "match", effect: "certified" })).toBeNull();
    expect(say({ ok: true, verdict: "undone" })).toBeNull();
    expect(say({ ok: false, reason: "not-undoable" })).toBe("undoFailed");
    expect(say({ ok: false, reason: "invalid" })).toBe("invalid");
  });

  it("words a match by what it did: certified a pending card, or confirmed an imported one", () => {
    expect(agencyCheckMatchedText({ ok: true, verdict: "match", effect: "certified" }, COPY)).toBe(
      "matched",
    );
    expect(agencyCheckMatchedText({ ok: true, verdict: "match", effect: "confirmed" }, COPY)).toBe(
      "matchedConfirmed",
    );
  });
});

describe("agencyCheckForm", () => {
  it("posts the card and the page's words, and nothing else", () => {
    const form = agencyCheckForm("card-1", "page");
    expect([...form.keys()].sort()).toEqual(["certificationId", "pageText"]);
    expect(form.get("certificationId")).toBe("card-1");
    expect(form.get("pageText")).toBe("page");
  });

  it("asks a Check all card's post to leave the refresh to the end of the run", () => {
    const form = agencyCheckForm("card-1", "page", { refreshLater: true });
    expect(form.get("refresh")).toBe("later");
  });
});
