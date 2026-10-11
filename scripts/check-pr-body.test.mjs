import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bodyProblems, reviewAnswered, reviewsNeeded, reviewsSection } from "./check-pr-body.mjs";

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

  it("counts a finding or a reasoned 'not needed' as an answer, never a placeholder", () => {
    expect(
      reviewAnswered(
        "- `dive-domain-expert`: ran; flagged DSD counts, fixed",
        "dive-domain-expert",
      ),
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
      bodyProblems({ body: filled("ran on abc123, no findings", ""), files: manifest }),
    ).toEqual([]);
    expect(
      bodyProblems({ body: filled("ran, fixed the DSD count", "ran, clean"), files: both }),
    ).toEqual([]);
    expect(bodyProblems({ body: filled("ran", ""), files: both })).toHaveLength(1);
  });

  it("does not read a reviewer named outside the Reviews section", () => {
    const body = "## What\n\n- dive-domain-expert: ran\n\n## Reviews launched\n\n- none\n";
    expect(bodyProblems({ body, files: manifest })).toHaveLength(1);
  });
});
