import { and, eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookings, people, trips, waiverRecords } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { completeWaiver } from "@/db/waivers-completion";
import { recordMedicalEvaluation } from "@/db/waivers-medical";
import { issueWaiverRequest } from "@/db/waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "@/db/waivers-test-fixtures";
import { DOCTOR_UNLOCK_FAILURE_LIMIT } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/observability/render-connection", () => ({
  connectionForRoute: vi.fn(async () => undefined),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
    checkRateLimitFailClosed: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
  };
});
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US"),
  requestFirstHandLocale: vi.fn(async () => null),
}));

const { getDb } = await import("@/db/client");
const { checkRateLimit, checkRateLimitFailClosed, RATE_LIMITS, rateLimitKey } = await import(
  "@/lib/rate-limit"
);
const { default: DoctorReferralPage } = await import("./page");
const { revealDoctorAnswersAction } = await import("./actions");

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(checkRateLimitFailClosed).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

/**
 * **The doctor's page, against a real database** (fifth-loop ideas, item 17;
 * H-127, ADR 20261016-doctor-referral-page). The waiver link is its whole
 * authority, so every case is the link's record deciding what renders.
 */
/**
 * **The doctor's page, against a real database** (fifth-loop ideas, item 17;
 * H-127 and ADR 20261016-doctor-referral-page, amended by the layer r5-3
 * reviews). The waiver link is its whole authority for the page; the answers
 * need the diver's date of birth as well.
 */
describe("the doctor's page", () => {
  async function signedLink(
    medicalAnswers: typeof clearAnswers,
    { dateOfBirth = "1984-03-09" as string | null } = {},
  ) {
    const { db, shop, booking, person } = await waiverContext();
    vi.mocked(getDb).mockResolvedValue(db);
    await db.update(people).set({ dateOfBirth }).where(eq(people.id, person.id));
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers,
      now,
    });
    return { db, token: issued.token, person, shop, booking };
  }

  const render = async (token: string) =>
    renderToStaticMarkup(await DoctorReferralPage({ params: Promise.resolve({ token }) }));

  const reveal = (token: string, birthdate: string) => {
    const form = new FormData();
    form.set("birthdate", birthdate);
    return revealDoctorAnswersAction(token, { status: "locked" }, form);
  };

  it("prints the name and the official form, and keeps the birthdate and answers off the page", async () => {
    const { token, person, shop } = await signedLink(medicalReferralAnswers);
    const html = (await render(token)).replace(/\u00a0/g, " ");
    expect(html).toContain(person.fullName);
    expect(html).toContain("Diver Medical | Participant Questionnaire");
    expect(html).toContain("10346 EN");
    expect(html).toContain("print page 3");
    expect(html).toContain('name="birthdate"');
    expect(html).not.toContain("1984");
    expect(html).not.toContain("Mar 9");
    expect(html).not.toContain("Question 3");
    expect(html).not.toContain("moderate exercise");
    // The upload leads; the shop's email is the fallback (issue #2797).
    expect(html).toContain(
      "Send a photo or PDF of the signed form here, with the physician’s signature and date in it.",
    );
    expect(html).toContain('name="doctorForm"');
    if (shop.contactEmail) {
      expect(html).toContain(
        `Can’t send it here? Email a photo to <a href="mailto:${shop.contactEmail}"`,
      );
      expect(html.indexOf('name="doctorForm"')).toBeLessThan(html.indexOf("mailto:"));
    }
  });

  it("says the shop has the form once it is sent, and never prints where it is stored", async () => {
    const { db, token, person } = await signedLink(medicalReferralAnswers);
    const stored = "https://media.example.com/medical-clearances/sent.jpg";
    await db
      .update(waiverRecords)
      .set({ diverMedicalFormUrl: stored, diverMedicalFormSentAt: now })
      .where(
        and(eq(waiverRecords.personId, person.id), eq(waiverRecords.status, "medical_review")),
      );
    const html = await render(token);
    expect(html).toContain("You’re not cleared to dive until staff have read it and told you.");
    expect(html).not.toContain('name="doctorForm"');
    expect(html).not.toContain("media.example.com");
    expect(html).not.toContain("Can’t send it here?");
  });

  it("prints with no page margin, so the browser has nowhere to print the link", async () => {
    const { token } = await signedLink(medicalReferralAnswers);
    const html = await render(token);
    expect(html).toMatch(/<style data-capability-print="">@page\{margin:0;/);
  });

  it("asks for the whole questionnaire when no date of birth is on file", async () => {
    const { token } = await signedLink(medicalReferralAnswers, { dateOfBirth: null });
    const html = await render(token);
    expect(html).toContain("Go through the whole questionnaire with your doctor.");
    expect(html).not.toContain('name="birthdate"');
    expect(html).not.toContain("wasn");
  });

  it("shows the published prompts and the form version only for the diver's date of birth", async () => {
    const { token } = await signedLink(medicalReferralAnswers);
    expect(await reveal(token, "1990-01-01")).toEqual({ status: "mismatch" });
    const shown = await reveal(token, "1984-03-09");
    if (shown.status !== "open") throw new Error(`expected the answers, got ${shown.status}`);
    expect(shown.items).toHaveLength(1);
    expect(shown.items[0]?.label).toBe("Question 3");
    expect(shown.items[0]?.prompt).toContain("moderate exercise");
    expect(shown.source).toBe(
      "From Diver Medical | Participant Questionnaire (10346 EN, version 2026-01-01), the form you answered.",
    );
  });

  it("rate-limits the unlock per IP, and per diver failing closed", async () => {
    const { token, person } = await signedLink(medicalReferralAnswers);
    await reveal(token, "1984-03-09");
    expect(vi.mocked(checkRateLimit).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [rateLimitKey("waiver-token", "203.0.113.7"), RATE_LIMITS.capabilityAction],
    ]);
    // Keyed by the diver, never the token, the record or the address: neither
    // rotating addresses nor a reissued link buys a fresh budget.
    expect(vi.mocked(checkRateLimitFailClosed).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [rateLimitKey("doctor-answers", person.id), RATE_LIMITS.doctorAnswersByPerson],
    ]);
    vi.mocked(checkRateLimitFailClosed).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1 });
    expect(await reveal(token, "1984-03-09")).toEqual({ status: "rate" });
  });

  it("says to go through the whole questionnaire once the wrong dates reach the ceiling", async () => {
    const { db, token, person } = await signedLink(medicalReferralAnswers);
    await db
      .update(waiverRecords)
      .set({ doctorUnlockFailures: DOCTOR_UNLOCK_FAILURE_LIMIT - 1 })
      .where(eq(waiverRecords.personId, person.id));
    expect(await reveal(token, "1990-01-01")).toEqual({ status: "whole" });
    expect(await reveal(token, "1984-03-09")).toEqual({ status: "whole" });
    const html = await render(token);
    expect(html).toContain("Go through the whole questionnaire with your doctor.");
    expect(html).not.toContain('name="birthdate"');
  });

  it("sends a clean release back to its waiver page", async () => {
    const { token } = await signedLink(clearAnswers);
    await expect(render(token)).rejects.toThrow(`REDIRECT:/waivers/${token}`);
  });

  it("sends a link it cannot read back to the waiver page, encoded", async () => {
    vi.mocked(getDb).mockResolvedValue(fileCtx.db);
    await expect(render("not-a-real-token")).rejects.toThrow("REDIRECT:/waivers/not-a-real-token");
    await expect(render("a/../b")).rejects.toThrow("REDIRECT:/waivers/a%2F..%2Fb");
  });

  it.each(["declined", "erased", "anonymized"] as const)(
    "sends a %s hold back to the waiver page",
    async (end) => {
      const at = new Date(now.getTime() + 60_000);
      const { db, token, person, shop } = await signedLink(medicalReferralAnswers);
      if (end === "declined") {
        // A physician's "no", recorded the way staff record it.
        const [staff] = await listStaff(db, shop.id);
        if (!staff) throw new Error("demo staff missing");
        const answered = await recordMedicalEvaluation(db, {
          outcome: "not_cleared",
          shopId: shop.id,
          personId: person.id,
          recordedByPersonId: staff.person.id,
          evaluatedOn: "2026-07-18",
          physicianName: "Dr. Imani Reyes",
          now: at,
        });
        expect(answered).toMatchObject({ ok: true });
      } else if (end === "erased") {
        await db.update(people).set({ deletedAt: at }).where(eq(people.id, person.id));
      } else {
        await db
          .update(waiverRecords)
          .set({ anonymizedAt: at })
          .where(eq(waiverRecords.personId, person.id));
      }
      await expect(render(token)).rejects.toThrow(`REDIRECT:/waivers/${token}`);
    },
  );

  it("sends a canceled seat or a departure long over back to the waiver page", async () => {
    const { db, token, booking } = await signedLink(medicalReferralAnswers);
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    await expect(render(token)).rejects.toThrow(`REDIRECT:/waivers/${token}`);
    expect(await reveal(token, "1984-03-09")).toEqual({ status: "closed" });
    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, booking.id));
    const longAgo = new Date("2020-01-01T12:00:00.000Z");
    await db
      .update(trips)
      .set({ startsAt: new Date(longAgo.getTime() - 3_600_000), endsAt: longAgo })
      .where(eq(trips.id, booking.tripId));
    await expect(render(token)).rejects.toThrow(`REDIRECT:/waivers/${token}`);
  });
});
