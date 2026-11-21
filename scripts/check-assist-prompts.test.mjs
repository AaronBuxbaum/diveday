import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

const GUARD = "check-assist-prompts.mjs";

describe("check-assist-prompts", () => {
  it("refuses a prompt module that imports a medical reader", () => {
    const result = runGuard(GUARD, {
      "src/lib/assists/inbox.ts": 'import { needsMedicalReview } from "@/lib/medical";\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/lib/assists/inbox.ts:1: imports @/lib/medical");
  });

  it("refuses a caller of runAssist that reads the waiver answers", () => {
    const result = runGuard(GUARD, {
      "src/app/shop/x/actions.ts":
        'import { runAssist } from "@/db/assists";\nimport { medicalFor } from "@/db/waivers-medical";\nconst q = row.medicalAnswers;\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/app/shop/x/actions.ts:2: imports @/db/waivers-medical");
    expect(result.stderr).toContain("src/app/shop/x/actions.ts:3: names medical data");
  });

  it("refuses a db module that calls the seam through a relative import", () => {
    const result = runGuard(GUARD, {
      "src/db/x-assists.ts":
        'import { runAssist } from "./assists";\nimport { medicalAnswersFor } from "./medical-questionnaire";\nimport { w } from "./waivers";\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/db/x-assists.ts:2: imports ./medical-questionnaire");
    expect(result.stderr).toContain("src/db/x-assists.ts:3: imports ./waivers");
  });

  it("refuses each way a prompt is reached: an assist db module, runAssistOutcome and the seam's import", () => {
    const result = runGuard(GUARD, {
      "src/features/after-the-dive/recap/recap-assist.store.ts": 'import { w } from "./waivers";\n',
      "src/app/shop/x/outcome.ts":
        'const v = await runAssistOutcome(db, input);\nimport { m } from "@/lib/medical";\n',
      "src/db/x-reads.ts":
        'import { assistsAvailable } from "./assists";\nimport { r } from "./waiver-records";\n',
      "src/app/shop/x/alias.ts":
        'import { assistsAvailable } from "@/db/assists";\nconst a = row.medical_answers;\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "src/features/after-the-dive/recap/recap-assist.store.ts:1: imports ./waivers",
    );
    expect(result.stderr).toContain("src/app/shop/x/outcome.ts:2: imports @/lib/medical");
    expect(result.stderr).toContain("src/db/x-reads.ts:2: imports ./waiver-records");
    expect(result.stderr).toContain("src/app/shop/x/alias.ts:2: names medical data");
  });

  it("refuses the crew's medical alert, by any spelling, and the waiver table from the schema barrel", () => {
    const result = runGuard(GUARD, {
      "src/features/ai/inbox-assists.ts":
        'import { bookings, waiverRecords } from "./schema";\nconst a = await db.select({ alert: waiverRecords.medicalAlert });\n',
      "src/lib/assists/x.ts":
        'import {\n  waiverRecords,\n} from "@/db/schema";\nconst d = row.draftMedicalAlert;\nconst c = sql`medical_alert`;\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "src/features/ai/inbox-assists.ts:1: imports waiverRecords from ./schema",
    );
    expect(result.stderr).toContain("src/features/ai/inbox-assists.ts:2: names medical data");
    expect(result.stderr).toContain(
      "src/lib/assists/x.ts:1: imports waiverRecords from @/db/schema",
    );
    expect(result.stderr).toContain("src/lib/assists/x.ts:4: names medical data");
    expect(result.stderr).toContain("src/lib/assists/x.ts:5: names medical data");
  });

  it("leaves a prompt module's other tables from the schema barrel alone", () => {
    const result = runGuard(GUARD, {
      "src/features/ai/inbox-assists.ts": 'import { bookings, inboundMessages } from "./schema";\n',
    });
    expect(result.status).toBe(0);
  });

  it("leaves modules that build no prompt, tests and the seam itself alone", () => {
    const result = runGuard(GUARD, {
      "src/app/shop/x/page.tsx": 'import { needsMedicalReview } from "@/lib/medical";\n',
      "src/lib/assists/inbox.test.ts": 'import { x } from "@/lib/medical";\n',
      "src/lib/assists/inbox.ts": 'import { z } from "zod";\nexport const a = z.string();\n',
      "src/features/ai/assists/store.ts": 'import { x } from "./schema";\n',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 prompt module(s), none reads medical data");
  });
});

describe("feature prompt ownership", () => {
  it("refuses medical readers from moved and future feature prompt modules", () => {
    const result = runGuard(GUARD, {
      "src/features/ai/assists/future.ts": 'import { data } from "@/features/waivers/waivers-medical";\n',
      "src/features/ai/future-assist/store.ts": 'import { waiverRecords } from "@/db/schema";\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "src/features/ai/assists/future.ts:1: imports @/features/waivers/waivers-medical",
    );
    expect(result.stderr).toContain(
      "src/features/ai/future-assist/store.ts:1: imports waiverRecords",
    );
  });
  it("still leaves unrelated feature modules alone", () => {
    const result = runGuard(GUARD, {
      "src/features/boarding/roster/store.ts":
        'import { needsMedicalReview } from "@/lib/medical";\n',
    });
    expect(result.status).toBe(0);
  });
});

// Each prompt contract remains guarded after leaving the shared execution directory.
describe("independent prompt concepts", () => {
  it("refuses medical readers in every split prompt directory", () => {
    const roots = [
      "src/features/gear/bench-note.ts",
      "src/features/bookings/booking-request.ts",
      "src/features/certifications/cert-scan.ts",
      "src/features/ai/description-draft.ts",
      "src/features/reports/monday-summary.ts",
      "src/features/after-the-dive/recap-line.ts",
      "src/features/gear/rental-note.ts",
      "src/features/after-the-dive/review-flags.ts",
      "src/features/after-the-dive/review-themes.ts",
      "src/features/people/same-person.ts",
      "src/features/sites/site-brief.ts",
      "src/features/waivers/waiver-draft.ts",
      "src/features/ai/website-reading.ts",
    ];
    const files = Object.fromEntries(
      roots.map((file) => [file, 'import { data } from "@/features/waivers/waivers-medical";\n']),
    );
    const result = runGuard(GUARD, files);
    expect(result.status).toBe(1);
    for (const file of roots) {
      expect(result.stderr).toContain(`${file}:1: imports @/features/waivers/waivers-medical`);
    }
  });
});
