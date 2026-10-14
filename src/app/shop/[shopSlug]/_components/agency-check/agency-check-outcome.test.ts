import { describe, expect, it } from "vitest";
import type { AgencyCheckCopy } from "./agency-check-copy";
import {
  agencyCheckFailure,
  agencyCheckForm,
  agencyCheckOutcome,
  agencyCheckOutcomeText,
} from "./agency-check-outcome";

const COPY = {
  check: "Check with SSI",
  link: "Check with SSI",
  checking: "Checking with SSI…",
  matched: "matched",
  levelUnconfirmed: "levelUnconfirmed",
  noRecord: "noRecord",
  severalRecords: "severalRecords",
  unreadable: "unreadable",
  signedOut: "signedOut",
  invalid: "invalid",
  undo: "Undo",
  undoPending: "Undoing…",
  undoFailed: "undoFailed",
} satisfies AgencyCheckCopy;

describe("agencyCheckOutcome", () => {
  it("reads the extension's silence as a transport failure, whatever came before", () => {
    expect(agencyCheckOutcome(null, "transport")).toBe("transport");
    expect(agencyCheckOutcomeText(null, "transport", COPY)).toBe("unreadable");
    expect(agencyCheckOutcome({ ok: true, verdict: "match" }, "transport")).toBe("transport");
  });

  it("tells a signed-out staffer to sign in, never that the page could not be read", () => {
    expect(agencyCheckFailure("signed_out")).toBe("signed_out");
    expect(agencyCheckOutcome(null, "signed_out")).toBe("signed_out");
    expect(agencyCheckOutcomeText(null, "signed_out", COPY)).toBe("signedOut");
    for (const reason of ["fill_failed", "timeout", "tab_failed", "unsupported"] as const) {
      expect(agencyCheckFailure(reason)).toBe("transport");
    }
  });

  it("leaves a page listing several divers for the staffer, in its own words", () => {
    expect(agencyCheckOutcome({ ok: true, verdict: "several_records" }, null)).toBe(
      "several_records",
    );
    expect(agencyCheckOutcomeText({ ok: true, verdict: "several_records" }, null, COPY)).toBe(
      "severalRecords",
    );
  });

  it("reads each verdict as the queue sees it", () => {
    expect(agencyCheckOutcome(null, null)).toBeNull();
    expect(agencyCheckOutcome({ ok: true, verdict: "match" }, null)).toBe("match");
    expect(
      agencyCheckOutcome({ ok: true, verdict: "level_unconfirmed", evidence: "x" }, null),
    ).toBe("level_unconfirmed");
    expect(agencyCheckOutcome({ ok: true, verdict: "no_record" }, null)).toBe("no_record");
    expect(agencyCheckOutcome({ ok: true, verdict: "unreadable" }, null)).toBe("unreadable");
    expect(agencyCheckOutcome({ ok: false, reason: "invalid" }, null)).toBe("refused");
    expect(agencyCheckOutcome({ ok: true, verdict: "undone" }, null)).toBeNull();
  });

  it("says nothing beside a match or an undo: the card says it", () => {
    expect(agencyCheckOutcomeText({ ok: true, verdict: "match" }, null, COPY)).toBeNull();
    expect(agencyCheckOutcomeText({ ok: true, verdict: "undone" }, null, COPY)).toBeNull();
    expect(agencyCheckOutcomeText({ ok: false, reason: "not-undoable" }, null, COPY)).toBe(
      "undoFailed",
    );
    expect(agencyCheckOutcomeText({ ok: false, reason: "invalid" }, null, COPY)).toBe("invalid");
  });
});

describe("agencyCheckForm", () => {
  it("posts the card and the page's words, and nothing else", () => {
    const form = agencyCheckForm("card-1", "page");
    expect([...form.keys()].sort()).toEqual(["certificationId", "pageText"]);
    expect(form.get("certificationId")).toBe("card-1");
    expect(form.get("pageText")).toBe("page");
  });
});
