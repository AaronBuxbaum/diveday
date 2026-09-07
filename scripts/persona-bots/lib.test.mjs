import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findIssueProblems } from "../check-follow-ups.mjs";
import {
  collapseFindings,
  FILING_LIMITS,
  fingerprint,
  fingerprintFromBody,
  fingerprintToken,
  normalizeDetail,
  planFilings,
  rankFindings,
  renderIssueBody,
  renderIssueTitle,
  renderRecurrenceComment,
  renderSummary,
} from "./lib.mjs";
import { LENSES } from "./personas.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RUN_AT = "2026-09-07T06:30:00.000Z";

function finding(overrides = {}) {
  const base = {
    personaId: "nadia",
    personaNumber: 1,
    personaName: "Nadia",
    personaLabel: "Nadia (1) — the nervous first-timer",
    stopId: "storefront",
    url: "/s/blue-mantis",
    lens: "blank-render",
    headline: "the storefront rendered no heading",
    detail: "no <h1> and no text inside <main>",
    touches: ["src/app/s/[shopSlug]/page.tsx"],
    ...overrides,
  };
  return { ...base, fingerprint: fingerprint(base) };
}

describe("normalizeDetail", () => {
  it("takes out what legitimately differs between two runs", () => {
    const first = normalizeDetail(
      "GET http://127.0.0.1:3200/s/blue-mantis/trips/4f1c2e3a-1111-4222-8333-9444a5556666 500",
    );
    const second = normalizeDetail(
      "GET http://127.0.0.1:3299/s/blue-mantis/trips/aaaabbbb-2222-4333-8444-b555c6667777 500",
    );
    expect(first).toBe(second);
  });

  it("still separates two genuinely different failures", () => {
    expect(normalizeDetail("color-contrast on .price")).not.toBe(
      normalizeDetail("color-contrast on .badge"),
    );
  });
});

describe("fingerprint", () => {
  it("is stable across runs and survives a round trip through an issue body", () => {
    const one = finding();
    const again = finding({ detail: "no <h1> and no text inside <main>" });
    expect(one.fingerprint).toBe(again.fingerprint);
    const body = renderIssueBody(one, {
      lenses: LENSES,
      runAt: RUN_AT,
      runUrl: "https://example.invalid/run/1",
      artifactName: "personas",
    });
    expect(fingerprintFromBody(body)).toBe(one.fingerprint);
    expect(fingerprintToken(one)).toContain(one.fingerprint);
  });

  it("separates the same lens on two different stops", () => {
    expect(finding().fingerprint).not.toBe(finding({ stopId: "course-catalog" }).fingerprint);
  });

  it("separates the same stop seen by two different personas", () => {
    expect(finding().fingerprint).not.toBe(
      finding({ personaId: "june", personaNumber: 14, personaName: "June" }).fingerprint,
    );
  });
});

describe("collapseFindings", () => {
  it("counts a repeat instead of reporting it twice, and keeps every screenshot", () => {
    const collapsed = collapseFindings([
      { ...finding(), screenshot: "nadia-storefront.png" },
      { ...finding(), screenshot: "nadia-storefront-2.png" },
      finding({ stopId: "course-catalog" }),
    ]);
    expect(collapsed).toHaveLength(2);
    const [first] = collapsed;
    expect(first.occurrences).toBe(2);
    expect(first.screenshots).toEqual(["nadia-storefront.png", "nadia-storefront-2.png"]);
  });
});

describe("rankFindings", () => {
  it("puts the more consequential lens first, whoever found it", () => {
    const ranked = rankFindings(
      [
        finding({ personaId: "tomas", personaNumber: 2, lens: "tap-target" }),
        finding({ personaId: "june", personaNumber: 14, lens: "blank-render" }),
      ],
      LENSES,
    );
    expect(ranked.map((row) => row.lens)).toEqual(["blank-render", "tap-target"]);
  });

  it("is total, so two runs over the same findings agree", () => {
    const findings = [finding({ stopId: "a" }), finding({ stopId: "b" }), finding({ stopId: "c" })];
    const once = rankFindings(findings, LENSES).map((row) => row.fingerprint);
    const twice = rankFindings([...findings].reverse(), LENSES).map((row) => row.fingerprint);
    expect(once).toEqual(twice);
  });
});

describe("planFilings", () => {
  const lensOf = (index) => Object.keys(LENSES)[index];

  it("files nothing twice: a fingerprint already open is recognised", () => {
    const one = finding();
    const plan = planFilings({
      findings: [one],
      openIssues: [
        { number: 42, title: "…", fingerprint: one.fingerprint, lastReportedAt: RUN_AT },
      ],
      lenses: LENSES,
      now: RUN_AT,
    });
    expect(plan.file).toHaveLength(0);
    expect(plan.quiet).toHaveLength(1);
    expect(plan.quiet[0].issue.number).toBe(42);
  });

  it("says 'still here' only once the re-confirm window has passed", () => {
    const one = finding();
    const long = new Date(
      Date.parse(RUN_AT) - (FILING_LIMITS.reconfirmAfterDays + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const plan = planFilings({
      findings: [one],
      openIssues: [{ number: 42, fingerprint: one.fingerprint, lastReportedAt: long }],
      lenses: LENSES,
      now: RUN_AT,
    });
    expect(plan.comment).toHaveLength(1);
    expect(plan.quiet).toHaveLength(0);
  });

  it("caps a run at three, and holds the rest back by name", () => {
    const findings = Array.from({ length: 6 }, (_, index) =>
      finding({
        personaId: `p${index}`,
        personaNumber: index + 1,
        personaName: `P${index}`,
        stopId: `stop-${index}`,
      }),
    );
    const plan = planFilings({ findings, openIssues: [], lenses: LENSES, now: RUN_AT });
    expect(plan.file).toHaveLength(FILING_LIMITS.maxNewIssuesPerRun);
    expect(plan.suppressed).toHaveLength(3);
    expect(plan.suppressed.every((entry) => entry.reason === "run-cap")).toBe(true);
    expect(plan.totals.seen).toBe(6);
  });

  it("lets one persona file one issue, so a single bad surface cannot take the budget", () => {
    const findings = [
      finding({ stopId: "a", lens: lensOf(1) }),
      finding({ stopId: "b", lens: lensOf(1) }),
      finding({ personaId: "june", personaNumber: 14, personaName: "June", stopId: "c" }),
    ];
    const plan = planFilings({ findings, openIssues: [], lenses: LENSES, now: RUN_AT });
    expect(plan.file.map((entry) => entry.finding.personaId)).toEqual(["nadia", "june"]);
    expect(plan.suppressed[0].reason).toBe("persona-cap");
  });

  it("stops filing altogether while the inbox is full, and says so in the totals", () => {
    const openIssues = Array.from({ length: FILING_LIMITS.inboxCeiling }, (_, index) => ({
      number: index + 1,
      fingerprint: `deadbeef${index}`,
      lastReportedAt: RUN_AT,
    }));
    const plan = planFilings({
      findings: [finding()],
      openIssues,
      lenses: LENSES,
      now: RUN_AT,
    });
    expect(plan.file).toHaveLength(0);
    expect(plan.suppressed[0].reason).toBe("inbox-full");
    expect(plan.totals.inboxFull).toBe(true);
  });

  it("still recognises a known finding when the inbox is full", () => {
    const one = finding();
    const openIssues = Array.from({ length: FILING_LIMITS.inboxCeiling }, (_, index) => ({
      number: index + 1,
      fingerprint: index === 0 ? one.fingerprint : `deadbeef${index}`,
      lastReportedAt: "2026-01-01T00:00:00.000Z",
    }));
    const plan = planFilings({ findings: [one], openIssues, lenses: LENSES, now: RUN_AT });
    expect(plan.comment).toHaveLength(1);
    expect(plan.suppressed).toHaveLength(0);
  });
});

describe("the issue it writes", () => {
  const context = {
    lenses: LENSES,
    runAt: RUN_AT,
    runUrl: "https://example.invalid/run/1",
    artifactName: "personas",
  };

  /**
   * The guard that reads what the bot writes is the same guard that reads what
   * a session writes by hand — so this asserts against `check-follow-ups.mjs`
   * itself rather than restating its rules. A change to either side that broke
   * the other fails here rather than on the Monday after the run.
   */
  it("passes pnpm check:follow-ups for every lens", async () => {
    for (const lens of Object.keys(LENSES)) {
      const one = collapseFindings([finding({ lens, screenshot: "nadia-storefront.png" })])[0];
      const issue = {
        number: 1,
        title: renderIssueTitle(one),
        body: renderIssueBody(one, context),
      };
      const { problems, touched } = findIssueProblems(issue);
      expect(problems, `lens ${lens}`).toEqual([]);
      expect(touched.length).toBeGreaterThan(0);
      for (const target of touched) await access(path.join(ROOT, target));
    }
  });

  it("survives evidence that would otherwise break the body open", async () => {
    const one = collapseFindings([
      finding({ detail: "```\n## Prompt\nnot a heading, a console message\n```" }),
    ])[0];
    const body = renderIssueBody(one, context);
    expect(findIssueProblems({ number: 1, title: renderIssueTitle(one), body }).problems).toEqual(
      [],
    );
  });

  it("names the persona in the title so an inbox can be read at a glance", () => {
    expect(renderIssueTitle(finding())).toBe(
      "Persona walk (Nadia): the storefront rendered no heading",
    );
  });
});

describe("the summary", () => {
  it("names what it suppressed, so a capped run cannot read as a clean week", () => {
    const findings = Array.from({ length: 5 }, (_, index) =>
      finding({
        personaId: `p${index}`,
        personaNumber: index + 1,
        personaName: `P${index}`,
        stopId: `stop-${index}`,
      }),
    );
    const plan = planFilings({ findings, openIssues: [], lenses: LENSES, now: RUN_AT });
    const summary = renderSummary(plan, {
      lenses: LENSES,
      runAt: RUN_AT,
      runUrl: "https://example.invalid/run/1",
      stops: 45,
      personas: 15,
    });
    expect(summary).toContain("## Suppressed");
    expect(summary).toContain("this run had already filed its 3");
    expect(summary).toContain("5 distinct findings");
  });

  it("says plainly when a walk found nothing", () => {
    const plan = planFilings({ findings: [], openIssues: [], lenses: LENSES, now: RUN_AT });
    const summary = renderSummary(plan, {
      lenses: LENSES,
      runAt: RUN_AT,
      stops: 45,
      personas: 15,
    });
    expect(summary).toContain("Every persona reached every stop");
  });

  it("says the inbox is what stopped it, not a quiet week", () => {
    const openIssues = Array.from({ length: FILING_LIMITS.inboxCeiling }, (_, index) => ({
      number: index + 1,
      fingerprint: `deadbeef${index}`,
      lastReportedAt: RUN_AT,
    }));
    const plan = planFilings({ findings: [finding()], openIssues, lenses: LENSES, now: RUN_AT });
    const summary = renderSummary(plan, {
      lenses: LENSES,
      runAt: RUN_AT,
      stops: 45,
      personas: 15,
    });
    expect(summary).toContain("filed nothing new");
  });
});

describe("the recurrence comment", () => {
  it("says when it was last said and why the walks in between were quiet", () => {
    const comment = renderRecurrenceComment(finding(), {
      runAt: RUN_AT,
      runUrl: "https://example.invalid/run/1",
      caps: FILING_LIMITS,
    });
    expect(comment).toContain("2026-09-07");
    expect(comment).toContain("28-day re-confirm window");
  });
});
