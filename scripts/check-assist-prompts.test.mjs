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
      "src/db/recap-assist.ts": 'import { w } from "./waivers";\n',
      "src/app/shop/x/outcome.ts":
        'const v = await runAssistOutcome(db, input);\nimport { m } from "@/lib/medical";\n',
      "src/db/x-reads.ts":
        'import { assistsAvailable } from "./assists";\nimport { r } from "./waiver-records";\n',
      "src/app/shop/x/alias.ts":
        'import { assistsAvailable } from "@/db/assists";\nconst a = row.medical_answers;\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/db/recap-assist.ts:1: imports ./waivers");
    expect(result.stderr).toContain("src/app/shop/x/outcome.ts:2: imports @/lib/medical");
    expect(result.stderr).toContain("src/db/x-reads.ts:2: imports ./waiver-records");
    expect(result.stderr).toContain("src/app/shop/x/alias.ts:2: names medical data");
  });

  it("refuses the crew's medical alert, by any spelling, and the waiver table from the schema barrel", () => {
    const result = runGuard(GUARD, {
      "src/db/inbox-assists.ts":
        'import { bookings, waiverRecords } from "./schema";\nconst a = await db.select({ alert: waiverRecords.medicalAlert });\n',
      "src/lib/assists/x.ts":
        'import {\n  waiverRecords,\n} from "@/db/schema";\nconst d = row.draftMedicalAlert;\nconst c = sql`medical_alert`;\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "src/db/inbox-assists.ts:1: imports waiverRecords from ./schema",
    );
    expect(result.stderr).toContain("src/db/inbox-assists.ts:2: names medical data");
    expect(result.stderr).toContain(
      "src/lib/assists/x.ts:1: imports waiverRecords from @/db/schema",
    );
    expect(result.stderr).toContain("src/lib/assists/x.ts:4: names medical data");
    expect(result.stderr).toContain("src/lib/assists/x.ts:5: names medical data");
  });

  it("leaves a prompt module's other tables from the schema barrel alone", () => {
    const result = runGuard(GUARD, {
      "src/db/inbox-assists.ts": 'import { bookings, inboundMessages } from "./schema";\n',
    });
    expect(result.status).toBe(0);
  });

  it("leaves modules that build no prompt, tests and the seam itself alone", () => {
    const result = runGuard(GUARD, {
      "src/app/shop/x/page.tsx": 'import { needsMedicalReview } from "@/lib/medical";\n',
      "src/lib/assists/inbox.test.ts": 'import { x } from "@/lib/medical";\n',
      "src/lib/assists/inbox.ts": 'import { z } from "zod";\nexport const a = z.string();\n',
      "src/db/assists.ts": 'import { x } from "./schema";\n',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 prompt module(s), none reads medical data");
  });
});
