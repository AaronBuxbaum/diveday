import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { sealCounterWaiverToken } from "@/lib/counter-waiver-token";
import { fileScopedShopContext } from "@/test/db";
import { people, waiverRecords } from "./schema";
import { completeWaiver, saveWaiverDraft } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import * as templates from "./waivers-templates";
import { clearAnswers, waiverContextFor } from "./waivers-test-fixtures";

const ctx = fileScopedShopContext();
const context = waiverContextFor(ctx);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("waiver expiry during validation", () => {
  it.each([
    ["sign", "counter"],
    ["draft", "counter"],
    ["sign", "inner"],
    ["draft", "inner"],
  ] as const)(
    "refuses %s and its contact when the %s link expires during a question read",
    async (operation, expiryKind) => {
      vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
      const { db, shop, booking, person } = await context();
      const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
      if (!issued.ok) throw new Error("link missing");
      const expiresAt =
        expiryKind === "counter" ? new Date(nowDate().getTime() + 60_000) : issued.expiresAt;
      const envelopeExpiry =
        expiryKind === "counter" ? expiresAt : new Date(expiresAt.getTime() + 60_000);
      const envelope = sealCounterWaiverToken(issued.token, envelopeExpiry);
      if (!envelope) throw new Error("envelope missing");
      const original = templates.getWaiverTemplateQuestions;
      vi.spyOn(templates, "getWaiverTemplateQuestions").mockImplementation(async (...args) => {
        const result = await original(...args);
        vi.stubEnv("DIVEDAY_CLOCK", expiresAt.toISOString());
        return result;
      });
      const result =
        operation === "sign"
          ? await completeWaiver(db, envelope, {
              signerName: person.fullName,
              agreed: true,
              medicalAnswers: clearAnswers,
              emergencyContact: { name: "Jordan", phone: "1234567890" },
            })
          : await saveWaiverDraft(db, envelope, {
              acknowledged: true,
              medicalAnswers: clearAnswers,
              shopAnswers: {},
              emergencyContact: { name: "Jordan", phone: "1234567890" },
            });
      if (operation === "sign")
        expect(result).toEqual({
          ok: false,
          reason: expiryKind === "counter" ? "unavailable" : "expired",
        });
      else expect(result).toBe(false);
      const [stored] = await db
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.id, issued.recordId));
      expect(stored?.status).toBe("pending");
      expect(stored?.draftAcknowledged).not.toBe(true);
      const [after] = await db.select().from(people).where(eq(people.id, person.id));
      expect(after?.emergencyContactName).toBe(person.emergencyContactName);
      expect(after?.emergencyContactPhone).toBe(person.emergencyContactPhone);
    },
  );
});
