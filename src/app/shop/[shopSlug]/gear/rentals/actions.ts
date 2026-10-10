"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageOrders } from "@/db/authz";
import { getDb } from "@/db/client";
import { createDiver } from "@/db/divers";
import {
  checkOutCounterRental,
  counterRentalPerson,
  createCounterRental,
  getCounterRentalTicket,
  linkCounterRentalOrder,
  recordCounterRentalCardSighting,
  releaseCounterRental,
  returnCounterRental,
} from "@/db/gear-counter-rentals";
import { createOrder, type NewOrderLineItem, recordCounterOrder } from "@/db/orders";
import { certificationAgency, certificationLevel } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { isPlausibleCardNumber } from "@/lib/card-number";
import { nowDate } from "@/lib/clock";
import { counterRentalCoreKinds, counterRentalDays, isOneCoreSet } from "@/lib/counter-rentals";
import { GEAR_RETURN_OUTCOMES } from "@/lib/gear";
import { majorToMinor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { customerAddressFromForm } from "@/lib/payments/customer-address-form";
import {
  blankableDiverEmailSchema,
  blankableDiverNameSchema,
  diverPhoneSchema,
} from "@/lib/person-fields";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import {
  CONFIRM_FIELD_PREFIX,
  counterRentalFormPath,
  PAYMENT_FIELD,
  PRICE_FIELD_PREFIX,
  RENTAL_PAYMENTS,
  SET_PRICE_FIELD,
  UNIT_FIELD,
} from "./rental-form";

/**
 * The counter-rental writes (ADR 20260815-minimal-gear-register, amended
 * 2026-10-08). Gear is any-staff work (H-06), so renting a unit out is open to
 * every staff member; sending the invoice beside it is billing, which stays
 * owner/manager work behind the same gates as the new-order form (H-14,
 * money step-up, a connected Stripe account) — re-checked here, not trusted
 * from what the form rendered.
 */

const dateSchema = z.string().trim().max(10);
// Same bounds the new-order action holds a typed price to (CR-016).
const priceSchema = z.coerce.number().nonnegative().max(100_000);

const rentalSchema = z.object({
  personId: z.uuid(),
  from: dateSchema,
  until: dateSchema,
  units: z.array(z.uuid()).max(40),
});

/**
 * Lend the picked units, then charge for them the way the staffer chose:
 * record cash or a card-machine payment as a paid order, send an invoice
 * through the ordinary staff order path, or charge nothing.
 *
 * **The rental is written first, and the invoice only after it stood.** The
 * other order bills for a unit the exclusion constraint may yet refuse, and
 * an invoice cannot be unsent. Everything about the invoice that can be
 * checked before the rental is (role, step-up, payments, an email to send it
 * to, the prices), so the one partial outcome left is Stripe itself failing,
 * which leaves the rental standing and says so.
 */
export async function createCounterRentalAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  const slug = session.user.shopSlug;
  const parsed = rentalSchema.safeParse({
    personId: String(formData.get("personId") ?? ""),
    from: String(formData.get("from") ?? ""),
    until: String(formData.get("until") ?? ""),
    units: formData.getAll(UNIT_FIELD).map(String),
  });
  const blankForm = shopPath(slug, "gear", "rentals", "new");
  if (!parsed.success) redirect(noticeUrl(blankForm, "invalid"));
  const { personId, from, until, units } = parsed.data;
  const form = counterRentalFormPath(slug, { personId, from, until });

  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(noticeUrl(blankForm, "invalid"));
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);

  const payment = RENTAL_PAYMENTS.find((value) => value === formData.get(PAYMENT_FIELD));
  if (!payment) redirect(noticeUrl(form, "needs-payment"));
  const wantsInvoice = payment === "invoice";
  if (wantsInvoice) {
    if (!(await canPersonManageOrders(db, shop.id, session.user.personId))) {
      redirect(noticeUrl(form, "not-authorized"));
    }
    if (!(await hasRequiredStepUp(db, session, "money"))) {
      redirect(stepUpChallengeUrl(slug, "money", form));
    }
    if (!canAcceptPayments(await getShopStripeAccount(db, shop.id))) {
      redirect(noticeUrl(form, "payment-not-connected"));
    }
    const person = await counterRentalPerson(db, shop.id, personId);
    if (person && !person.email) redirect(noticeUrl(form, "needs-email"));
  }
  // The prices are read for every payment that charges: an invoice bills them,
  // and cash or a card machine records them as paid. "No charge" reads none.
  const lineCents = new Map<string, number>();
  let setCents: number | null = null;
  if (payment !== "none") {
    for (const unitId of units) {
      const raw = String(formData.get(`${PRICE_FIELD_PREFIX}${unitId}`) ?? "").trim();
      if (!raw) continue;
      const price = priceSchema.safeParse(raw);
      if (!price.success) redirect(noticeUrl(form, "invalid"));
      lineCents.set(unitId, majorToMinor(price.data, shop.currency));
    }
    const rawSet = String(formData.get(SET_PRICE_FIELD) ?? "").trim();
    if (rawSet) {
      const price = priceSchema.safeParse(rawSet);
      if (!price.success) redirect(noticeUrl(form, "invalid"));
      setCents = majorToMinor(price.data, shop.currency);
    }
  }

  const outcome = await createCounterRental(db, {
    shopId: shop.id,
    personId,
    gearItemIds: units,
    reservedFrom: from,
    reservedUntil: until,
    todayLocal,
    // A flagged soft-goods unit the staffer ticked "lend anyway" on. Life
    // support is refused whatever is posted here.
    confirmedFlaggedIds: units.filter(
      (unitId) => formData.get(`${CONFIRM_FIELD_PREFIX}${unitId}`) === "on",
    ),
  });
  if (!outcome.ok) {
    // The unit travels by id, never by name: the page looks its label up in
    // this shop, so a URL cannot put words of its own on the screen.
    redirect(
      noticeUrl(form, outcome.reason, "unitId" in outcome ? { unit: outcome.unitId } : undefined),
    );
  }

  const ticket = shopPath(slug, "gear", "rentals", outcome.ticketId);
  const gear = shopPath(slug, "gear");
  const billed = [...lineCents.values(), setCents ?? 0].some((cents) => cents > 0);
  if (payment === "none" || !billed) revalidateAndRedirect(gear, noticeUrl(ticket, "rented"));

  // The invoice's words come from the staffer's bundle, as on the new-order
  // form, and are frozen onto the invoice by `createOrder`. One line per unit
  // with a price above zero: a unit lent free is not a line on a bill.
  //
  // **The set line**, when the form offered one and the rental really is one
  // core set (re-checked here against what was written, not trusted from the
  // form): one line at the set price, and the set's units carry no line of
  // their own. Anything picked beside the set is priced as itself.
  const rental = await getCounterRentalTicket(db, shop.id, outcome.ticketId);
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const days = counterRentalDays(from, until);
  const rented = rental?.units ?? [];
  const coreKinds = counterRentalCoreKinds(shop.rentalItems);
  const asSet =
    setCents !== null &&
    isOneCoreSet(
      coreKinds,
      rented.map((unit) => unit.kind),
    );
  const setLine: NewOrderLineItem[] =
    asSet && setCents !== null && setCents > 0
      ? [
          {
            kind: "rental",
            description: t("counterRentals.setLine", { days }),
            quantity: 1,
            unitAmountCents: setCents,
          },
        ]
      : [];
  const lineItems: NewOrderLineItem[] = [
    ...setLine,
    ...rented.flatMap((unit): NewOrderLineItem[] => {
      if (asSet && coreKinds.includes(unit.kind)) return [];
      const cents = lineCents.get(unit.gearItemId) ?? 0;
      if (cents <= 0) return [];
      return [
        {
          kind: "rental",
          description: t("counterRentals.invoiceLine", { label: unit.label, days }),
          quantity: 1,
          unitAmountCents: cents,
        },
      ];
    }),
  ];
  if (lineItems.length === 0) revalidateAndRedirect(gear, noticeUrl(ticket, "rented"));

  // **Cash or the shop's own card machine**: the money already changed hands
  // at the counter, so the order is written paid, with no Stripe call and no
  // owner/manager gate (taking cash is day work, like the rental itself).
  if (payment === "cash" || payment === "card_machine") {
    const recorded = await recordCounterOrder(db, {
      shopId: shop.id,
      personId,
      createdByPersonId: session.user.personId,
      collection: payment,
      lineItems,
    });
    if (!recorded.ok) revalidateAndRedirect(gear, noticeUrl(ticket, "rented-not-recorded"));
    await linkCounterRentalOrder(db, {
      shopId: shop.id,
      reservationIds: outcome.reservationIds,
      orderId: recorded.order.id,
    });
    dispatchIntegrationsAfterResponse();
    revalidateAndRedirect(gear, noticeUrl(ticket, "rented-paid"));
  }

  const order = await createOrder(db, {
    shopId: shop.id,
    personId,
    createdByPersonId: session.user.personId,
    customerAddress: shop.taxEnabled ? customerAddressFromForm(formData) : undefined,
    lineItems,
  });
  if (!order.ok) revalidateAndRedirect(gear, noticeUrl(ticket, "rented-not-invoiced"));

  await linkCounterRentalOrder(db, {
    shopId: shop.id,
    reservationIds: outcome.reservationIds,
    orderId: order.order.id,
  });
  // `createOrder` queued an `order.created` event for the shop's integrations;
  // drain it after the response, as the new-order form does.
  dispatchIntegrationsAfterResponse();
  revalidateAndRedirect(gear, noticeUrl(ticket, "rented-invoiced"));
}

const personSchema = z
  .object({
    fullName: blankableDiverNameSchema,
    email: blankableDiverEmailSchema,
    phone: diverPhoneSchema,
  })
  .refine(({ fullName, email, phone }) => Boolean(fullName || email || phone));

/**
 * Put a new person on file from the rent-out form and carry on renting to
 * them. `createDiver` is the roster's own create — "enter once, reuse
 * everywhere" — and refuses an email somebody already has, which sends the
 * staffer back to the search rather than splitting one person in two.
 */
export async function addCounterRentalPersonAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  const slug = session.user.shopSlug;
  const blankForm = shopPath(slug, "gear", "rentals", "new");
  const parsed = personSchema.safeParse({
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
  if (!parsed.success) redirect(noticeUrl(blankForm, "invalid"));
  const person = await createDiver(db, { shopId: session.user.shopId, ...parsed.data });
  if (!person) redirect(noticeUrl(blankForm, "duplicate"));
  revalidateAndRedirect(
    shopPath(slug, "divers"),
    counterRentalFormPath(slug, { personId: person.id }),
  );
}

const cardSeenSchema = z.object({
  personId: z.uuid(),
  from: dateSchema,
  until: dateSchema,
  card: z.union([
    z.literal("specialty:drysuit").transform(() => ({ card: "drysuit" as const })),
    z
      .string()
      .startsWith("level:")
      .transform((value) => value.slice("level:".length))
      .pipe(z.enum(certificationLevel.enumValues))
      .transform((level) => ({ card: "level" as const, level })),
  ]),
  agency: z.enum(certificationAgency.enumValues),
  identifier: z.string().trim().max(120).refine(isPlausibleCardNumber),
});

/**
 * **Card seen** — the staffer holding the person's card writes it down and
 * certifies it in one act, recorded as theirs (`recordCounterRentalCardSighting`).
 * The way past the card rule for life support, and the only one.
 */
export async function recordCounterRentalCardAction(formData: FormData) {
  const session = await requireStaffSession();
  const slug = session.user.shopSlug;
  const parsed = cardSeenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const personId = String(formData.get("personId") ?? "");
    const back = z.uuid().safeParse(personId).success
      ? counterRentalFormPath(slug, {
          personId,
          from: String(formData.get("from") ?? ""),
          until: String(formData.get("until") ?? ""),
        })
      : shopPath(slug, "gear", "rentals", "new");
    redirect(noticeUrl(back, "card-invalid"));
  }
  const { personId, from, until, card, agency, identifier } = parsed.data;
  const form = counterRentalFormPath(slug, { personId, from, until });
  const outcome = await recordCounterRentalCardSighting(await getDb(), {
    shopId: session.user.shopId,
    personId,
    seenByPersonId: session.user.personId,
    agency,
    identifier,
    sighting: card,
  });
  revalidateAndRedirect(
    shopPath(slug, "divers", personId),
    noticeUrl(
      form,
      outcome.ok
        ? "card-recorded"
        : outcome.reason === "duplicate_card"
          ? "card-duplicate"
          : "card-not-recorded",
    ),
  );
}

const ticketSchema = z.object({ ticketId: z.uuid() });
const returnSchema = ticketSchema.extend({
  outcome: z.enum(GEAR_RETURN_OUTCOMES),
  note: z.string().trim().max(400).optional(),
  // Optional: blank is "not asked", which counts nothing on the dive clock.
  dives: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(200)])
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value)),
});

function ticketLanding(slug: string, parsed: { success: boolean; data?: { ticketId: string } }) {
  if (!parsed.success || !parsed.data) {
    const gear = shopPath(slug, "gear");
    revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));
  }
  return shopPath(slug, "gear", "rentals", parsed.data.ticketId);
}

/** Hand the whole rental across — every unit still on the wall. */
export async function checkOutCounterRentalAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = ticketSchema.safeParse(Object.fromEntries(formData));
  const ticket = ticketLanding(session.user.shopSlug, parsed);
  const outcome = await checkOutCounterRental(await getDb(), {
    shopId: session.user.shopId,
    ticketId: parsed.data?.ticketId ?? "",
  });
  revalidateAndRedirect(
    shopPath(session.user.shopSlug, "gear"),
    noticeUrl(ticket, outcome.ok ? "handed-over" : outcome.reason),
  );
}

/** Bring the whole rental home, the outcome asked once. */
export async function returnCounterRentalAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = returnSchema.safeParse(Object.fromEntries(formData));
  const ticket = ticketLanding(session.user.shopSlug, parsed);
  if (!parsed.data) return;
  const outcome = await returnCounterRental(await getDb(), {
    shopId: session.user.shopId,
    ticketId: parsed.data.ticketId,
    outcome: parsed.data.outcome,
    note: parsed.data.note,
    dives: parsed.data.dives,
  });
  // A unit flagged at the return is not "back on the wall": it waits for the
  // bench, and the notice says so.
  const returned = parsed.data.outcome === "service_concern" ? "returned-flagged" : "returned";
  revalidateAndRedirect(
    shopPath(session.user.shopSlug, "gear"),
    noticeUrl(ticket, outcome.ok ? returned : outcome.reason),
  );
}

/** Let go of what the person never came back for. */
export async function releaseCounterRentalAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = ticketSchema.safeParse(Object.fromEntries(formData));
  const ticket = ticketLanding(session.user.shopSlug, parsed);
  const db = await getDb();
  const outcome = await releaseCounterRental(db, {
    shopId: session.user.shopId,
    ticketId: parsed.data?.ticketId ?? "",
    releasedByPersonId: session.user.personId,
  });
  const gear = shopPath(session.user.shopSlug, "gear");
  if (!outcome.ok) revalidateAndRedirect(gear, noticeUrl(ticket, outcome.reason));
  // Every unit released leaves no ticket to land on; the register says it.
  const left = await getCounterRentalTicket(db, session.user.shopId, parsed.data?.ticketId ?? "");
  revalidateAndRedirect(gear, noticeUrl(left ? ticket : gear, "released"));
}
