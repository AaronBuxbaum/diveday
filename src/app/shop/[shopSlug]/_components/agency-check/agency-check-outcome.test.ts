import { describe, expect, it } from "vitest";
import type { AgencyCheckCopy } from "./agency-check-copy";
import {
  agencyCheckForm,
  agencyCheckOutcome,
  agencyCheckOutcomeText,
} from "./agency-check-outcome";

const COPY = {
  check: "Check with SSI",
  checking: "Checking with SSI…",
  matched: "matched",
  levelUnconfirmed: "levelUnconfirmed",
  noRecord: "noRecord",
  unreadable: "unreadable",
  invalid: "invalid",
  undo: "Undo",
  undoPending: "Undoing…",
  undoFailed: "undoFailed",
} satisfies AgencyCheckCopy;

describe("agencyCheckOutcome", () => {
  it("reads the extension's silence as a transport failure, whatever came before", () => {
    expect(agencyCheckOutcome(null, true)).toBe("transport");
    expect(agencyCheckOutcomeText(null, true, COPY)).toBe("unreadable");
  });

  it("reads each verdict as the queue sees it", () => {
    expect(agencyCheckOutcome(null, false)).toBeNull();
    expect(agencyCheckOutcome({ ok: true, verdict: "match" }, false)).toBe("match");
    expect(
      agencyCheckOutcome({ ok: true, verdict: "level_unconfirmed", evidence: "x" }, false),
    ).toBe("level_unconfirmed");
    expect(agencyCheckOutcome({ ok: true, verdict: "no_record" }, false)).toBe("no_record");
    expect(agencyCheckOutcome({ ok: true, verdict: "unreadable" }, false)).toBe("unreadable");
    expect(agencyCheckOutcome({ ok: false, reason: "invalid" }, false)).toBe("refused");
    expect(agencyCheckOutcome({ ok: true, verdict: "undone" }, false)).toBeNull();
  });

  it("says nothing beside a match or an undo: the card says it", () => {
    expect(agencyCheckOutcomeText({ ok: true, verdict: "match" }, false, COPY)).toBeNull();
    expect(agencyCheckOutcomeText({ ok: true, verdict: "undone" }, false, COPY)).toBeNull();
    expect(agencyCheckOutcomeText({ ok: false, reason: "not-undoable" }, false, COPY)).toBe(
      "undoFailed",
    );
    expect(agencyCheckOutcomeText({ ok: false, reason: "invalid" }, false, COPY)).toBe("invalid");
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
