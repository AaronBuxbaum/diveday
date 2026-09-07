/**
 * The persona walk writes into a live issue tracker that one person reads, and
 * `pnpm check:follow-ups` reads that same tracker inside every pull request's
 * `pnpm check`. Two things therefore have to be provable without a network:
 * that the volume ceiling holds, and that every body this generator can emit
 * passes the guard. Both are pinned here.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { CAPABILITY_ROUTE_PREFIXES } from "../../src/lib/capability-urls";
import { findIssueProblems } from "../check-follow-ups.mjs";
import routeCoverage from "../route-coverage.json" with { type: "json" };
import {
  COMMENTS_PER_RUN,
  carriesFingerprint,
  classify,
  fingerprint,
  INBOX_BRAKE,
  NEW_ISSUES_PER_RUN,
  planRun,
  renderComment,
  renderIssue,
  renderSummary,
  sourceFileForPath,
} from "./findings.mjs";
import { DEAD_CAPABILITY_TOKENS, PERSONAS, PROBES, probeFor, walkPlan } from "./personas.mjs";

const finding = (probe, path, extra = {}) => ({
  probe,
  path,
  personas: ["nadia"],
  detail: "",
  ...extra,
});

/** An issue as `gh issue list --json number,title,body` hands it back. */
const issueFor = (number, probe) => ({
  number,
  title: `whatever ${number}`,
  body: fingerprint(probe),
});

describe("classify", () => {
  it("collapses one probe firing on many surfaces into a single class", () => {
    const classes = classify([
      finding("skip-link", "/a"),
      finding("skip-link", "/b"),
      finding("skip-link", "/c"),
    ]);

    expect(classes).toHaveLength(1);
    expect(classes[0].surfaces.map((surface) => surface.path)).toEqual(["/a", "/b", "/c"]);
  });

  it("ranks by impact first, then by how many surfaces the class reaches", () => {
    const classes = classify([
      finding("axe:region", "/a", { impact: "moderate" }),
      finding("axe:region", "/b", { impact: "moderate" }),
      finding("axe:region", "/c", { impact: "moderate" }),
      finding("axe:color-contrast", "/a", { impact: "serious" }),
    ]);

    expect(classes.map((entry) => entry.probe)).toEqual(["axe:color-contrast", "axe:region"]);
  });

  it("keeps the worst impact a class was seen at", () => {
    const [only] = classify([
      finding("axe:label", "/a", { impact: "minor" }),
      finding("axe:label", "/b", { impact: "critical" }),
    ]);

    expect(only.impact).toBe("critical");
  });

  it("orders identically whatever order the walk reported findings in", () => {
    const one = classify([finding("skip-link", "/b"), finding("skip-link", "/a")]);
    const two = classify([finding("skip-link", "/a"), finding("skip-link", "/b")]);

    expect(one).toEqual(two);
  });
});

describe("the volume policy", () => {
  const manyClasses = classify(
    Array.from({ length: 12 }, (_, index) => finding(`axe:rule-${index}`, "/a")),
  );

  it("never files more than the weekly ceiling, however much the walk found", () => {
    const plan = planRun({ classes: manyClasses });

    expect(plan.file).toHaveLength(NEW_ISSUES_PER_RUN);
    expect(plan.deferred).toHaveLength(12 - NEW_ISSUES_PER_RUN);
    expect(plan.deferred.every((entry) => entry.why.includes("ceiling"))).toBe(true);
  });

  it("comments on a class that already has an issue open rather than filing a second", () => {
    const classes = classify([finding("skip-link", "/a")]);
    const plan = planRun({ classes, openIssues: [issueFor(7, "skip-link")] });

    expect(plan.file).toEqual([]);
    expect(plan.comment).toHaveLength(1);
    expect(plan.comment[0].issue.number).toBe(7);
  });

  it("never re-files a class whose issue a human closed", () => {
    const classes = classify([finding("skip-link", "/a")]);
    const plan = planRun({ classes, closedIssues: [issueFor(9, "skip-link")] });

    expect(plan.file).toEqual([]);
    expect(plan.comment).toEqual([]);
    expect(plan.suppressed).toHaveLength(1);
    expect(plan.suppressed[0].issue.number).toBe(9);
  });

  it("stops entirely once the inbox is at the brake", () => {
    const openIssues = Array.from({ length: INBOX_BRAKE }, (_, index) => issueFor(index, "other"));
    const plan = planRun({ classes: manyClasses, openIssues });

    expect(plan.file).toEqual([]);
    expect(plan.comment).toEqual([]);
    expect(plan.brake).toContain(String(INBOX_BRAKE));
    expect(plan.deferred).toHaveLength(manyClasses.length);
  });

  it("bounds the comments too, so a wide run cannot become a wide notification", () => {
    const classes = classify(
      Array.from({ length: COMMENTS_PER_RUN + 3 }, (_, index) =>
        finding(`axe:rule-${index}`, "/a"),
      ),
    );
    const openIssues = classes.map((entry, index) => issueFor(index, entry.probe));
    const plan = planRun({ classes, openIssues });

    expect(plan.comment).toHaveLength(COMMENTS_PER_RUN);
    expect(plan.file).toEqual([]);
  });

  it("matches an open issue only by its own fingerprint", () => {
    expect(carriesFingerprint(fingerprint("skip-link"), "skip-link")).toBe(true);
    expect(carriesFingerprint(fingerprint("skip-links"), "skip-link")).toBe(false);
    expect(carriesFingerprint("", "skip-link")).toBe(false);
  });
});

describe("the issues it files", () => {
  const runContext = {
    runUrl: "https://github.com/AaronBuxbaum/diveday/actions/runs/1",
    artifactName: "persona-bots",
    screenshots: { "/s/blue-mantis": "s-blue-mantis-light-1280.png" },
  };

  /** Every probe the registry can report, plus one axe rule for the templated half. */
  const everyProbe = [...Object.keys(PROBES), "axe:color-contrast"];

  it.each(everyProbe)("renders %s as an issue check:follow-ups accepts", (probe) => {
    const entry = classify([
      finding(probe, "/s/blue-mantis", { personas: ["nadia", "tomas"], impact: "serious" }),
      finding(probe, "/shop/blue-mantis", { personas: ["dana"], detail: "2 nodes." }),
    ])[0];
    const { title, body } = renderIssue(entry, {
      runContext,
      touches: ["src/app/s/[shopSlug]/page.tsx"],
    });

    const { problems, touched } = findIssueProblems({ number: 1, title, body });
    expect(problems).toEqual([]);
    expect(touched.length).toBeGreaterThan(0);
    for (const item of touched) {
      expect(existsSync(path.join(process.cwd(), item)), `${probe}: ${item}`).toBe(true);
    }
  });

  it("carries the fingerprint so next week's run finds it instead of filing again", () => {
    const entry = classify([finding("skip-link", "/a")])[0];
    const { body } = renderIssue(entry);

    expect(carriesFingerprint(body, "skip-link")).toBe(true);
  });

  it("names every surface it found, so the reader never has to re-run the walk", () => {
    const entry = classify([finding("skip-link", "/a"), finding("skip-link", "/b")])[0];
    const { body } = renderIssue(entry);

    expect(body).toContain("`/a`");
    expect(body).toContain("`/b`");
  });

  it("names the screenshot and where the artifact is", () => {
    const entry = classify([finding("skip-link", "/s/blue-mantis")])[0];
    const { body } = renderIssue(entry, { runContext });

    expect(body).toContain("s-blue-mantis-light-1280.png");
    expect(body).toContain(runContext.runUrl);
  });

  it("says so plainly when a run kept its pictures locally", () => {
    const entry = classify([finding("skip-link", "/a")])[0];
    const { body } = renderIssue(entry);

    expect(body).toContain("kept its screenshots locally");
  });
});

describe("sourceFileForPath", () => {
  const routes = ["/", "/pricing", "/s/[shopSlug]", "/s/[shopSlug]/courses/[slug]"];
  const exists = () => true;

  it("resolves a concrete URL onto the route pattern behind it", () => {
    expect(sourceFileForPath("/s/blue-mantis", routes, exists)).toBe(
      "src/app/s/[shopSlug]/page.tsx",
    );
    expect(sourceFileForPath("/s/blue-mantis/courses/deep-diver", routes, exists)).toBe(
      "src/app/s/[shopSlug]/courses/[slug]/page.tsx",
    );
    expect(sourceFileForPath("/", routes, exists)).toBe("src/app/page.tsx");
  });

  it("ignores a query string, which is not part of the route", () => {
    expect(sourceFileForPath("/s/blue-mantis?lens=after-dark", routes, exists)).toBe(
      "src/app/s/[shopSlug]/page.tsx",
    );
  });

  it("returns nothing rather than a path that is not on disk", () => {
    expect(sourceFileForPath("/pricing", routes, () => false)).toBeNull();
    expect(sourceFileForPath("/nowhere/at/all", routes, exists)).toBeNull();
  });
});

describe("the run summary", () => {
  it("says what it did not file and why, not only what it did", () => {
    const classes = classify(
      Array.from({ length: NEW_ISSUES_PER_RUN + 2 }, (_, index) =>
        finding(`axe:rule-${index}`, "/a"),
      ),
    );
    const plan = planRun({ classes, closedIssues: [] });
    const summary = renderSummary({ plan, classes, findings: classes, dryRun: true });

    expect(summary).toContain("would file");
    expect(summary).toContain("not filed");
    expect(summary).toContain("ceiling");
  });

  it("reports a suppression rather than hiding it", () => {
    const classes = classify([finding("skip-link", "/a")]);
    const plan = planRun({ classes, closedIssues: [issueFor(4, "skip-link")] });

    expect(renderSummary({ plan, classes, findings: classes, dryRun: false })).toContain(
      "suppressed: skip-link",
    );
  });
});

describe("the comment left on an issue that is already open", () => {
  it("lists the surfaces this run saw and points at the run", () => {
    const entry = classify([finding("skip-link", "/a"), finding("skip-link", "/b")])[0];
    const comment = renderComment(entry, {
      runContext: { runUrl: "https://example.invalid/run/1" },
    });

    expect(comment).toContain("`/a`");
    expect(comment).toContain("`/b`");
    expect(comment).toContain("https://example.invalid/run/1");
  });
});

describe("the persona registry", () => {
  it("covers all fifteen personas from docs/product/personas.md", () => {
    expect(PERSONAS).toHaveLength(15);
    expect(PERSONAS.map((persona) => persona.number)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1),
    );
  });

  it("gives every persona at least one surface to walk", () => {
    for (const persona of PERSONAS) {
      expect(persona.surfaces.length, persona.id).toBeGreaterThan(0);
    }
  });

  it("visits a route two personas share once, and credits both", () => {
    const plan = walkPlan([
      { id: "one", number: 1, name: "One", lens: "a", surfaces: [{ path: "/s/blue-mantis" }] },
      { id: "two", number: 2, name: "Two", lens: "b", surfaces: [{ path: "/s/blue-mantis" }] },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0].personas).toEqual(["one", "two"]);
  });

  it("keeps the same path apart when the role or the language differs", () => {
    const plan = walkPlan([
      { id: "one", number: 1, name: "One", lens: "a", surfaces: [{ path: "/x" }] },
      { id: "two", number: 2, name: "Two", lens: "b", surfaces: [{ path: "/x", as: "owner" }] },
      {
        id: "three",
        number: 3,
        name: "Three",
        lens: "c",
        locale: "es-ES",
        surfaces: [{ path: "/x" }],
      },
    ]);

    expect(plan).toHaveLength(3);
  });

  it("every walked path resolves to a route the app actually has", () => {
    const routes = Object.keys(routeCoverage).filter((route) => !route.startsWith("//"));
    for (const visit of walkPlan()) {
      expect(
        sourceFileForPath(visit.path, routes, () => true),
        `${visit.path} matches no route in scripts/route-coverage.json`,
      ).not.toBeNull();
    }
  });

  it("walks Ingrid's surfaces in Spanish, where an unresolved key is visible", () => {
    const spanish = walkPlan().filter((visit) => visit.locale === "es-ES");

    expect(spanish.length).toBeGreaterThan(0);
    expect(spanish.every((visit) => visit.personas.includes("ingrid"))).toBe(true);
  });

  /**
   * **The invariant that means this bot needs no redactor.**
   *
   * The walk publishes browser output — a screenshot per surface, and an issue
   * body naming every URL it visited — to a public tracker and a public
   * artifact. It is safe to do that only because no surface it opens carries a
   * live capability: the URL *is* the credential on every
   * `CAPABILITY_ROUTE_PREFIXES` route, so one screenshot of a real
   * `/ready/<token>` page, or one issue body quoting that path, hands the
   * reader a working waiver link.
   *
   * The walk's single bearer-token stop is `/waivers/not-a-real-token`, which
   * is deliberately invalid and is there to see what a dead link looks like.
   * Nothing redacts anything downstream of that, because there has never been
   * anything to redact — and that absence is invisible to somebody adding a
   * stop in six months. This is the warning they get instead: add a surface
   * that mints a live capability and this fails, and the fix is a redaction
   * layer (`redactCapabilityUrl`, src/lib/capability-urls.ts) before the
   * screenshot and the issue body, not an exemption here.
   */
  it("never walks a live capability URL, which is why nothing downstream redacts", () => {
    for (const visit of walkPlan()) {
      const [withoutQuery] = visit.path.split(/[?#]/, 1);
      const [, prefix, segment] = withoutQuery.split("/");
      if (!CAPABILITY_ROUTE_PREFIXES.includes(prefix)) continue;
      expect(
        DEAD_CAPABILITY_TOKENS,
        `${visit.path} puts a token this list does not vouch for on a ${prefix} capability route. ` +
          "The URL is the credential there, so a screenshot of that surface or an issue body " +
          "quoting the path hands whoever reads it a working link. Either walk a token that was " +
          "never valid and add it to DEAD_CAPABILITY_TOKENS, or redact through " +
          "src/lib/capability-urls.ts before anything is published.",
      ).toContain(segment);
    }
  });

  it("actually looks at something — the guard above is worthless on an empty list", () => {
    const capability = walkPlan().filter((visit) =>
      CAPABILITY_ROUTE_PREFIXES.includes(visit.path.split("/")[1]),
    );

    expect(capability.length).toBeGreaterThan(0);
  });

  it("knows every probe it can report, axe rules included", () => {
    for (const probe of Object.keys(PROBES)) expect(probeFor(probe)).not.toBeNull();
    expect(probeFor("axe:anything-at-all")).not.toBeNull();
    expect(probeFor("not-a-probe")).toBeNull();
  });
});
