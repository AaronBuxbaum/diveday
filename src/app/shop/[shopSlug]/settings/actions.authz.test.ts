import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import {
  mediaDeletionAttempts,
  processorErasureObligations,
  shopShoreAlertTokens,
  shops,
} from "@/db/schema";
import { getShopById } from "@/db/shops";
import { calendarDateInTimezone, shiftCalendarDateMonths } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  demoteOwnerToManager,
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * The "Units" card saves three settings behind one button, and only two of them
 * are ordinary staff work. Depth and water temperature are display-and-entry
 * preferences anyone on the crew may set; currency decides what a diver's card
 * is charged in, which is owner/manager work (H-14).
 *
 * The page hides the currency `<select>` from everyone else, but hiding a field
 * is not a gate — a hand-made form post carries whatever it likes. These tests
 * run the real action against a real seeded database with only the session and
 * Next's navigation primitives faked, and check the `shops` row after the
 * refusal rather than the notice alone: `setShopCurrency` has no gate of its
 * own and writes whatever it is handed.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { revalidatePath } = await import("next/cache");
const { requireStaffSession } = await import("@/lib/session");
const { resendShoreAlertConfirmationAction, saveEmergencyReferenceAction } = await import(
  "./boat-actions"
);
const { saveDockDayAction } = await import("./dock-day/actions");
const { savePackingAction } = await import("./booking-actions");
const { dischargeProcessorErasureAction, retryMediaDeletionAction, retryProcessorErasureAction } =
  await import("./data-actions");
const { disconnectAction, refreshAction } = await import("./money-actions");
const { saveRentalsAction } = await import("./rental-actions");
const { saveAddressAction, saveReopensOnAction, saveTimezoneAction, saveUnitsAction } =
  await import("./shop-actions");
const { saveCrewScheduleAction } = await import("./team-actions");
const { saveProfileAction } = await import("./website-actions");

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

/**
 * A complete, valid rhythm submission. All six fields every time, because the
 * action parses them as one record — a partial post is exactly what it refuses.
 */
function dockDayForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const defaults: Record<string, string> = {
    dockCallMinutes: "90",
    gearSetupMinutes: "0",
    briefingMinutes: "15",
    boatRideMinutes: "20",
    bottomTimeMinutes: "45",
    surfaceIntervalMinutes: "60",
    crewLeadMinutes: "30",
    minTurnaroundMinutes: "30",
    deskPayment: "",
  };
  for (const [field, value] of Object.entries({ ...defaults, ...overrides })) {
    formData.set(field, value);
  }
  return formData;
}

function unitsForm(values: { depthUnit?: string; temperatureUnit?: string; currency?: string }) {
  const formData = new FormData();
  formData.set("depthUnit", values.depthUnit ?? "feet");
  formData.set("temperatureUnit", values.temperatureUnit ?? "fahrenheit");
  if (values.currency !== undefined) formData.set("currency", values.currency);
  return formData;
}

async function unitsOf(db: AppDb, shopId: string) {
  const shop = await getShopById(db, shopId);
  if (!shop) throw new Error("seeded shop missing");
  return {
    depthUnit: shop.depthUnit,
    temperatureUnit: shop.temperatureUnit,
    currency: shop.currency,
  };
}

describe("saving the shop's units", () => {
  it("refuses a captain outright — settings are owner/manager work now", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await unitsOf(db, shop.id);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({})));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });

  it("lets an owner set all three", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ currency: "eur" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units-saved&saved=units`);
    expect(await unitsOf(db, shop.id)).toMatchObject({
      depthUnit: "feet",
      temperatureUnit: "fahrenheit",
      currency: "eur",
    });
  });

  it("refuses an owner's unrecognized currency rather than coercing it to dollars", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await unitsOf(db, shop.id);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ currency: "xyz" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units-invalid&saved=units`);
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });

  it("refuses a depth unit that is not one of the two", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await unitsOf(db, shop.id);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ depthUnit: "fathoms" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units-invalid&saved=units`);
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });
});

describe("saving the crew schedule's divemaster target", () => {
  it("refuses a captain's change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = (await getShopById(db, shop.id))?.diversPerDivemaster;
    const form = new FormData();
    form.set("diversPerDivemaster", "4");

    const to = await redirectedTo(() => saveCrewScheduleAction(form));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect((await getShopById(db, shop.id))?.diversPerDivemaster).toBe(before);
  });

  it("lets an owner set the target and leaves the switch where the Features page put it", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const switchBefore = (await getShopById(db, shop.id))?.crewScheduleEnabled;
    const form = new FormData();
    form.set("diversPerDivemaster", "4");

    expect(await redirectedTo(() => saveCrewScheduleAction(form))).toBe(
      `/shop/${shop.slug}/settings?notice=crew-schedule-saved&saved=crewSchedule`,
    );
    expect(await getShopById(db, shop.id)).toMatchObject({
      crewScheduleEnabled: switchBefore,
      diversPerDivemaster: 4,
    });
  });

  it("refuses a target outside 1 to 20 and leaves the switch alone", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await getShopById(db, shop.id);
    const form = new FormData();
    form.set("diversPerDivemaster", "60");

    expect(await redirectedTo(() => saveCrewScheduleAction(form))).toBe(
      `/shop/${shop.slug}/settings?notice=crew-schedule-ratio-invalid&form=crewSchedule`,
    );
    expect(await getShopById(db, shop.id)).toMatchObject({
      crewScheduleEnabled: before?.crewScheduleEnabled,
      diversPerDivemaster: before?.diversPerDivemaster,
    });
  });
});

/**
 * Hiding the settings page from the daily crew is a courtesy, never the gate.
 * A server action is a POST endpoint whose id ships to any browser that has
 * ever rendered the form, so a demoted staffer — or anyone who kept an old tab
 * open — could still post to it. Every mutation re-checks live roles, and each
 * test below asserts the *stored row* after the refusal, not the notice alone:
 * the `setShop*` writers have no gate of their own and write what they are
 * handed.
 */
describe("every settings mutation refuses the daily crew", () => {
  it("refuses a captain's timezone change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await getShopById(db, shop.id);

    const form = new FormData();
    form.set("timezone", "Pacific/Auckland");
    const to = await redirectedTo(() => saveTimezoneAction(form));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect((await getShopById(db, shop.id))?.timezone).toBe(before?.timezone);
  });

  it("refuses a back-on-the-water date more than eighteen months out, and keeps the old one", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const today = calendarDateInTimezone(nowDate(), shop.timezone);

    const form = new FormData();
    form.set("reopensOn", "2062-03-01");
    expect(await redirectedTo(() => saveReopensOnAction(form))).toBe(
      `/shop/${shop.slug}/settings?notice=reopens-invalid&saved=season`,
    );
    expect((await getShopById(db, shop.id))?.reopensOn).toBeNull();

    const near = shiftCalendarDateMonths(today, 12);
    form.set("reopensOn", near);
    expect(await redirectedTo(() => saveReopensOnAction(form))).toBe(
      `/shop/${shop.slug}/settings?notice=reopens-saved&saved=season`,
    );
    expect((await getShopById(db, shop.id))?.reopensOn).toBe(near);
  });

  it("refuses a captain's address change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);

    const form = new FormData();
    for (const field of [
      "addressStreet",
      "addressLocality",
      "addressRegion",
      "addressPostalCode",
      "addressCountry",
    ]) {
      form.set(field, field === "addressCountry" ? "NZ" : "somewhere else");
    }
    const to = await redirectedTo(() => saveAddressAction(form));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect((await getShopById(db, shop.id))?.addressStreet).not.toBe("somewhere else");
  });

  it("refuses a captain's packing list and dock call, which had no gate at all before", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await getShopById(db, shop.id);

    const packing = new FormData();
    packing.set("packingList", "towel\nsunscreen");
    expect(await redirectedTo(() => savePackingAction(packing))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );

    // The whole dock day is one form now (visual review 2026-10-24, A01): a
    // captain's post with every section filled in changes none of them.
    expect(
      await redirectedTo(() =>
        saveDockDayAction(
          dockDayForm({ crewLeadMinutes: "90", deskPayment: "cash", dockCallMinutes: "120" }),
        ),
      ),
    ).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);

    const after = await getShopById(db, shop.id);
    expect(after?.crewLeadMinutes).toBe(before?.crewLeadMinutes);
    expect(after?.packingList).toEqual(before?.packingList);
    expect(after?.dockCallMinutes).toBe(before?.dockCallMinutes);
    expect(after?.offersHotelPickup).toBe(before?.offersHotelPickup);
    expect(after?.deskPayment).toBe(before?.deskPayment);
  });

  /**
   * The four editors that left the hub for pages of their own (#1854) keep
   * their gates: a captain's hand-made post is refused, and the stored row
   * is what proves it, not the notice — each setter writes whatever it is
   * handed.
   */
  it("refuses a captain's emergency reference, rentals and profile", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, captain);
    const before = await getShopById(db, shop.id);
    const refused = `/shop/${shop.slug}/settings?notice=not-authorized`;

    const emergency = new FormData();
    emergency.set("emergencyVessel", "Somebody else's boat");
    emergency.set("emergencyLabel-0", "Chamber");
    emergency.set("emergencyPhone-0", "+1 555 0100");
    expect(await redirectedTo(() => saveEmergencyReferenceAction(emergency))).toBe(refused);
    // "Send the link again" mails an outside address: owner/manager work too.
    // An address waiting for its link, so an ungated resend would mint one.
    await db
      .update(shops)
      .set({
        shoreAlertEmail: "shore@example.com",
        shoreAlertConsentAt: new Date(),
        shoreAlertConsentByPersonId: owner,
      })
      .where(eq(shops.id, shop.id));
    expect(await redirectedTo(() => resendShoreAlertConfirmationAction())).toBe(refused);
    expect(
      await db.select().from(shopShoreAlertTokens).where(eq(shopShoreAlertTokens.shopId, shop.id)),
    ).toEqual([]);

    const rentals = new FormData();
    rentals.set("drysuit", "on");
    rentals.set("setPrice", "1");
    rentals.set("rentalTerms", "Written by the captain");
    rentals.set("regulatorServiceMonths", "24");
    expect(await redirectedTo(() => saveRentalsAction(rentals))).toBe(refused);

    const profile = new FormData();
    profile.set("tagline", "Written by the captain");
    expect(await redirectedTo(() => saveProfileAction(profile))).toBe(refused);

    const after = await getShopById(db, shop.id);
    expect(after?.emergencyReference).toEqual(before?.emergencyReference);
    expect(after?.rentalItems).toEqual(before?.rentalItems);
    expect(after?.rentalPricing).toEqual(before?.rentalPricing);
    expect(after?.rentalTerms).toEqual(before?.rentalTerms);
    expect(after?.tagline).toEqual(before?.tagline);
    expect(after?.customerRegulatorServiceMonths).toBe(12);
  });

  /**
   * Rentals is one save (#2815), validated whole before anything is written:
   * a bad price, over-long terms or an interval other than 12 or 24 leaves the
   * stored catalog, prices, terms and interval exactly as they were.
   */
  it("writes nothing when any part of the rentals form is invalid", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await getShopById(db, shop.id);
    const page = `/shop/${shop.slug}/settings/rentals?notice=`;
    const form = (overrides: Record<string, string>) => {
      const data = new FormData();
      for (const [key, value] of Object.entries({
        drysuit: "on",
        price_drysuit: "40",
        rentalTerms: "Rinse it.",
        regulatorServiceMonths: "24",
        ...overrides,
      })) {
        data.set(key, value);
      }
      return data;
    };

    expect(await redirectedTo(() => saveRentalsAction(form({ price_drysuit: "-3" })))).toBe(
      `${page}rental-prices-invalid`,
    );
    expect(
      await redirectedTo(() => saveRentalsAction(form({ rentalTerms: "x".repeat(5000) }))),
    ).toBe(`${page}rental-terms-invalid`);
    expect(
      await redirectedTo(() => saveRentalsAction(form({ regulatorServiceMonths: "18" }))),
    ).toBe(`${page}regulator-service-invalid`);
    expect(
      await redirectedTo(() =>
        saveRentalsAction(form({ nitroxFillMethod: "membrane", rentalTerms: "Changed." })),
      ),
    ).toBe(`${page}nitrox-fill-invalid`);
    const after = await getShopById(db, shop.id);
    expect(after?.nitroxFillMethod).toBe("blending");
    expect(after?.rentalItems).toEqual(before?.rentalItems);
    expect(after?.rentalPricing).toEqual(before?.rentalPricing);
    expect(after?.rentalTerms).toEqual(before?.rentalTerms);
    expect(after?.customerRegulatorServiceMonths).toBe(12);
  });

  it("saves the catalog, prices, terms and interval together, keeping an unticked piece's price", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const page = `/shop/${shop.slug}/settings/rentals?notice=`;
    const first = new FormData();
    first.set("drysuit", "on");
    first.set("fins", "on");
    first.set("price_drysuit", "40");
    first.set("price_fins", "5");
    first.set("setPrice", "60");
    first.set("rentalTerms", "Rinse it.");
    first.set("regulatorServiceMonths", "24");
    first.set("nitroxFillMethod", "membrane_premix");
    expect(await redirectedTo(() => saveRentalsAction(first))).toBe(`${page}rentals-saved`);
    const saved = await getShopById(db, shop.id);
    expect(saved?.nitroxFillMethod).toBe("membrane_premix");
    expect(saved?.rentalPricing.setCents).toBe(6000);
    expect(saved?.rentalPricing.perItemCents.drysuit).toBe(4000);
    expect(saved?.rentalTerms).toBe("Rinse it.");
    expect(saved?.customerRegulatorServiceMonths).toBe(24);

    // The mask is unticked: its box still posts, but its stored price stays.
    const second = new FormData();
    second.set("drysuit", "on");
    second.set("price_drysuit", "45");
    second.set("price_fins", "999");
    second.set("setPrice", "60");
    second.set("regulatorServiceMonths", "24");
    expect(await redirectedTo(() => saveRentalsAction(second))).toBe(`${page}rentals-saved`);
    const after = await getShopById(db, shop.id);
    expect(after?.rentalPricing.perItemCents.drysuit).toBe(4500);
    expect(after?.rentalPricing.perItemCents.fins).toBe(500);
    expect(after?.rentalTerms).toBeNull();
    // A post with no fill method leaves the stored one as it was.
    expect(after?.nitroxFillMethod).toBe("membrane_premix");
  });

  /**
   * Nitrox is priced per dive and only while the shop fills it (#2815): the
   * price box is live when ticked; unticked, a posted figure is ignored and
   * the stored price stays; ticked and blank, the price is cleared.
   */
  it("keeps, ignores and clears the nitrox price as the tick says", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      data.set("regulatorServiceMonths", "12");
      for (const [key, value] of Object.entries(fields)) data.set(key, value);
      return data;
    };

    await redirectedTo(() => saveRentalsAction(form({ nitrox: "on", nitroxPrice: "12" })));
    expect((await getShopById(db, shop.id))?.rentalPricing.nitroxCents).toBe(1200);

    await redirectedTo(() => saveRentalsAction(form({ nitroxPrice: "999" })));
    const unticked = await getShopById(db, shop.id);
    expect(unticked?.rentalPricing.nitroxCents).toBe(1200);
    expect(unticked?.rentalItems).not.toContain("nitrox");

    await redirectedTo(() => saveRentalsAction(form({ nitrox: "on", nitroxPrice: "" })));
    expect((await getShopById(db, shop.id))?.rentalPricing.nitroxCents).toBeNull();
  });

  it("still lets an owner through every one of them", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const page = `/shop/${shop.slug}/settings/dock-day`;
    // One Save writes all four sections, with one notice.
    expect(
      await redirectedTo(() =>
        saveDockDayAction(
          dockDayForm({ crewLeadMinutes: "45", minTurnaroundMinutes: "90", deskPayment: "cash" }),
        ),
      ),
    ).toBe(`${page}?notice=dock-day-saved`);
    const saved = await getShopById(db, shop.id);
    expect(saved?.dockCallMinutes).toBe(90);
    expect(saved?.crewLeadMinutes).toBe(45);
    expect(saved?.minTurnaroundMinutes).toBe(90);
    expect(saved?.deskPayment).toBe("cash");

    // Each section keeps its own refusal, and a refusal anywhere saves nothing
    // anywhere: the out-of-range crew time leaves the new rhythm unwritten too.
    expect(
      await redirectedTo(() =>
        saveDockDayAction(dockDayForm({ crewLeadMinutes: "0", dockCallMinutes: "60" })),
      ),
    ).toBe(`${page}?notice=crew-lead-invalid`);
    const refused = await getShopById(db, shop.id);
    expect(refused?.crewLeadMinutes).toBe(45);
    expect(refused?.dockCallMinutes).toBe(90);
    expect(
      await redirectedTo(() => saveDockDayAction(dockDayForm({ dockCallMinutes: "-5" }))),
    ).toBe(`${page}?notice=dock-invalid`);
    expect(
      await redirectedTo(() => saveDockDayAction(dockDayForm({ minTurnaroundMinutes: "999" }))),
    ).toBe(`${page}?notice=turnaround-invalid`);
    expect(
      await redirectedTo(() => saveDockDayAction(dockDayForm({ deskPayment: "bitcoin" }))),
    ).toBe(`${page}?notice=desk-payment-invalid`);
    expect((await getShopById(db, shop.id))?.deskPayment).toBe("cash");

    // Empty crew minutes clear them (crew read the divers' time), and "Don't
    // say" clears how divers pay.
    expect(
      await redirectedTo(() =>
        saveDockDayAction(dockDayForm({ crewLeadMinutes: "", deskPayment: "" })),
      ),
    ).toBe(`${page}?notice=dock-day-saved`);
    const cleared = await getShopById(db, shop.id);
    expect(cleared?.crewLeadMinutes).toBeNull();
    expect(cleared?.deskPayment).toBeNull();
  });

  /**
   * H-118: the shore contact's alert address saves only with the box that
   * records their consent, keeps who and when, and clearing it clears both.
   * The seeded shop is a demo, which sends nothing and says so; the link and
   * the rest are `shore-alert-actions.test.ts`.
   */
  it("saves a shore contact's alert address only with its consent", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const page = `/shop/${shop.slug}/settings/emergency-reference?notice=`;
    const form = (email: string, consent: boolean) => {
      const data = new FormData();
      data.set("emergencyVessel", "Blue Mantis II");
      data.set("shoreAlertEmail", email);
      if (consent) data.set("shoreAlertConsent", "on");
      return data;
    };
    const stored = async () => {
      const row = await getShopById(db, shop.id);
      return {
        email: row?.shoreAlertEmail,
        consentAt: row?.shoreAlertConsentAt,
        by: row?.shoreAlertConsentByPersonId,
        vessel: row?.emergencyReference.vessel,
      };
    };
    const before = await stored();

    expect(
      await redirectedTo(() => saveEmergencyReferenceAction(form("shore@example.com", false))),
    ).toBe(`${page}shore-alert-consent-missing`);
    expect(await redirectedTo(() => saveEmergencyReferenceAction(form("VHF 16", true)))).toBe(
      `${page}shore-alert-invalid`,
    );
    // A refusal saves nothing, the reference included.
    expect(await stored()).toEqual(before);

    expect(
      await redirectedTo(() => saveEmergencyReferenceAction(form("shore@example.com", true))),
    ).toBe(`${page}shore-alert-saved-demo`);
    const saved = await stored();
    expect(saved).toMatchObject({
      email: "shore@example.com",
      by: owner,
      vessel: "Blue Mantis II",
    });
    expect(saved.consentAt).toBeInstanceOf(Date);

    expect(await redirectedTo(() => saveEmergencyReferenceAction(form("", false)))).toBe(
      `${page}shore-alert-cleared`,
    );
    expect(await stored()).toMatchObject({ email: null, consentAt: null, by: null });
  });

  it("refuses a captain's shore contact address like the rest of the reference", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const data = new FormData();
    data.set("shoreAlertEmail", "mine@example.com");
    data.set("shoreAlertConsent", "on");
    await redirectedTo(() => saveEmergencyReferenceAction(data));
    expect((await getShopById(db, shop.id))?.shoreAlertEmail).toBeNull();
  });

  /**
   * The four editors that left the hub for pages of their own (#1854) answer
   * on those pages, with a plain `?notice=` and no `saved=` row to reopen:
   * a notice that sent the owner back to the hub would land them on a door,
   * not on what they just saved.
   */
  it("answers each editor that left the hub on its own page", async () => {
    const { shop, owner } = await context();
    signIn(shop, owner);
    const page = (route: string) => `/shop/${shop.slug}/settings/${route}?notice=`;

    const emergency = new FormData();
    emergency.set("emergencyVessel", "Blue Mantis II");
    expect(await redirectedTo(() => saveEmergencyReferenceAction(emergency))).toBe(
      `${page("emergency-reference")}emergency-saved`,
    );
    const rentals = new FormData();
    rentals.set("regulatorServiceMonths", "12");
    expect(await redirectedTo(() => saveRentalsAction(rentals))).toBe(
      `${page("rentals")}rentals-saved`,
    );
    const profile = new FormData();
    profile.set("brandColor", "not a colour");
    expect(await redirectedTo(() => saveProfileAction(profile))).toBe(
      `${page("profile")}profile-invalid`,
    );
  });
});

/**
 * The two data-compliance queues moved here from the monthly report, and with
 * them three actions. These refuse by *returning*, not redirecting — the panel
 * that renders their forms is already hidden from anyone who would be refused,
 * so a refusal here is a hand-made post and gets no explanation, only nothing.
 * Which is exactly why each test reads the stored row afterwards: "no redirect
 * happened" would be equally true of a gate that silently let the write land.
 */
async function queueStuckDeletion(db: AppDb, shopId: string): Promise<string> {
  const [row] = await db
    .insert(mediaDeletionAttempts)
    .values({
      shopId,
      kind: "recap_photo",
      url: "https://blob.example/recap.jpg",
      status: "failed",
      lastError: "provider said no",
    })
    .returning({ id: mediaDeletionAttempts.id });
  return row.id;
}

async function oweErasure(db: AppDb, shopId: string, personId: string): Promise<string> {
  const [row] = await db
    .insert(processorErasureObligations)
    .values({
      shopId,
      // Provenance only — the row this points at is already anonymized.
      personId,
      target: "stripe_invoice_snapshot",
      externalId: "in_test",
      stripeAccountId: "acct_test",
      status: "owed",
    })
    .returning({ id: processorErasureObligations.id });
  return row.id;
}

function withId(field: string, id: string) {
  const form = new FormData();
  form.set(field, id);
  return form;
}

async function deletionStatus(db: AppDb, id: string) {
  const [row] = await db
    .select()
    .from(mediaDeletionAttempts)
    .where(eq(mediaDeletionAttempts.id, id));
  return row?.status;
}

async function erasureStatus(db: AppDb, shopId: string, id: string) {
  const [row] = await db
    .select()
    .from(processorErasureObligations)
    .where(
      and(eq(processorErasureObligations.id, id), eq(processorErasureObligations.shopId, shopId)),
    );
  return row?.status;
}

describe("the data-compliance queue actions", () => {
  it("refuses a captain's photo-deletion retry", async () => {
    // The gate that moved: it was `canPersonViewShopReports`, it is now this
    // page's `canPersonManageShopSettings`. Same `isOwnerOrManager` role set,
    // so a captain was refused before and must still be.
    const { db, shop, captain } = await context();
    const attemptId = await queueStuckDeletion(db, shop.id);
    signIn(shop, captain);

    await retryMediaDeletionAction(withId("attemptId", attemptId));

    // Untouched: a permitted retry resolves the row one way or the other.
    expect(await deletionStatus(db, attemptId)).toBe("failed");
  });

  it("refuses a manager's erasure retry and discharge — owner-only, and that did not move", async () => {
    // The gate that deliberately did *not* move: discharging attests a diver's
    // data is gone from Stripe (ADR 20260803-processor-erasure-obligations).
    // The seed's manager is also the owner, so the owner role comes off first.
    const { db, shop, owner } = await context();
    const obligationId = await oweErasure(db, shop.id, owner);
    await demoteOwnerToManager(db, owner);
    signIn(shop, owner);

    await retryProcessorErasureAction(withId("obligationId", obligationId));
    await dischargeProcessorErasureAction(withId("obligationId", obligationId));

    expect(await erasureStatus(db, shop.id, obligationId)).toBe("owed");
  });

  it("lets an owner discharge an invoice snapshot — the only way that debt ever closes", async () => {
    const { db, shop, owner } = await context();
    const obligationId = await oweErasure(db, shop.id, owner);
    signIn(shop, owner);

    await dischargeProcessorErasureAction(withId("obligationId", obligationId));

    expect(await erasureStatus(db, shop.id, obligationId)).toBe("discharged");
    // The revalidated path is derived from the session, never from an argument.
    // These three actions used to take a bound `shopSlug`, and a server action's
    // arguments are attacker-controlled — a hand-crafted POST could name any
    // shop and invalidate its cached settings page. The signature (FormData
    // only) is what makes that unreachable; this pins the slug it actually uses.
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/shop/${shop.slug}/settings`);
  });

  it("ignores a submission with no id rather than acting on a blank one", async () => {
    const { db, shop, owner } = await context();
    const obligationId = await oweErasure(db, shop.id, owner);
    signIn(shop, owner);

    await dischargeProcessorErasureAction(new FormData());

    expect(await erasureStatus(db, shop.id, obligationId)).toBe("owed");
  });
});

/**
 * The demo's Stripe connection is configuration (ADR
 * 20261009-demo-test-mode-payments): the canonical demo holds DiveDay's own
 * test-mode account and anyone can be its owner, so neither Disconnect, which
 * would deauthorize that account from the platform, nor Refresh, which would
 * read it with the live key, runs there.
 */
describe("the demo shop's Stripe connection", () => {
  it("cannot be disconnected or refreshed from the demo's settings, even by its owner", async () => {
    const { db, shop, owner } = await context();
    const { shopStripeAccounts } = await import("@/db/schema");
    const { syncDemoStripeAccount } = await import("@/db/stripe-accounts");
    expect(shop.isDemo).toBe(true);
    await syncDemoStripeAccount(db, shop.id, {
      accountId: "acct_demoTestMode1",
      secretKey: "sk_test_demoTestMode1",
    });
    signIn(shop, owner);

    for (const action of [disconnectAction, refreshAction]) {
      const to = await redirectedTo(() => action());
      expect(to).toContain("notice=demo-stripe");
    }
    const [row] = await db
      .select()
      .from(shopStripeAccounts)
      .where(eq(shopStripeAccounts.shopId, shop.id));
    expect(row).toMatchObject({ disconnectedAt: null, chargesEnabled: true });
  });
});
