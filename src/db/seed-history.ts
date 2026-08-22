import { DAY_MS } from "@/lib/clock";
import { rollCallCheckpoints } from "@/lib/manifests";
import type { DbExecutor } from "./client";
import {
  bookingPayments,
  bookings,
  certifications,
  type DiveSpecialty,
  orderLineItems,
  orders,
  people,
  personRoles,
  rollCallEvents,
  tips,
  tripRequirements,
  tripReviews,
  trips,
  waiverRecords,
} from "./schema";
import { at, nextCreatedAt } from "./seed-clock";
import { reviewedBy } from "./seed-review";
import { getCurrentWaiverTemplate } from "./waivers";

/**
 * The months behind today. Owner reporting ("how's your month") is hollow over a
 * shop that opened yesterday, so this back-fills a realistic trailing quarter:
 * past regulars plus a cohort of divers who only ever appear in history, booked
 * onto trips that already sailed in this month, last month, and the one before —
 * with the payments, signed waivers, and paid invoices those trips left behind.
 *
 * Everything is derived deterministically from a booking counter (never a live
 * clock or randomness) so the frozen-clock e2e fleet renders identical history
 * on every run, and so the report totals are stable enough for a visual-
 * regression baseline. It touches only the past: today's board, its roster, and its exactly
 * asserted readiness counts are untouched.
 */
export async function seedHistory(
  db: DbExecutor,
  shopId: string,
  createdByPersonId: string,
): Promise<void> {
  const template = await getCurrentWaiverTemplate(db, shopId);
  if (!template) throw new Error("seed: waiver template missing before history back-fill");

  // A cohort that lives ONLY in the past — new faces, all certified, so the
  // roster shows the churn a real shop has. Deliberately disjoint from the
  // upcoming roster: a waiver is signed once and then satisfies the gate on
  // every one of that diver's bookings (20260721-waiver-sign-once), so booking
  // a current customer onto a sailed trip and signing their waiver would clear
  // today's boat's waiver gate and change the exactly-asserted readiness counts.
  // History-only divers keep the past fully isolated from today's board.
  const historicalDivers: string[] = [
    "Grace Halloran",
    "Bjorn Aasen",
    "Marisol Vega",
    "Kenji Watanabe",
    "Priscilla Adeyemi",
    "Lars Petersen",
    "Yara Halabi",
    "Emmet O'Brien",
    "Sofia Marchetti",
    "Dominic Rossi",
    "Aisha Bello",
    "Henrik Nilsson",
    "Camila Rojas",
    "Tobias Berg",
    "Noor Rahman",
    "Diego Ferreira",
    // A longer trailing history — nine months of churn, not three weeks —
    // so the reporting page's older months have real regulars behind them
    // too, not just the same sixteen names on repeat.
    "Wendell Frost",
    "Marguerite Dupont",
    "Osric Bailey",
    "Anjali Krishnan",
    "Fabrizio Colombo",
    "Ottilie Falk",
    "Emeka Nnamdi",
    "Perla Jimenez",
    "Ragnar Solheim",
    "Ismene Kostas",
    "Baldur Magnusson",
    "Cosima Weber",
    "Talia Rosen",
    "Ferdinand Braun",
    "Winnie Achebe",
    "Radoslav Petrov",
    "Elowen Pascoe",
    "Anzu Yamamoto",
    "Corvin Albrecht",
    "Nkechi Eze",
    "Salome Girard",
    "Torvald Eide",
    "Beatrix Salazar",
    "Jamal Farouk",
    "Wilhelmina Kruger",
    "Ottone Ricci",
    "Marisela Ponce",
    "Callan Doherty",
    "Yolanda Marin",
    "Quintus Herrera",
    "Ines Beaumont",
    "Dashiell Moon",
  ];
  const histPeople = await db
    .insert(people)
    .values(
      historicalDivers.map((fullName, i) => ({
        shopId,
        fullName,
        email: `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
        phone: `+1-305-555-02${String(i + 20).padStart(2, "0")}`,
        createdAt: nextCreatedAt(),
      })),
    )
    .returning();
  await db
    .insert(personRoles)
    .values(histPeople.map((person) => ({ personId: person.id, role: "diver" as const })));
  await db.insert(certifications).values(
    histPeople.map((person, i) => ({
      shopId,
      personId: person.id,
      agency: i % 2 === 0 ? ("padi" as const) : ("ssi" as const),
      level: i % 3 === 0 ? ("advanced_open_water" as const) : ("open_water" as const),
      identifier: `HIST-${String(i + 1).padStart(4, "0")}`,
      status: "verified" as const,
      ...reviewedBy(createdByPersonId),
    })),
  );

  // The bookable pool is exactly the history-only cohort (see above): large
  // enough that a wrapping slice fills even a 12-seat boat with distinct divers,
  // and never a diver who also sits on an upcoming trip.
  const pool = histPeople.map((person) => person.id);

  // Trips that already sailed. daysAgo is measured from the frozen clock, so the
  // spread lands in this month (month-to-date), last month, and the one before.
  // `hour` is the shop's own clock (see `at`) and the trip runs four hours, so
  // 8 is a morning charter back by noon and 19 is a night dive back by 23:00.
  const tripPlan: Array<{
    daysAgo: number;
    hour: number;
    title: string;
    capacity: number;
    priceCents: number;
    booked: number;
  }> = [
    {
      daysAgo: 1,
      hour: 8,
      title: "Two-Tank Reef — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 10,
    },
    {
      daysAgo: 4,
      hour: 8,
      title: "Wreck Trip — Duane",
      capacity: 10,
      priceCents: 18000,
      booked: 10,
    },
    {
      daysAgo: 8,
      hour: 8,
      title: "Two-Tank Reef — Benwood & Elbow",
      capacity: 12,
      priceCents: 13000,
      booked: 8,
    },
    {
      daysAgo: 12,
      hour: 19,
      title: "Night Dive — Molasses",
      capacity: 8,
      priceCents: 14000,
      booked: 6,
    },
    {
      daysAgo: 16,
      hour: 8,
      title: "Reef Refresh — Christ of the Abyss",
      capacity: 12,
      priceCents: 12500,
      booked: 11,
    },
    {
      daysAgo: 19,
      hour: 8,
      title: "Two-Tank Reef — French & Pickles",
      capacity: 10,
      priceCents: 13000,
      booked: 7,
    },
    {
      daysAgo: 25,
      hour: 8,
      title: "Wreck Trip — Spiegel Grove",
      capacity: 10,
      priceCents: 18000,
      booked: 9,
    },
    {
      daysAgo: 29,
      hour: 8,
      title: "Two-Tank Reef — Molasses",
      capacity: 12,
      priceCents: 13000,
      booked: 12,
    },
    {
      daysAgo: 33,
      hour: 12,
      title: "Afternoon Two-Tank — French Reef",
      capacity: 10,
      priceCents: 13000,
      booked: 8,
    },
    {
      daysAgo: 38,
      hour: 19,
      title: "Night Dive — City of Washington",
      capacity: 8,
      priceCents: 14000,
      booked: 7,
    },
    {
      daysAgo: 43,
      hour: 8,
      title: "Two-Tank Reef — Benwood",
      capacity: 12,
      priceCents: 13000,
      booked: 9,
    },
    {
      daysAgo: 48,
      hour: 8,
      title: "Reef Day — Elbow",
      capacity: 12,
      priceCents: 12500,
      booked: 10,
    },
    {
      daysAgo: 53,
      hour: 8,
      title: "Wreck Trip — Bibb",
      capacity: 10,
      priceCents: 18000,
      booked: 8,
    },
    {
      daysAgo: 58,
      hour: 8,
      title: "Two-Tank Reef — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 11,
    },
    {
      daysAgo: 64,
      hour: 8,
      title: "Two-Tank Reef — Pickles",
      capacity: 10,
      priceCents: 13000,
      booked: 6,
    },
    {
      daysAgo: 70,
      hour: 19,
      title: "Night Dive — Benwood",
      capacity: 8,
      priceCents: 14000,
      booked: 5,
    },
    {
      daysAgo: 76,
      hour: 8,
      title: "Reef Day — Christ of the Abyss",
      capacity: 12,
      priceCents: 12500,
      booked: 9,
    },
    // The rest of the trailing nine months — the same weekly rhythm, further
    // back, so a report run against last quarter (not just last month) still
    // has real trips and real names behind every number.
    {
      daysAgo: 82,
      hour: 8,
      title: "Two-Tank Reef — Molasses",
      capacity: 12,
      priceCents: 13000,
      booked: 10,
    },
    {
      daysAgo: 87,
      hour: 19,
      title: "Night Dive — French Reef",
      capacity: 8,
      priceCents: 14000,
      booked: 6,
    },
    {
      daysAgo: 92,
      hour: 8,
      title: "Wreck Trip — USCGC Duane",
      capacity: 10,
      priceCents: 18500,
      booked: 9,
    },
    {
      daysAgo: 97,
      hour: 8,
      title: "Two-Tank Reef — Pickles Reef",
      capacity: 12,
      priceCents: 13000,
      booked: 8,
    },
    {
      daysAgo: 103,
      hour: 12,
      title: "Afternoon Two-Tank — French Reef",
      capacity: 10,
      priceCents: 13000,
      booked: 7,
    },
    {
      daysAgo: 109,
      hour: 8,
      title: "Reef Day — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 12,
    },
    {
      daysAgo: 115,
      hour: 8,
      title: "Wreck Trip — Spiegel Grove",
      capacity: 10,
      priceCents: 18000,
      booked: 10,
    },
    {
      daysAgo: 121,
      hour: 8,
      title: "Two-Tank Reef — Benwood",
      capacity: 12,
      priceCents: 13000,
      booked: 9,
    },
    {
      daysAgo: 127,
      hour: 19,
      title: "Night Dive — City of Washington",
      capacity: 8,
      priceCents: 14000,
      booked: 5,
    },
    {
      daysAgo: 133,
      hour: 8,
      title: "Reef Day — Christ of the Abyss",
      capacity: 12,
      priceCents: 12500,
      booked: 11,
    },
    {
      daysAgo: 139,
      hour: 8,
      title: "Two-Tank Reef — Elbow",
      capacity: 12,
      priceCents: 13000,
      booked: 8,
    },
    {
      daysAgo: 146,
      hour: 8,
      title: "Wreck Trip — Bibb",
      capacity: 10,
      priceCents: 18000,
      booked: 7,
    },
    {
      daysAgo: 153,
      hour: 8,
      title: "Two-Tank Reef — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 10,
    },
    {
      daysAgo: 160,
      hour: 12,
      title: "Afternoon Two-Tank — Pickles Reef",
      capacity: 10,
      priceCents: 13000,
      booked: 6,
    },
    {
      daysAgo: 167,
      hour: 8,
      title: "Reef Day — French Reef",
      capacity: 12,
      priceCents: 12500,
      booked: 9,
    },
    {
      daysAgo: 174,
      hour: 19,
      title: "Night Dive — Molasses Reef",
      capacity: 8,
      priceCents: 14000,
      booked: 4,
    },
    {
      daysAgo: 181,
      hour: 8,
      title: "Wreck Trip — Duane",
      capacity: 10,
      priceCents: 18000,
      booked: 8,
    },
    {
      daysAgo: 188,
      hour: 8,
      title: "Two-Tank Reef — Christ of the Abyss",
      capacity: 12,
      priceCents: 13000,
      booked: 10,
    },
    {
      daysAgo: 196,
      hour: 8,
      title: "Reef Day — Benwood & Elbow",
      capacity: 12,
      priceCents: 12500,
      booked: 7,
    },
    {
      daysAgo: 204,
      hour: 8,
      title: "Wreck Trip — Spiegel Grove",
      capacity: 10,
      priceCents: 18000,
      booked: 9,
    },
    {
      daysAgo: 212,
      hour: 12,
      title: "Afternoon Two-Tank — Molasses",
      capacity: 10,
      priceCents: 13000,
      booked: 5,
    },
    {
      daysAgo: 221,
      hour: 8,
      title: "Two-Tank Reef — French & Christ",
      capacity: 12,
      priceCents: 13000,
      booked: 11,
    },
    {
      daysAgo: 230,
      hour: 19,
      title: "Night Dive — Benwood Wreck",
      capacity: 8,
      priceCents: 14000,
      booked: 6,
    },
    {
      daysAgo: 239,
      hour: 8,
      title: "Wreck Trip — Bibb",
      capacity: 10,
      priceCents: 18000,
      booked: 10,
    },
    {
      daysAgo: 249,
      hour: 8,
      title: "Reef Day — Pickles Reef",
      capacity: 12,
      priceCents: 12500,
      booked: 8,
    },
    {
      daysAgo: 259,
      hour: 8,
      title: "Two-Tank Reef — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 9,
    },
    {
      daysAgo: 270,
      hour: 8,
      title: "Wreck Trip — USCGC Duane",
      capacity: 10,
      priceCents: 18500,
      booked: 7,
    },
  ];

  const histTrips = await db
    .insert(trips)
    .values(
      tripPlan.map((plan) => ({
        shopId,
        title: plan.title,
        description: "Sailed. Kept in the log for the shop's monthly numbers.",
        startsAt: at(-plan.daysAgo, plan.hour),
        endsAt: at(-plan.daysAgo, plan.hour + 4),
        capacity: plan.capacity,
        priceCents: plan.priceCents,
      })),
    )
    .returning();

  // A boat that sailed had requirements. Without this row every history booking
  // reads `requirements_not_configured` — blocked — while the roll call below
  // says "Boarded", so a demo history manifest showed a green boarding pill
  // beside a red "Requirements not configured" on the same line. That is the
  // exact pairing the boarding gate exists to prevent (`recordRollCall` refuses
  // to create it, src/db/manifests.ts), so the demo was teaching the opposite of
  // the product. Plain reef-trip gates: a signed release and an Open Water card,
  // both of which every diver in the history cohort holds.
  await db.insert(tripRequirements).values(
    histTrips.map((trip) => ({
      tripId: trip.id,
      shopId,
      requiresWaiver: true,
      minimumCertificationLevel: "open_water" as const,
      requiredSpecialties: [] as DiveSpecialty[],
      requiresNitrox: false,
      requiresPayment: false,
    })),
  );

  // Deterministic per-booking plan. `k` is a global booking index; every "is
  // this one a no-show / a deposit / missing its waiver" decision is a fixed
  // function of it, so the whole back-fill is reproducible byte for byte.
  type BookingPlan = {
    shopId: string;
    tripId: string;
    personId: string;
    status: "checked_in" | "no_show" | "cancelled";
    price: number;
    payment: "paid" | "deposit_paid" | "refunded" | "unpaid";
    waiver: boolean;
    order: boolean;
    createdAt: Date;
  };
  const plans: BookingPlan[] = [];
  let k = 0;
  histTrips.forEach((trip, tripIndex) => {
    const plan = tripPlan[tripIndex];
    if (!plan) return;
    const booked = Math.min(plan.booked, plan.capacity, pool.length);
    const start = (tripIndex * 3) % pool.length;
    for (let seat = 0; seat < booked; seat++) {
      const personId = pool[(start + seat) % pool.length];
      if (!personId) continue;
      const cancelled = k % 23 === 7;
      const noShow = !cancelled && k % 17 === 5;
      const status = cancelled ? "cancelled" : noShow ? "no_show" : "checked_in";
      const payment: BookingPlan["payment"] = cancelled
        ? "refunded"
        : k % 13 === 0
          ? "unpaid"
          : k % 5 === 0
            ? "deposit_paid"
            : "paid";
      plans.push({
        shopId,
        tripId: trip.id,
        personId,
        status,
        price: plan.priceCents,
        payment,
        // Anyone who *boarded* has a signed release, because the app will not
        // board anyone who doesn't: readiness gates `boarded` at departure
        // (`recordRollCall`). The missing-waiver variety the demo wants stays
        // on the divers who never got on the boat — a no-show with an unsigned
        // release is a true and common story, and it is the story the manifest
        // should tell beside their "Not boarded".
        waiver: status === "checked_in" ? true : !cancelled && k % 9 !== 0,
        order: payment === "paid" || payment === "deposit_paid",
        createdAt: new Date(trip.startsAt.getTime() - (seat + 1) * 60 * 1000),
      });
      k++;
    }
  });

  const bookingRows = await db
    .insert(bookings)
    .values(
      plans.map((plan) => ({
        shopId,
        tripId: plan.tripId,
        personId: plan.personId,
        status: plan.status,
        createdAt: plan.createdAt,
      })),
    )
    .returning();

  const depositCents = (price: number) => Math.round((price * 0.3) / 100) * 100;

  // Payments: what actually came in. Unpaid leaves no row (an absent row reads
  // as unpaid, exactly as in production); a refund records the reversal.
  const payments = plans
    .map((plan, i) => {
      const booking = bookingRows[i];
      if (!booking || plan.payment === "unpaid") return null;
      const amount =
        plan.payment === "refunded"
          ? 0
          : plan.payment === "deposit_paid"
            ? depositCents(plan.price)
            : plan.price;
      return {
        shopId,
        bookingId: booking.id,
        status: plan.payment,
        amountCents: amount,
        currency: "usd",
        provider: "stripe",
        updatedAt: plan.createdAt,
        createdAt: plan.createdAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (payments.length > 0) await db.insert(bookingPayments).values(payments);

  // Signed releases for the divers who actually boarded.
  let waiverToken = 0;
  const waiverRows = plans
    .map((plan, i) => {
      const booking = bookingRows[i];
      if (!booking || !plan.waiver) return null;
      waiverToken++;
      const signedAt = new Date(plan.createdAt.getTime() - 12 * 60 * 60 * 1000);
      return {
        shopId,
        bookingId: booking.id,
        personId: plan.personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateBody: template.body,
        status: "completed" as const,
        tokenHash: `hist-waiver-${shopId}-${waiverToken}`,
        expiresAt: at(365, 12),
        signedName: "Signed on file",
        signatureMethod: "in_person",
        consentedAt: signedAt,
        signedAt,
        completedAt: signedAt,
        createdAt: signedAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (waiverRows.length > 0) await db.insert(waiverRecords).values(waiverRows);

  // Every one of these boats sailed and tied up again, so each carries a
  // finished head count: departure plus one after-dive count per planned dive.
  // Without it the returned-trip alarm (`roll_call_unfinished` in today.ts)
  // fires forever on the most recent history trip — correct behaviour read
  // against fabricated data, which is not what a demo should teach.
  //
  // A no-show gets one explicit `not_boarded` at departure and nothing after.
  // Carry-forward propagates that absence on its own, and it may never be
  // handed a fabricated `boarded` — "off the boat stays off the boat".
  const rollCallRows = plans.flatMap((plan, i): (typeof rollCallEvents.$inferInsert)[] => {
    const booking = bookingRows[i];
    if (!booking || plan.status === "cancelled") return [];
    const trip = histTrips.find((row) => row.id === plan.tripId);
    if (!trip) return [];
    const base = {
      shopId,
      tripId: plan.tripId,
      bookingId: booking.id,
      recordedByPersonId: createdByPersonId,
      source: "live" as const,
    };
    if (plan.status === "no_show") {
      return [
        {
          ...base,
          status: "not_boarded" as const,
          checkpoint: "departure",
          occurredAt: trip.startsAt,
        },
      ];
    }
    // Departure at the dock, then a count surfacing from each dive, spaced so
    // the ordering is stable and every event lands inside the trip's window.
    return rollCallCheckpoints(trip.plannedDives).map((checkpoint, index) => ({
      ...base,
      status: "boarded" as const,
      checkpoint,
      occurredAt: new Date(trip.startsAt.getTime() + index * 90 * 60 * 1000),
    }));
  });
  if (rollCallRows.length > 0) await db.insert(rollCallEvents).values(rollCallRows);

  // Paid invoices, so a diver's profile shows a real billing history. The Stripe
  // ids are fabricated — the demo never connects an account — which is why the
  // order page disables Refresh/Void/Refund on a demo shop (orders/[id]/page).
  let invoiceSeq = 0;
  const orderRows: Array<{
    booking: { id: string; personId: string };
    total: number;
    kind: "deposit" | "trip_fee";
    title: string;
    date: Date;
  }> = [];
  plans.forEach((plan, i) => {
    const booking = bookingRows[i];
    if (!booking || !plan.order) return;
    const isDeposit = plan.payment === "deposit_paid";
    orderRows.push({
      booking: { id: booking.id, personId: plan.personId },
      total: isDeposit ? depositCents(plan.price) : plan.price,
      kind: isDeposit ? "deposit" : "trip_fee",
      title: isDeposit ? "Trip deposit" : "Two-tank charter",
      date: plan.createdAt,
    });
  });
  if (orderRows.length > 0) {
    const insertedOrders = await db
      .insert(orders)
      .values(
        orderRows.map((row) => {
          invoiceSeq++;
          return {
            shopId,
            bookingId: row.booking.id,
            personId: row.booking.personId,
            createdByPersonId,
            status: "paid" as const,
            currency: "usd",
            totalCents: row.total,
            amountPaidCents: row.total,
            description: row.title,
            stripeAccountId: "acct_demo",
            stripeCustomerId: `cus_demo_${shopId}_${invoiceSeq}`,
            stripeInvoiceId: `in_demo_${shopId}_${invoiceSeq}`,
            finalizedAt: row.date,
            paidAt: row.date,
            createdAt: row.date,
            updatedAt: row.date,
          };
        }),
      )
      .returning();
    await db.insert(orderLineItems).values(
      insertedOrders.map((order, i) => {
        const source = orderRows[i];
        return {
          shopId,
          orderId: order.id,
          kind: source?.kind ?? ("trip_fee" as const),
          description: source?.title ?? "Charter",
          quantity: 1,
          unitAmountCents: order.totalCents,
        };
      }),
    );
  }

  // Tip history gives the export and diver recap surfaces more than an empty
  // state: a couple settled, one is still waiting at checkout, and one
  // expired. These are fabricated demo Stripe references only; no provider is
  // contacted and tips never affect the booking-payment gate.
  const tipRows = plans
    .map((plan, i) => {
      const booking = bookingRows[i];
      if (!booking || plan.status !== "checked_in") return null;
      const state = i % 11 === 0 ? "expired" : i % 7 === 0 ? "pending" : "paid";
      const createdAt = new Date(plan.createdAt.getTime() + 2 * 60 * 60 * 1000);
      return {
        shopId,
        bookingId: booking.id,
        status: state as "pending" | "paid" | "expired",
        stripeAccountId: "acct_demo",
        stripeSessionId: `cs_tip_demo_${shopId}_${i + 1}`,
        checkoutUrl: state === "pending" ? "https://checkout.stripe.com/c/pay/demo-tip" : null,
        currency: "usd",
        amountCents: i % 3 === 0 ? 2_500 : 1_500,
        expiresAt: state === "pending" ? new Date(createdAt.getTime() + DAY_MS) : null,
        completedAt: state === "paid" ? new Date(createdAt.getTime() + 15 * 60 * 1000) : null,
        createdAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (tipRows.length > 0) await db.insert(tips).values(tipRows);

  // Reviews from divers who actually sailed. Deterministic by index (never the
  // clock or randomness) so the frozen-clock e2e fleet renders an identical
  // rating every run. A couple carry words and are published; one carries words
  // and is still waiting on staff, so the moderation queue is demonstrable; the
  // rest are bare ratings, which publish on arrival.
  const reviewComments = [
    "Vis was unreal and the crew found us a turtle on the second tank.",
    "Calm, unhurried briefing — exactly what I wanted for my first boat dive back.",
    "Choppy ride out, but the reef more than made up for it.",
    "The crew made a busy weekend feel easy, thoughtful, and beautifully organized.",
    "A warm, patient crew and a brilliant final drift over the reef.",
  ];
  // The written reviews go on different departures, so the public list reads
  // like a shop's history rather than one memorable boat day.
  const commentedTrips = new Set<string>();
  const reviewRows = plans
    .map((plan, i) => {
      const booking = bookingRows[i];
      if (!booking || plan.status !== "checked_in" || i % 4 !== 0) return null;
      const wantsComment =
        commentedTrips.size < reviewComments.length && !commentedTrips.has(booking.tripId);
      if (wantsComment) commentedTrips.add(booking.tripId);
      const comment = wantsComment ? reviewComments[commentedTrips.size - 1] : null;
      // The fifth written review stays unpublished — that is the "waiting on
      // you" card the staff Reviews page exists to clear.
      const isPublished = comment === null || commentedTrips.size < 5;
      const createdAt = new Date(plan.createdAt.getTime() + 6 * 60 * 60 * 1000);
      return {
        shopId,
        bookingId: booking.id,
        tripId: booking.tripId,
        personId: plan.personId,
        rating: i % 3 === 0 ? 5 : 4,
        comment,
        isStandout: Boolean(comment && isPublished && commentedTrips.size <= 4),
        isPublished,
        publishedAt: isPublished ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (reviewRows.length > 0) await db.insert(tripReviews).values(reviewRows);
}
