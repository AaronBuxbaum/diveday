import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bodyProblems,
  closedByBody,
  closesProblems,
  issuesClaimedBy,
  reviewAnswered,
  reviewsNeeded,
  reviewsSection,
} from "./check-pr-body.mjs";

const TEMPLATE = readFileSync(
  path.join(import.meta.dirname, "../.github/pull_request_template.md"),
  "utf8",
);
const filled = (domain, security) =>
  TEMPLATE.replace("- `dive-domain-expert`:", `- \`dive-domain-expert\`: ${domain}`).replace(
    "- `security-reviewer`:",
    `- \`security-reviewer\`: ${security}`,
  );

describe("which reviewer a diff needs", () => {
  it("asks dive-domain-expert for manifests, roll call, readiness, certs, medical and erasure", () => {
    for (const file of [
      "src/lib/manifests.ts",
      "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.tsx",
      "src/lib/readiness.ts",
      "src/lib/trip-admission.ts",
      "src/db/schema/certifications.ts",
      "src/components/MedicalClearanceControl.tsx",
      "src/db/seat-diver.ts",
      "src/db/bookings.ts",
      "src/db/waivers.ts",
      "src/lib/waivers.ts",
      "src/db/waivers-medical.ts",
    ]) {
      expect(reviewsNeeded([file]).map((r) => r.agent)).toContain("dive-domain-expert");
    }
  });

  it("asks security-reviewer for auth, token routes, personal-data schema and export/import", () => {
    for (const file of [
      "src/proxy.ts",
      "src/lib/authz.ts",
      "src/app/waivers/[token]/actions.ts",
      "src/app/calendar/[token]/route.ts",
      "src/db/export.ts",
      "src/db/schema/accounts.ts",
      "src/features/backup-export/index.ts",
      "src/db/waivers.ts",
      "src/lib/waiver-tokens.ts",
      "src/lib/payments/checkout.ts",
      "src/app/api/webhooks/stripe/route.ts",
      "src/app/api/webhooks/sms/route.ts",
    ]) {
      expect(reviewsNeeded([file]).map((r) => r.agent)).toContain("security-reviewer");
    }
  });

  it("leaves alone docs, copy bundles, the PWA manifest and ordinary surfaces", () => {
    expect(
      reviewsNeeded([
        "docs/product/glossary.md",
        "docs/architecture/decisions/20260804-roll-call.md",
        "src/i18n/locales/en-US/staff/manifest.json",
        "src/app/manifest.ts",
        "src/app/shop/[shopSlug]/gear/page.tsx",
        "src/app/ready/[token]/_components/TipAmountPicker.tsx",
        "scripts/check-pr-body.mjs",
        "src/db/bookings-history.ts",
        "src/app/shop/[shopSlug]/waivers/page.tsx",
      ]),
    ).toEqual([]);
  });
});

describe("reading the body", () => {
  it("finds the Reviews section and ignores the template's comments", () => {
    const section = reviewsSection(TEMPLATE);
    expect(section).not.toBeNull();
    expect(section).not.toContain("<!--");
    expect(reviewAnswered(section, "dive-domain-expert")).toBe(false);
  });

  it("counts a launch, a finding or a reasoned 'not needed' as an answer, never a placeholder", () => {
    expect(
      reviewAnswered(
        "- `dive-domain-expert`: launched; found DSD counts off, fixed",
        "dive-domain-expert",
      ),
    ).toBe(true);
    expect(
      reviewAnswered("- `dive-domain-expert`: nothing found on abc123", "dive-domain-expert"),
    ).toBe(true);
    expect(
      reviewAnswered(
        "- dive-domain-expert — not needed because only a test helper moved",
        "dive-domain-expert",
      ),
    ).toBe(true);
    expect(reviewAnswered("- `dive-domain-expert`: <what it found>", "dive-domain-expert")).toBe(
      false,
    );
    expect(reviewAnswered("- `dive-domain-expert`: yes/no", "dive-domain-expert")).toBe(false);
    // The two that passed before 2026-10-12 and said nothing.
    expect(reviewAnswered("- `dive-domain-expert`: yes", "dive-domain-expert")).toBe(false);
    expect(reviewAnswered("- `dive-domain-expert`: n/a", "dive-domain-expert")).toBe(false);
    expect(reviewAnswered("- `dive-domain-expert`: ran, clean", "dive-domain-expert")).toBe(false);
    expect(reviewAnswered("- `dive-domain-expert`: not launched", "dive-domain-expert")).toBe(
      false,
    );
    expect(reviewAnswered("- `dive-domain-expert`: not needed because", "dive-domain-expert")).toBe(
      false,
    );
    expect(reviewAnswered("- `security-reviewer`: ran, clean", "dive-domain-expert")).toBe(false);
  });
});

describe("the whole check", () => {
  const manifest = ["src/lib/manifests.ts"];
  const both = ["src/lib/manifests.ts", "src/lib/authz.ts"];

  it("passes a diff that needs no reviewer whatever the body says", () => {
    expect(bodyProblems({ body: "", files: ["src/app/page.tsx"] })).toEqual([]);
  });

  it("fails an empty body or the untouched template on a safety path, naming the path", () => {
    const [problem] = bodyProblems({ body: "", files: manifest });
    expect(problem).toContain("src/lib/manifests.ts");
    expect(problem).toContain("dive-domain-expert");
    expect(bodyProblems({ body: TEMPLATE, files: both })).toHaveLength(2);
  });

  it("passes once each needed reviewer is answered", () => {
    expect(
      bodyProblems({ body: filled("launched on abc123, nothing found", ""), files: manifest }),
    ).toEqual([]);
    expect(
      bodyProblems({
        body: filled("launched, found the DSD count off; fixed", "launched, found nothing"),
        files: both,
      }),
    ).toEqual([]);
    expect(bodyProblems({ body: filled("launched", ""), files: both })).toHaveLength(1);
  });

  it("does not read a reviewer named outside the Reviews section", () => {
    const body = "## What\n\n- dive-domain-expert: launched\n\n## Reviews launched\n\n- none\n";
    expect(bodyProblems({ body, files: manifest })).toHaveLength(1);
  });
});

describe("closing the issues this branch claimed", () => {
  // #2241's claim, verbatim in shape: the sweep wrote "closes with #2326" in a comment, the PR
  // body never said Closes, and the issue stayed open after the merge.
  const claim = (branch) => ({
    body: `## Claim\n\n- Branch: \`${branch}\` (sub-branch \`${branch}-l2\`)\n- Worktree: \`/w\`\n- Started: 2026-10-10T08:20Z\n`,
    createdAt: "2026-10-10T08:21:23Z",
  });
  const issues = [
    { number: 2241, comments: [claim("claude/project-thread-f9bes8")] },
    { number: 2233, comments: [claim("claude/elsewhere")] },
    { number: 1785, comments: [{ body: "working on it", createdAt: "2026-10-10T08:00:00Z" }] },
  ];

  it("finds the issues whose newest claim names the head branch", () => {
    expect(issuesClaimedBy(issues, "claude/project-thread-f9bes8")).toEqual([2241]);
    expect(issuesClaimedBy(issues, "")).toEqual([]);
  });

  it("reads every closing keyword, one per issue", () => {
    expect([...closedByBody("Closes #1\nfixes #2\nResolved: #3\nSee #4\nCloses #5, #6")]).toEqual([
      1, 2, 3, 5,
    ]);
  });

  it("asks for a Closes line for each claimed issue the body leaves open", () => {
    const head = "claude/project-thread-f9bes8";
    const [problem] = closesProblems({
      body: "## Follow-ups filed\n\nnone",
      claimed: [2241],
      head,
    });
    expect(problem).toMatch(/#2241 is claimed by this branch/);
    expect(problem).toContain('"Closes #2241"');
    expect(closesProblems({ body: "Closes #2241", claimed: [2241], head })).toEqual([]);
    expect(closesProblems({ body: "", claimed: [], head })).toEqual([]);
  });
});
