import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, MINUTE_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { people, waiverDrafts, waiverRecords } from "./schema";
import { completeWaiver, recordWaiverDraft } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import * as templates from "./waivers-templates";
import {
  clearAnswers,
  issueCounterLink,
  openOnDevice,
  waiverContextFor,
} from "./waivers-test-fixtures";

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
    ["sign", "release"],
    ["draft", "release"],
  ] as const)(
    "refuses %s and its contact when the %s link expires during a question read",
    async (operation, expiryKind) => {
      const { db, shop, booking, person } = await context();
      let key: Parameters<typeof completeWaiver>[1];
      let recordId: string;
      let expiresAt: Date;
      if (expiryKind === "counter") {
        // A counter link minted 29 and a half minutes ago: half a minute left.
        const link = await issueCounterLink(db, {
          shopId: shop.id,
          bookingId: booking.id,
          now: new Date(nowDate().getTime() - 29.5 * MINUTE_MS),
        });
        const door = await openOnDevice(db, link.token);
        if (door?.door !== "counter") throw new Error("counter door missing");
        key = door.key;
        recordId = link.recordId;
        expiresAt = link.expiresAt;
      } else {
        // A release link to a release with no seat, minted a week less half a
        // minute ago.
        const issued = await issueWaiverRequest(db, {
          shopId: shop.id,
          personId: person.id,
          now: new Date(nowDate().getTime() - 7 * DAY_MS + 0.5 * MINUTE_MS),
        });
        if (!issued.ok || issued.key.kind !== "release") throw new Error("link missing");
        key = issued.key;
        recordId = issued.recordId;
        expiresAt = issued.key.expiresAt;
      }
      const original = templates.getWaiverTemplateQuestions;
      vi.spyOn(templates, "getWaiverTemplateQuestions").mockImplementation(async (...args) => {
        const result = await original(...args);
        vi.stubEnv("DIVEDAY_CLOCK", expiresAt.toISOString());
        return result;
      });
      const result =
        operation === "sign"
          ? await completeWaiver(db, key, {
              signerName: person.fullName,
              agreed: true,
              medicalAnswers: clearAnswers,
              emergencyContact: { name: "Jordan", phone: "1234567890" },
            })
          : await recordWaiverDraft(db, key, {
              acknowledged: true,
              medicalAnswers: clearAnswers,
              shopAnswers: {},
              emergencyContact: { name: "Jordan", phone: "1234567890" },
            });
      if (operation === "sign") expect(result).toEqual({ ok: false, reason: "unavailable" });
      else expect(result).toBe(false);
      const [stored] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
      expect(stored?.status).toBe("pending");
      expect(
        await db.select().from(waiverDrafts).where(eq(waiverDrafts.waiverRecordId, recordId)),
      ).toEqual([]);
      const [after] = await db.select().from(people).where(eq(people.id, person.id));
      expect(after?.emergencyContactName).toBe(person.emergencyContactName);
      expect(after?.emergencyContactPhone).toBe(person.emergencyContactPhone);
    },
  );
});
