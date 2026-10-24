import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { isCompletedWaiverCurrent } from "@/lib/waivers";
import { seededShopContext } from "@/test/db";
import { waiverRecords } from "./schema";
import { DEMO_SHOP_QUESTIONS } from "./seed-waiver-questions";
import { getCurrentWaiverTemplate } from "./waivers";

describe("seeded shop questions", () => {
  it("asks the shop's questions on the current version, none of them required", async () => {
    const { db, shop } = await seededShopContext();
    const current = await getCurrentWaiverTemplate(db, shop.id);
    expect(current?.questions).toEqual(DEMO_SHOP_QUESTIONS);
    // The fixture every signing test and spec uses: a required question would
    // refuse each signature that does not know about it.
    expect(DEMO_SHOP_QUESTIONS.some((question) => question.required)).toBe(false);
    // No last-dive question: currency is asked on each booking.
    expect(DEMO_SHOP_QUESTIONS.some((question) => question.kind === "date")).toBe(false);
  });

  it("leaves one sealed online release answering them, and every signature current", async () => {
    const { db, shop } = await seededShopContext();
    const current = await getCurrentWaiverTemplate(db, shop.id);
    if (!current) throw new Error("seeded waiver template missing");
    const answered = await db
      .select()
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, shop.id),
          isNotNull(waiverRecords.shopAnswers),
          // The medical alert's release answers them too (seed-medical-alert.ts).
          isNull(waiverRecords.medicalAlert),
        ),
      );
    expect(answered).toHaveLength(1);
    const [record] = answered;
    if (!record) throw new Error("answered release missing");
    expect(record.signatureMethod).toBe("typed_consent");
    expect(record.status).toBe("completed");
    expect(record.templateId).toBe(current.id);
    expect(record.shopAnswers?.map((answer) => answer.id)).toEqual(
      DEMO_SHOP_QUESTIONS.map((question) => question.id),
    );
    expect(verifyWaiverIntegrity(record)).toBe("valid");
    expect(isCompletedWaiverCurrent(record, current.materialGeneration)).toBe(true);
  });
});
