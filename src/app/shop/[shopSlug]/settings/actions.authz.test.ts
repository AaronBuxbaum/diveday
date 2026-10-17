import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { importGlobalDiveSiteTemplate, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import {
  diveSites,
  mediaDeletionAttempts,
  processorErasureObligations,
  shopShoreAlertTokens,
  shops,
} from "@/db/schema";
import { getShopById, setShopDepthUnit } from "@/db/shops";
import { briefingInUnit } from "@/lib/site-prose-units";
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
const {
  resendShoreAlertConfirmationAction,
  saveDockDayRhythmAction,
  saveEmergencyReferenceAction,
} = await import("./boat-actions");
const { saveHotelPickupAction } = await import("./dock-day/pickup-actions");
const { saveDeskPaymentAction } = await import("./dock-day/desk-payment-actions");
const { savePackingAction } = await import("./booking-actions");
const { dischargeProcessorErasureAction, retryMediaDeletionAction, retryProcessorErasureAction } =
  await import("./data-actions");
const { disconnectAction, refreshAction, saveTaxAction } = await import("./money-actions");
const { saveRegulatorServiceAction, saveRentalItemsAction, saveRentalPricingAction } = await import(
  "./rental-actions"
);
const {
  saveAddressAction,
  saveReopensOnAction,
  saveShopFeatureAction,
  saveTimezoneAction,
  saveUnitsAction,
} = await import("./shop-actions");
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

  it("counts the edited catalog sites a depth-unit switch left alone", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    await setShopDepthUnit(db, shop.id, "meters");
    const withMeasures = (await listGlobalDiveSiteTemplates(db, { limit: 1000 })).templates.find(
      (row) =>
        JSON.stringify(briefingInUnit(row.version.briefing, "feet")) !==
        JSON.stringify(briefingInUnit(row.version.briefing, "meters")),
    );
    if (!withMeasures) throw new Error("seed: no catalog site names a measure");
    const imported = await importGlobalDiveSiteTemplate(db, shop.id, withMeasures.template.id);
    if (!imported) throw new Error("expected a catalog copy");
    await db
      .update(diveSites)
      .set({ description: `${imported.description ?? ""} Our own words.` })
      .where(eq(diveSites.id, imported.id));

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({})));

    expect(to).toMatch(
      new RegExp(
        `^/shop/${shop.slug}/settings\\?notice=units-saved-sites-left&saved=units&count=[1-9]`,
      ),
    );
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

describe("saving the shop's Stripe Tax setting", () => {
  it("refuses a captain's tax change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const taxBefore = (await getShopById(db, shop.id))?.taxEnabled;
    const form = new FormData();
    form.set("taxEnabled", "on");

    const to = await redirectedTo(() => saveTaxAction(form));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    // Unchanged, rather than literally `false`: the canonical demo ships with
    // Stripe Tax **on** (src/db/seed.ts), so a hard-coded `false` here was
    // asserting the fixture's default rather than that the captain's write was
    // refused. Read before and after and compare.
    expect((await getShopById(db, shop.id))?.taxEnabled).toBe(taxBefore);
  });

  it("lets an owner enable and disable Stripe Tax", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const enabled = new FormData();
    enabled.set("taxEnabled", "on");

    expect(await redirectedTo(() => saveTaxAction(enabled))).toBe(
      `/shop/${shop.slug}/settings?notice=tax-saved&saved=tax`,
    );
    expect((await getShopById(db, shop.id))?.taxEnabled).toBe(true);

    expect(await redirectedTo(() => saveTaxAction(new FormData()))).toBe(
      `/shop/${shop.slug}/settings?notice=tax-saved&saved=tax`,
    );
    expect((await getShopById(db, shop.id))?.taxEnabled).toBe(false);
  });
});

describe("saving an optional feature switch", () => {
  function featureForm(feature: string, enabled: boolean) {
    const form = new FormData();
    form.set("feature", feature);
    if (enabled) form.set("enabled", "on");
    return form;
  }

  it("refuses a captain's change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() => saveShopFeatureAction(featureForm("tips", false)));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect((await getShopById(db, shop.id))?.tipsEnabled).toBe(true);
  });

  it("lets an owner turn each one off and back on, touching no other", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    expect(await redirectedTo(() => saveShopFeatureAction(featureForm("reviews", false)))).toBe(
      `/shop/${shop.slug}/settings?notice=feature-saved&saved=reviews`,
    );
    expect(await getShopById(db, shop.id)).toMatchObject({
      reviewsEnabled: false,
      dateRequestsEnabled: true,
      lastMinuteListEnabled: true,
      tipsEnabled: true,
      // The seeded demo runs the PADI checks; turning reviews off leaves them on.
      padiChecksEnabled: true,
    });

    await redirectedTo(() => saveShopFeatureAction(featureForm("reviews", true)));
    expect((await getShopById(db, shop.id))?.reviewsEnabled).toBe(true);
  });

  it("ignores a feature it does not know, including the crew schedule's own column", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await getShopById(db, shop.id);

    const to = await redirectedTo(() =>
      saveShopFeatureAction(featureForm("crewScheduleEnabled", false)),
    );

    expect(to).toBe(`/shop/${shop.slug}/settings`);
    expect(await getShopById(db, shop.id)).toEqual(before);
  });
});

describe("saving the crew schedule switch", () => {
  it("refuses a captain's change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = (await getShopById(db, shop.id))?.crewScheduleEnabled;

    const to = await redirectedTo(() => saveCrewScheduleAction(new FormData()));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect((await getShopById(db, shop.id))?.crewScheduleEnabled).toBe(before);
  });

  it("lets an owner turn it off and on, with its divemaster target", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const saved = `/shop/${shop.slug}/settings?notice=crew-schedule-saved&saved=crewSchedule`;

    const off = new FormData();
    off.set("diversPerDivemaster", "4");
    expect(await redirectedTo(() => saveCrewScheduleAction(off))).toBe(saved);
    expect(await getShopById(db, shop.id)).toMatchObject({
      crewScheduleEnabled: false,
      diversPerDivemaster: 4,
    });

    const on = new FormData();
    on.set("crewScheduleEnabled", "on");
    on.set("diversPerDivemaster", "8");
    expect(await redirectedTo(() => saveCrewScheduleAction(on))).toBe(saved);
    expect(await getShopById(db, shop.id)).toMatchObject({
      crewScheduleEnabled: true,
      diversPerDivemaster: 8,
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

    expect(await redirectedTo(() => saveDockDayRhythmAction(dockDayForm()))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );

    const pickup = new FormData();
    pickup.set("offersHotelPickup", "on");
    expect(await redirectedTo(() => saveHotelPickupAction(pickup))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );

    const desk = new FormData();
    desk.set("deskPayment", "cash");
    expect(await redirectedTo(() => saveDeskPaymentAction(desk))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );

    const after = await getShopById(db, shop.id);
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
  it("refuses a captain's emergency reference, rental catalog, rental prices and profile", async () => {
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

    const items = new FormData();
    items.set("drysuit", "on");
    expect(await redirectedTo(() => saveRentalItemsAction(items))).toBe(refused);

    const prices = new FormData();
    prices.set("setPrice", "1");
    expect(await redirectedTo(() => saveRentalPricingAction(prices))).toBe(refused);

    const profile = new FormData();
    profile.set("tagline", "Written by the captain");
    expect(await redirectedTo(() => saveProfileAction(profile))).toBe(refused);

    const regulator = new FormData();
    regulator.set("regulatorServiceMonths", "24");
    expect(await redirectedTo(() => saveRegulatorServiceAction(regulator))).toBe(refused);

    const after = await getShopById(db, shop.id);
    expect(after?.emergencyReference).toEqual(before?.emergencyReference);
    expect(after?.rentalItems).toEqual(before?.rentalItems);
    expect(after?.rentalPricing).toEqual(before?.rentalPricing);
    expect(after?.tagline).toEqual(before?.tagline);
    expect(after?.customerRegulatorServiceMonths).toBe(12);
  });

  it("saves a shop's regulator service interval, and only 12 or 24 months", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const settings = `/shop/${shop.slug}/settings?notice=`;
    const form = (months: string) => {
      const data = new FormData();
      data.set("regulatorServiceMonths", months);
      return data;
    };

    expect(await redirectedTo(() => saveRegulatorServiceAction(form("18")))).toBe(
      `${settings}regulator-service-invalid&saved=regulatorService`,
    );
    expect((await getShopById(db, shop.id))?.customerRegulatorServiceMonths).toBe(12);

    expect(await redirectedTo(() => saveRegulatorServiceAction(form("24")))).toBe(
      `${settings}regulator-service-saved&saved=regulatorService`,
    );
    expect((await getShopById(db, shop.id))?.customerRegulatorServiceMonths).toBe(24);
  });

  it("still lets an owner through every one of them", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    expect(await redirectedTo(() => saveDockDayRhythmAction(dockDayForm()))).toBe(
      `/shop/${shop.slug}/settings/dock-day?notice=dock-saved`,
    );
    expect((await getShopById(db, shop.id))?.dockCallMinutes).toBe(90);

    // "We offer hotel pickup" (fourth UX review, item 8): on, then off again.
    const pickup = new FormData();
    pickup.set("offersHotelPickup", "on");
    expect(await redirectedTo(() => saveHotelPickupAction(pickup))).toBe(
      `/shop/${shop.slug}/settings/dock-day?notice=pickup-saved`,
    );
    expect((await getShopById(db, shop.id))?.offersHotelPickup).toBe(true);
    expect(await redirectedTo(() => saveHotelPickupAction(new FormData()))).toBe(
      `/shop/${shop.slug}/settings/dock-day?notice=pickup-saved`,
    );
    expect((await getShopById(db, shop.id))?.offersHotelPickup).toBe(false);

    // How divers pay at the desk (fifth-loop ideas, item 21): cash, then
    // "Don't say", and a forged value changes nothing.
    const desk = new FormData();
    desk.set("deskPayment", "cash");
    expect(await redirectedTo(() => saveDeskPaymentAction(desk))).toBe(
      `/shop/${shop.slug}/settings/dock-day?notice=desk-payment-saved`,
    );
    expect((await getShopById(db, shop.id))?.deskPayment).toBe("cash");
    const forged = new FormData();
    forged.set("deskPayment", "bitcoin");
    expect(await redirectedTo(() => saveDeskPaymentAction(forged))).toBe(
      `/shop/${shop.slug}/settings/dock-day?notice=desk-payment-invalid`,
    );
    expect((await getShopById(db, shop.id))?.deskPayment).toBe("cash");
    const unsaid = new FormData();
    unsaid.set("deskPayment", "");
    expect(await redirectedTo(() => saveDeskPaymentAction(unsaid))).toBe(
      `/shop/${shop.slug}/settings/dock-day?notice=desk-payment-saved`,
    );
    expect((await getShopById(db, shop.id))?.deskPayment).toBeNull();
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
   * The five editors that left the hub for pages of their own (#1854) answer
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
    expect(await redirectedTo(() => saveRentalItemsAction(new FormData()))).toBe(
      `${page("rentals")}rentals-saved`,
    );
    expect(await redirectedTo(() => saveRentalPricingAction(new FormData()))).toBe(
      `${page("rental-prices")}rental-prices-saved`,
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
