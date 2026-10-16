import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { people } from "@/db/schema";
import { completeWaiver } from "@/db/waivers-completion";
import { issueWaiverRequest } from "@/db/waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "@/db/waivers-test-fixtures";
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
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US"),
  requestFirstHandLocale: vi.fn(async () => null),
}));

const { getDb } = await import("@/db/client");
const { default: DoctorReferralPage } = await import("./page");

afterEach(() => vi.clearAllMocks());

/**
 * **The doctor's page, against a real database** (fifth-loop ideas, item 17;
 * H-127, ADR 20261016-doctor-referral-page). The waiver link is its whole
 * authority, so every case is the link's record deciding what renders.
 */
describe("the doctor's page", () => {
  async function signedLink(medicalAnswers: typeof clearAnswers) {
    const { db, shop, booking, person } = await waiverContext();
    vi.mocked(getDb).mockResolvedValue(db);
    await db.update(people).set({ dateOfBirth: "1984-03-09" }).where(eq(people.id, person.id));
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers,
      now,
    });
    return { token: issued.token, person, shop };
  }

  const render = async (token: string) =>
    renderToStaticMarkup(await DoctorReferralPage({ params: Promise.resolve({ token }) }));

  it("prints the name, birthdate and question number for a held release, never the answer", async () => {
    const { token, person, shop } = await signedLink(medicalReferralAnswers);
    const html = await render(token);
    expect(html).toContain(person.fullName);
    expect(html.replace(/\u00a0/g, " ")).toContain("Mar 9, 1984");
    expect(html).toContain("Question 3");
    expect(html).toContain("Medical Examiner&#x27;s Evaluation Form");
    expect(html).not.toContain("moderate exercise");
    if (shop.contactEmail) {
      expect(html).toContain(`send a photo to <a href="mailto:${shop.contactEmail}"`);
    }
  });

  it("sends a clean release back to its waiver page", async () => {
    const { token } = await signedLink(clearAnswers);
    await expect(render(token)).rejects.toThrow(`REDIRECT:/waivers/${token}`);
  });

  it("sends a link it cannot read back to the waiver page", async () => {
    vi.mocked(getDb).mockResolvedValue(fileCtx.db);
    await expect(render("not-a-real-token")).rejects.toThrow("REDIRECT:/waivers/not-a-real-token");
  });
});
