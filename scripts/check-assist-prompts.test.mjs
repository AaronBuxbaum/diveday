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
    expect(result.stderr).toContain("src/app/shop/x/actions.ts:3: names medical answers");
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
