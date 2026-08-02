import { hash } from "bcryptjs";
import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate, nowMs } from "@/lib/clock";
import { courseSlug } from "@/lib/courses";
import { generateDemoShopIdentity } from "@/lib/demo-identity";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import type { AppDb, DbExecutor } from "./client";
import { insertCoursePath } from "./course-paths";
import { COURSE_TEMPLATES } from "./course-templates";
import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "./dev-credentials";
import {
  accountTokens,
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  certifications,
  courseInquiries,
  coursePaths,
  courses,
  type DiveSpecialty,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  globalDiveSites,
  globalDiveSiteVersions,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  mediaDeletionAttempts,
  nitroxCertifications,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  orderLineItems,
  orders,
  paymentOperationIntents,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  priorVisits,
  recapPhotos,
  rentalFitProfiles,
  rollCallEvents,
  shopPromoCodes,
  shopPromoRedemptions,
  shopStripeAccounts,
  shops,
  specialtyCertifications,
  staffShifts,
  tips,
  tripAssignments,
  tripDives,
  tripLastMinutePromos,
  tripRequirements,
  tripReviews,
  tripScheduleDays,
  tripSeries,
  trips,
  tripWaitlistEntries,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { getCurrentWaiverTemplate } from "./waivers";

/**
 * Demo data: one Key Largo shop with staff, customers, and a week of trips.
 * Dates are relative to "now" so the schedule always shows upcoming trips.
 * The seeded Blue Mantis shop backs the customer-facing demo experience in
 * every environment (docs ADR 20260718-production-demo-seed).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const INSTRUCTOR_EMAIL = "marcus@demo.invalid";

/**
 * A fixed booking id on the seeded reef trip, so a signed recap link can be
 * minted deterministically for the demo (visual tests, screenshots) without
 * querying a random-uuid booking out of the running server. Real bookings keep
 * their `defaultRandom` ids; only this one demo row is pinned.
 */
export const DEMO_RECAP_BOOKING_ID = "0de3c0de-1eaf-4b0a-9c0f-000000000001";

/** Public-domain and CC0 images from Wikimedia Commons, bundled for reliable rendering. */
function commonsImage(filename: string): string {
  return `/dive-sites/${encodeURIComponent(filename)}`;
}

/** n days from now at the given local-ish hour/minute (UTC-anchored; demo data). */
function at(daysFromNow: number, hour: number, minute = 0): Date {
  const d = new Date(nowMs() + daysFromNow * DAY_MS);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

/**
 * n days from now as a date-only "YYYY-MM-DD" (demo cert expiries, CR-009).
 * Uses the UTC calendar date, not the demo shop's own timezone — fine for the
 * multi-week-out/lapsed values seeded today, but do not use this for a
 * boundary-adjacent value (e.g. "expires today") without switching to
 * `calendarDateInTimezone` first.
 */
function dateAt(daysFromNow: number): string {
  return new Date(nowMs() + daysFromNow * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A birth date chosen so the diver turns exactly `age` on the day `inDays` from
 * the seeded clock — exact calendar arithmetic, not `dateAt`'s day-count
 * approximation, because a birthday callout is precisely the boundary-adjacent
 * case that helper warns against. Anchored to the shop's own timezone so the
 * rendered age and "turns N in 2 days" stay pixel-stable across visual runs.
 */
function birthDateTurning(age: number, inDays: number): string {
  const wall = utcToWallTime(new Date(nowMs() + inDays * DAY_MS), DEMO_SHOP_TIMEZONE);
  return `${String(wall.year - age).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

/**
 * Distinct, clock-anchored `createdAt` stamps for seed rows whose render
 * order depends on insertion order (a trip roster, a diver's card history).
 * Left to the column's `defaultNow()`, every row in the same multi-row
 * INSERT ties on one transaction-start instant — real wall-clock time, not
 * `DIVEDAY_CLOCK` — and Postgres does not promise a stable order for ties,
 * so which diver renders first drifts between runs. Handing out strictly
 * increasing instants removes the tie.
 */
let seedClockTick = 0;
function nextCreatedAt(): Date {
  seedClockTick += 1;
  return new Date(nowMs() + seedClockTick);
}

/**
 * Anchored to the clock rather than the calendar so one seeded trip always
 * sails *today*, whatever time the demo is opened. Today's departure board is
 * the first thing staff see, and a demo that never has a boat out cannot show
 * it. Always in the future, so it never falls out of the upcoming schedule.
 */
function hoursFromNow(hours: number, from = nowDate()): Date {
  const d = new Date(from.getTime() + hours * 60 * 60 * 1000);
  // Round up to the next half hour: dive boats leave at 7:30, not 7:49, and a
  // ragged time reads as a bug in every screenshot of the demo.
  const step = 30 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / step) * step);
}

const DEMO_SHOP_TIMEZONE = "America/New_York";

/**
 * Start of the seeded departure that must sail *today in the shop's timezone*.
 * Within five hours of local midnight the plain now+5h offset rounds into
 * tomorrow, which empties the departure board the demo (and the Today tests)
 * are built around — so it clamps to the last half-hour slot that still sails
 * today. Even in the final half hour before local midnight, when no
 * half-hour-rounded slot is left, this still returns a same-day moment (the
 * earliest still-future instant) rather than concede to tomorrow: "today
 * always has a board" has no exception.
 */
export function demoTodayDepartureStart(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
): Date {
  const localDay = (date: Date) => toDateInputValue(utcToWallTime(date, timeZone));
  const candidate = hoursFromNow(5, now);
  if (localDay(candidate) === localDay(now)) return candidate;
  const lastSlotToday = wallTimeToUtc(
    { ...utcToWallTime(now, timeZone), hour: 23, minute: 30 },
    timeZone,
  );
  if (lastSlotToday.getTime() > now.getTime()) return lastSlotToday;
  const wall = utcToWallTime(now, timeZone);
  const midnight = wallTimeToUtc({ ...wall, day: wall.day + 1, hour: 0, minute: 0 }, timeZone);
  return new Date(Math.min(now.getTime() + 60 * 1000, midnight.getTime() - 1000));
}

export async function seedIfEmpty(db: DbExecutor): Promise<void> {
  const existing = await db.select({ id: shops.id }).from(shops).limit(1);
  if (existing.length > 0) return;
  await seedDemo(db);
}

/**
 * The stable half of the demo: the shop, its default waiver template, its
 * staff, and their logins. Seeded once and left alone — resetting the demo
 * playground never touches these, so a signed-in demo session survives a reset
 * (docs ADR 20260718-demo-mode).
 */
export async function seedDemo(db: DbExecutor, opts: { history?: boolean } = {}): Promise<void> {
  const [shop] = await db
    .insert(shops)
    .values({
      name: "Blue Mantis Divers",
      slug: DEMO_SHOP_SLUG,
      timezone: DEMO_SHOP_TIMEZONE,
      // A front-desk address, not a person's — this is printed on the public
      // course pages, where it backs the "Get in touch" composer.
      contactEmail: "hello@demo.invalid",
      contactPhone: "+1 305 555 0142",
      // A real street exercises the address end to end (structured data,
      // settings form) without publishing anything a search engine could act
      // on for a demo fixture.
      addressStreet: "100 Ocean Drive",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      addressPostalCode: "33037",
      addressCountry: "US",
      // Rents the core kit plus both add-ons and fills nitrox, and prices them:
      // a full set is cheaper than the pieces, each piece has its own price, and
      // nitrox is a per-dive surcharge. Divers see these when they set their
      // rental fit. Most real shops leave nitrox unticked (default off) — the
      // demo shop opts in so the flow has something to demonstrate.
      rentalItems: [
        "bcd",
        "regulator",
        "wetsuit",
        "mask_fins",
        "weights",
        "dive_computer",
        "gopro",
        "nitrox",
      ],
      rentalPricing: {
        setCents: 4500,
        perItemCents: {
          bcd: 1500,
          regulator: 1500,
          wetsuit: 1200,
          mask_fins: 800,
          weights: 500,
          dive_computer: 1000,
          gopro: 2000,
        },
        nitroxCents: 1200,
      },
      isDemo: true,
    })
    .returning();
  if (!shop) throw new Error("seed: failed to insert demo shop");

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: "Blue Mantis Diving Release",
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  const staffDefs = [
    { fullName: "Dana Reyes", email: "dana@demo.invalid", roles: ["owner", "manager"] },
    { fullName: "Marcus Webb", email: INSTRUCTOR_EMAIL, roles: ["instructor"] },
    { fullName: "Keiko Tanaka", email: "keiko@demo.invalid", roles: ["divemaster"] },
    { fullName: "Sal Moretti", email: "sal@demo.invalid", roles: ["captain"] },
  ] as const;

  const staff = await db
    .insert(people)
    .values(
      staffDefs.map((s) => ({
        shopId: shop.id,
        fullName: s.fullName,
        email: s.email,
        emergencyContactName: "On file",
        emergencyContactPhone: "+1-305-555-0100",
      })),
    )
    .returning();

  await db.insert(personRoles).values(
    staff.flatMap((person, i) =>
      staffDefs[i].roles.map((role) => ({
        personId: person.id,
        role,
      })),
    ),
  );

  // Staff sign-in accounts use the demo bypass token rather than storing that
  // public password as a real credential. This keeps the bypass scoped to the
  // demo shop: if a test or operator turns isDemo off, "password" no longer
  // authenticates these accounts. Cost 4 keeps seeding fast in tests; real
  // account creation flows must use a production-grade cost.
  const logins = Object.values(DEV_STAFF_LOGINS);
  await db.insert(userAccounts).values(
    await Promise.all(
      logins.map(async (login) => {
        const person = staff.find((p) => p.email === login.email);
        if (!person) throw new Error(`seed: no staff person for ${login.email}`);
        return {
          personId: person.id,
          email: login.email,
          hashedPassword: await hash(crypto.randomUUID(), 4),
        };
      }),
    ),
  );

  const demoShiftStart = new Date(demoTodayDepartureStart().getTime() - 60 * 60 * 1000);
  const demoShiftEnd = new Date(demoShiftStart.getTime() + 12 * 60 * 60 * 1000);
  await db.insert(staffShifts).values(
    staff.map((person) => ({
      shopId: shop.id,
      personId: person.id,
      startsAt: demoShiftStart,
      endsAt: demoShiftEnd,
      note: "Demo schedule",
      createdByPersonId: person.id,
    })),
  );

  await seedDemoSchedule(db, shop.id, opts);
}

/**
 * Mint a brand-new, self-contained demo shop with a generated identity and the
 * full demo dataset, and return how to sign into it. This is what "Try the live
 * demo" creates now: each visitor gets their own disposable `isDemo` shop instead
 * of sharing the canonical blue-mantis fixture (ADR 20260724-per-visitor-demo-shops).
 *
 * The staff are the same friendly cast as the canonical demo (Dana/Marcus/Keiko/
 * Sal) so the demo banner and role switcher read identically, but their emails
 * are namespaced under the unique slug so they never collide on the global
 * `user_accounts.email` index. Sign-in for every role goes through the `isDemo`
 * bypass token (src/lib/credentials.ts), so no real password is minted or stored.
 *
 * The random slug suffix makes collisions on the global `shops.slug` index
 * astronomically unlikely under concurrent minting; a `23505` here means "the
 * visitor hit that lottery" and the action can simply be retried.
 */
export async function createDemoShop(
  db: DbExecutor,
): Promise<{ slug: string; ownerEmail: string }> {
  // Aggregate storage cap (security review, finding 1): the per-IP rate limit
  // bounds one visitor's burst but not the fleet-wide total, so an IP-rotating
  // attacker could pile up minted shops between 7-day reaper passes. Before
  // minting, evict the oldest minted demos so the live count never exceeds the
  // ceiling — the canonical demo and real shops are never eligible (see below).
  await enforceMintedDemoCap(db);

  const identity = generateDemoShopIdentity();

  const [shop] = await db
    .insert(shops)
    .values({
      name: identity.name,
      slug: identity.slug,
      timezone: DEMO_SHOP_TIMEZONE,
      rentalItems: [
        "bcd",
        "regulator",
        "wetsuit",
        "mask_fins",
        "weights",
        "dive_computer",
        "gopro",
        "nitrox",
      ],
      rentalPricing: {
        setCents: 4500,
        perItemCents: {
          bcd: 1500,
          regulator: 1500,
          wetsuit: 1200,
          mask_fins: 800,
          weights: 500,
          dive_computer: 1000,
          gopro: 2000,
        },
        nitroxCents: 1200,
      },
      isDemo: true,
    })
    .returning();
  if (!shop) throw new Error("createDemoShop: failed to insert shop");

  await db.insert(waiverTemplates).values({
    shopId: shop.id,
    title: DEFAULT_WAIVER_TITLE,
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  const staffDefs = [
    { fullName: "Dana Reyes", local: "dana", roles: ["owner", "manager"] },
    { fullName: "Marcus Webb", local: "marcus", roles: ["instructor"] },
    { fullName: "Keiko Tanaka", local: "keiko", roles: ["divemaster"] },
    { fullName: "Sal Moretti", local: "sal", roles: ["captain"] },
  ] as const;

  const staff = await db
    .insert(people)
    .values(
      staffDefs.map((s) => ({
        shopId: shop.id,
        fullName: s.fullName,
        email: identity.emailFor(s.local),
        emergencyContactName: "On file",
        emergencyContactPhone: "+1-305-555-0100",
      })),
    )
    .returning();

  await db
    .insert(personRoles)
    .values(
      staff.flatMap((person, i) =>
        staffDefs[i].roles.map((role) => ({ personId: person.id, role })),
      ),
    );

  // Placeholder hashes: every demo sign-in uses the isDemo bypass token, so these
  // accounts never need a password that matches.
  await db.insert(userAccounts).values(
    await Promise.all(
      staff.map(async (person, i) => ({
        personId: person.id,
        email: identity.emailFor(staffDefs[i].local),
        hashedPassword: await hash(crypto.randomUUID(), 4),
      })),
    ),
  );

  // No fabricated billing back-fill on a minted demo: `seedHistory` pins
  // globally-unique waiver token hashes and Stripe ids that would collide with
  // the canonical demo (and with a second minted demo). The billing/orders
  // showcase lives on blue-mantis; a throwaway demo is the lean schedule.
  await seedDemoSchedule(db, shop.id, { history: false });

  return { slug: shop.slug, ownerEmail: identity.emailFor("dana") };
}

/**
 * The shop's divers. **Order is load-bearing**: the rosters below index into
 * this list, and tests assert on the exact names that land on today's boat.
 * Append to the end; never reorder or insert.
 *
 * Emergency contacts are deliberately incomplete. A manifest whose every field
 * is filled cannot show a crew what a manifest is *for*, so two divers arrive
 * without one and the roll-call sheet says so out loud.
 */
const customerDefs: Array<{ fullName: string; emergencyContact?: [string, string] }> = [
  { fullName: "Priya Sharma", emergencyContact: ["Asha Sharma (sister)", "+1-305-555-0231"] },
  { fullName: "Tom Okafor", emergencyContact: ["Ngozi Okafor (wife)", "+1-305-555-0232"] },
  { fullName: "Lena Fischer", emergencyContact: ["Jonas Fischer (husband)", "+49-30-555-0233"] },
  { fullName: "Diego Alvarez", emergencyContact: ["Rosa Alvarez (mother)", "+1-786-555-0234"] },
  { fullName: "June Park", emergencyContact: ["Min-ho Park (father)", "+1-305-555-0235"] },
  { fullName: "Omar Haddad", emergencyContact: ["Layla Haddad (sister)", "+1-305-555-0236"] },
  // No contact on file: the manifest gap the crew chases at the dock.
  { fullName: "Nadia Petrov" },
  { fullName: "Sam Whitfield", emergencyContact: ["Ruth Whitfield (mother)", "+1-954-555-0238"] },
  { fullName: "Ines Costa", emergencyContact: ["Paulo Costa (brother)", "+351-21-555-0239"] },
  { fullName: "Ravi Menon", emergencyContact: ["Divya Menon (wife)", "+1-305-555-0240"] },
  { fullName: "Amara Osei", emergencyContact: ["Kwame Osei (father)", "+1-305-555-0241"] },
  { fullName: "Felix Grant" },
  { fullName: "Hana Kobayashi", emergencyContact: ["Ren Kobayashi (brother)", "+81-3-555-0243"] },
  { fullName: "Mateo Duarte", emergencyContact: ["Sofia Duarte (wife)", "+1-305-555-0244"] },
  { fullName: "Zoe Bennett", emergencyContact: ["Harriet Bennett (mother)", "+44-20-555-0245"] },
  { fullName: "Yusuf Demir", emergencyContact: ["Elif Demir (sister)", "+90-212-555-0246"] },
  { fullName: "Clara Nguyen", emergencyContact: ["Binh Nguyen (father)", "+1-305-555-0247"] },
  { fullName: "Theo Lindqvist", emergencyContact: ["Ida Lindqvist (wife)", "+46-8-555-0248"] },
  // The extended roster: repeat locals, snowbirds, and traveling divers who
  // fill out the trips beyond today's three headline boats. Most carry an
  // emergency contact — that's the norm at a real front desk — with a handful
  // of gaps left deliberately (see customers above) so the manifest gap never
  // reads as fixed to two specific people.
  { fullName: "Carmen Ruiz", emergencyContact: ["Alejandro Ruiz (husband)", "+1-786-555-0249"] },
  { fullName: "Jonas Kallio", emergencyContact: ["Sanna Kallio (wife)", "+358-9-555-0250"] },
  { fullName: "Beatriz Almeida", emergencyContact: ["Tiago Almeida (brother)", "+55-21-555-0251"] },
  { fullName: "Malik Johnson", emergencyContact: ["Renee Johnson (mother)", "+1-954-555-0252"] },
  { fullName: "Siobhan Doyle", emergencyContact: ["Patrick Doyle (father)", "+353-1-555-0253"] },
  { fullName: "Yuki Tanaka", emergencyContact: ["Sora Tanaka (husband)", "+81-3-555-0254"] },
  { fullName: "Adaeze Nwosu", emergencyContact: ["Chidi Nwosu (brother)", "+234-1-555-0255"] },
  { fullName: "Piotr Kowalski", emergencyContact: ["Ewa Kowalski (wife)", "+48-22-555-0256"] },
  { fullName: "Grace Mensah", emergencyContact: ["Kofi Mensah (father)", "+233-30-555-0257"] },
  // No contact on file: a second manifest gap, this time a first-time diver
  // who booked online in a hurry.
  { fullName: "Connor Blake" },
  { fullName: "Isabel Moreno", emergencyContact: ["Fernando Moreno (father)", "+34-91-555-0259"] },
  { fullName: "Niklas Berg", emergencyContact: ["Astrid Berg (wife)", "+47-22-555-0260"] },
  { fullName: "Rania Youssef", emergencyContact: ["Hassan Youssef (husband)", "+20-2-555-0261"] },
  { fullName: "Declan Murphy", emergencyContact: ["Maeve Murphy (mother)", "+353-1-555-0262"] },
  { fullName: "Wan Chen", emergencyContact: ["Li Chen (wife)", "+86-21-555-0263"] },
  {
    fullName: "Fatima Al-Rashid",
    emergencyContact: ["Omar Al-Rashid (brother)", "+971-4-555-0264"],
  },
  { fullName: "Tyler Brooks", emergencyContact: ["Karen Brooks (mother)", "+1-305-555-0265"] },
  { fullName: "Miriam Cohen", emergencyContact: ["David Cohen (husband)", "+972-3-555-0266"] },
  { fullName: "Josip Horvat", emergencyContact: ["Ana Horvat (wife)", "+385-1-555-0267"] },
  { fullName: "Aroha Ngata", emergencyContact: ["Manaia Ngata (partner)", "+64-9-555-0268"] },
  // No contact on file.
  { fullName: "Julian Marsh" },
  { fullName: "Chiara Bianchi", emergencyContact: ["Luca Bianchi (husband)", "+39-06-555-0270"] },
  { fullName: "Efrain Torres", emergencyContact: ["Marisela Torres (wife)", "+52-55-555-0271"] },
  {
    fullName: "Anong Suwannee",
    emergencyContact: ["Somchai Suwannee (husband)", "+66-2-555-0272"],
  },
  { fullName: "Bram de Vries", emergencyContact: ["Anna de Vries (wife)", "+31-20-555-0273"] },
  { fullName: "Naledi Khumalo", emergencyContact: ["Thabo Khumalo (brother)", "+27-11-555-0274"] },
  { fullName: "Callum Fraser", emergencyContact: ["Morag Fraser (mother)", "+44-131-555-0275"] },
  { fullName: "Esperanza Cruz", emergencyContact: ["Ramon Cruz (father)", "+1-787-555-0276"] },
  { fullName: "Henrique Silva", emergencyContact: ["Beatriz Silva (wife)", "+55-11-555-0277"] },
  { fullName: "Petra Novak", emergencyContact: ["Milan Novak (husband)", "+420-2-555-0278"] },
  {
    fullName: "Odalys Fernandez",
    emergencyContact: ["Julio Fernandez (father)", "+1-305-555-0279"],
  },
  { fullName: "Kwame Asante", emergencyContact: ["Abena Asante (wife)", "+233-30-555-0280"] },
  { fullName: "Ingrid Solberg", emergencyContact: ["Erik Solberg (husband)", "+47-22-555-0281"] },
  // No contact on file — a walk-up who booked from the dock.
  { fullName: "Reggie Palmer" },
  // A second wave: the shop's snowbird regulars, a dive club that books as a
  // block, and the steady trickle of one-off tourists who fill out the rest
  // of the month's boats.
  { fullName: "Harriet Voss", emergencyContact: ["Edwin Voss (husband)", "+1-239-555-0282"] },
  { fullName: "Rosalind Okoye", emergencyContact: ["Emeka Okoye (husband)", "+234-1-555-0283"] },
  { fullName: "Lukas Steiner", emergencyContact: ["Nina Steiner (wife)", "+41-22-555-0284"] },
  {
    fullName: "Renata Souza",
    emergencyContact: ["Rafael Souza (brother)", "+55-21-555-0285"],
  },
  { fullName: "Dmitri Volkov", emergencyContact: ["Elena Volkov (wife)", "+7-495-555-0286"] },
  { fullName: "Amina Diallo", emergencyContact: ["Ousmane Diallo (father)", "+221-33-555-0287"] },
  // No contact on file.
  { fullName: "Trevor Lang" },
  { fullName: "Soraya Karimi", emergencyContact: ["Reza Karimi (husband)", "+98-21-555-0289"] },
  {
    fullName: "Finn O'Sullivan",
    emergencyContact: ["Grainne O'Sullivan (mother)", "+353-1-555-0290"],
  },
  { fullName: "Ling Zhao", emergencyContact: ["Wei Zhao (husband)", "+86-10-555-0291"] },
  { fullName: "Pablo Iglesias", emergencyContact: ["Lucia Iglesias (wife)", "+34-91-555-0292"] },
  { fullName: "Charlotte Reid", emergencyContact: ["William Reid (father)", "+1-770-555-0293"] },
  { fullName: "Mikael Andersson", emergencyContact: ["Elin Andersson (wife)", "+46-31-555-0294"] },
  { fullName: "Zara Ahmed", emergencyContact: ["Bilal Ahmed (brother)", "+92-21-555-0295"] },
  {
    fullName: "Owen Fitzgerald",
    emergencyContact: ["Maureen Fitzgerald (mother)", "+1-617-555-0296"],
  },
  { fullName: "Valeria Gomez", emergencyContact: ["Hector Gomez (husband)", "+52-33-555-0297"] },
  // No contact on file.
  { fullName: "Casey Winters" },
  { fullName: "Nour Khalil", emergencyContact: ["Samir Khalil (father)", "+961-1-555-0299"] },
  { fullName: "Bjorn Haugen", emergencyContact: ["Kari Haugen (wife)", "+47-55-555-0300"] },
  { fullName: "Adaora Chukwu", emergencyContact: ["Emeka Chukwu (husband)", "+234-1-555-0301"] },
  { fullName: "Tomasz Wojcik", emergencyContact: ["Agnieszka Wojcik (wife)", "+48-12-555-0302"] },
  { fullName: "Meilin Tan", emergencyContact: ["Wei Tan (father)", "+65-6-555-0303"] },
  { fullName: "Dario Conti", emergencyContact: ["Giulia Conti (wife)", "+39-02-555-0304"] },
  { fullName: "Simone Laurent", emergencyContact: ["Pierre Laurent (husband)", "+33-1-555-0305"] },
  {
    fullName: "Kiona Blackfeather",
    emergencyContact: ["Dawn Blackfeather (mother)", "+1-505-555-0306"],
  },
  { fullName: "Anders Lindgren", emergencyContact: ["Freja Lindgren (wife)", "+46-8-555-0307"] },
  // No contact on file — booked same-day, straight from the marina.
  { fullName: "Blake Sutton" },
  { fullName: "Meera Iyer", emergencyContact: ["Arjun Iyer (husband)", "+91-22-555-0309"] },
  { fullName: "Georg Fischer", emergencyContact: ["Hilde Fischer (wife)", "+43-1-555-0310"] },
  { fullName: "Chinwe Obi", emergencyContact: ["Emeka Obi (brother)", "+234-1-555-0311"] },
  { fullName: "Sana Malik", emergencyContact: ["Imran Malik (father)", "+92-42-555-0312"] },
];

/**
 * The resettable half of the demo: customers, their cards, the course catalog,
 * trips, requirements, and bookings. This is the playground a prospective
 * customer pokes at — schedule a trip, cancel a booking, fill a boat — and the
 * exact set of rows resetDemoSchedule restores. Staff already exist (stable
 * half), so the instructor is looked up rather than passed in.
 */
export async function seedDemoSchedule(
  db: DbExecutor,
  shopId: string,
  opts: { history?: boolean } = {},
): Promise<void> {
  // Look the instructor up by their role within the shop, not by a hardcoded
  // email — so this seeds the canonical blue-mantis demo and any freshly-minted
  // demo shop (whose staff carry per-shop-unique emails) alike.
  const [instructor] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "instructor")))
    .limit(1);
  if (!instructor) throw new Error("seed: instructor missing from stable staff");

  // Only the canonical blue-mantis demo pins the recap booking's id — the visual
  // tests mint a recap link from that fixed id. A freshly-minted demo shop gets a
  // random id so a second demo never collides on that primary key.
  const [shopRow] = await db
    .select({ slug: shops.slug })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const pinRecapBooking = shopRow?.slug === DEMO_SHOP_SLUG;

  const customers = await db
    .insert(people)
    .values(
      customerDefs.map((customer, i) => ({
        shopId,
        fullName: customer.fullName,
        email: `${customer.fullName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
        phone: `+1-305-555-01${String(i + 10).padStart(2, "0")}`,
        emergencyContactName: customer.emergencyContact?.[0] ?? null,
        emergencyContactPhone: customer.emergencyContact?.[1] ?? null,
        // A few dates on file so the H-08 minimum-age gate and the H-21
        // roster surfaces have something to demo; most divers deliberately have
        // none, which is the fail-open case every existing shop starts from.
        // Anchored to the seeded clock so the rendered age never drifts across
        // visual-regression runs.
        //
        // Diver 2 is a 13-year-old with a birthday two days out: one row that
        // exercises the minor badge, the birthday callout *and* the junior
        // depth band (12–14 → 18 m) all at once.
        dateOfBirth: i === 2 ? birthDateTurning(14, 2) : i < 2 ? dateAt(-365 * (28 + i * 5)) : null,
      })),
    )
    .returning();

  await db
    .insert(personRoles)
    .values(customers.map((person) => ({ personId: person.id, role: "diver" as const })));

  await db.insert(certifications).values(
    customers.slice(0, 10).map((person, i) => ({
      shopId,
      personId: person.id,
      agency: i % 2 === 0 ? ("padi" as const) : ("ssi" as const),
      level: i === 1 ? ("advanced_open_water" as const) : ("open_water" as const),
      identifier: `DEMO-${String(i + 1).padStart(4, "0")}`,
      status: "verified" as const,
    })),
  );

  // The rest of the regulars, carrying the states a desk actually sees: cards
  // still queued for review, one expiring inside the month, one already lapsed
  // (shown red and not counted as valid), and agencies beyond the two the shop
  // teaches. Kept separate from the block above because that block's ten divers
  // crew today's boat and their readiness is asserted exactly.
  const laterCerts: Array<{
    index: number;
    agency: "padi" | "ssi" | "naui" | "sdi" | "tdi";
    level: "open_water" | "advanced_open_water" | "rescue" | "divemaster";
    status: "verified" | "pending";
    expiresAt?: string;
    /** A card brought in by the contact importer: verified but flagged imported,
     * awaiting a one-tap staff confirm (ADR 20260724-import-verified-cards). */
    importedFromLabel?: string;
  }> = [
    // Imported from the diver's prior shop: verified and flagged imported, with a
    // one-tap "Confirm card" nudge still open (reviewedAt stays null).
    {
      index: 12,
      agency: "padi",
      level: "advanced_open_water",
      status: "verified",
      importedFromLabel: "Coral Coast Divers",
    },
    { index: 13, agency: "ssi", level: "open_water", status: "pending" },
    { index: 14, agency: "padi", level: "rescue", status: "verified", expiresAt: dateAt(26) },
    // Certified once, but the card lapsed a few weeks ago — no longer valid.
    { index: 15, agency: "naui", level: "open_water", status: "verified", expiresAt: dateAt(-24) },
    { index: 16, agency: "sdi", level: "open_water", status: "verified" },
    { index: 17, agency: "tdi", level: "divemaster", status: "verified" },
    // The extended roster: the AOW+Deep track for the Duane wreck charter (18-20
    // ready, once their specialty/nitrox cards below land; 21-23 stay short a
    // gate each — level, specialty, or nitrox — the way a real wreck roster
    // never clears in one pass).
    { index: 18, agency: "padi", level: "advanced_open_water", status: "verified" },
    { index: 19, agency: "ssi", level: "advanced_open_water", status: "verified" },
    { index: 20, agency: "naui", level: "advanced_open_water", status: "verified" },
    { index: 21, agency: "padi", level: "open_water", status: "verified" },
    { index: 22, agency: "ssi", level: "advanced_open_water", status: "verified" },
    { index: 23, agency: "sdi", level: "open_water", status: "verified" },
    // The Night specialty track for the second night dive.
    { index: 24, agency: "padi", level: "open_water", status: "verified" },
    { index: 25, agency: "ssi", level: "open_water", status: "verified" },
    { index: 26, agency: "padi", level: "open_water", status: "pending" },
    // index 27 (Connor Blake) stays uncertified — a Discover Scuba first-timer.
    { index: 28, agency: "ssi", level: "open_water", status: "verified" },
    { index: 29, agency: "padi", level: "advanced_open_water", status: "verified" },
    { index: 30, agency: "naui", level: "open_water", status: "verified" },
    // Lapsed a week and a half ago — a second "refresher due" case beyond
    // Yusuf's, on an agency the shop doesn't teach itself.
    { index: 31, agency: "tdi", level: "open_water", status: "verified", expiresAt: dateAt(-10) },
    { index: 32, agency: "padi", level: "open_water", status: "verified" },
    { index: 33, agency: "sdi", level: "advanced_open_water", status: "verified" },
    { index: 34, agency: "ssi", level: "open_water", status: "pending" },
    { index: 35, agency: "padi", level: "rescue", status: "verified" },
    { index: 36, agency: "naui", level: "open_water", status: "verified" },
    { index: 37, agency: "padi", level: "open_water", status: "verified" },
    // index 38 (Julian Marsh) stays uncertified — a walk-up who booked from the dock.
    { index: 39, agency: "ssi", level: "open_water", status: "verified" },
    { index: 40, agency: "padi", level: "advanced_open_water", status: "verified" },
    { index: 41, agency: "sdi", level: "open_water", status: "verified" },
    { index: 42, agency: "tdi", level: "advanced_open_water", status: "verified" },
    { index: 43, agency: "padi", level: "open_water", status: "verified" },
    // Expiring inside the month, same shape as Marcus's Rescue card above.
    { index: 44, agency: "ssi", level: "open_water", status: "verified", expiresAt: dateAt(12) },
    { index: 45, agency: "naui", level: "open_water", status: "verified" },
    { index: 46, agency: "padi", level: "advanced_open_water", status: "verified" },
    { index: 47, agency: "ssi", level: "open_water", status: "pending" },
    { index: 48, agency: "padi", level: "open_water", status: "verified" },
    { index: 49, agency: "sdi", level: "open_water", status: "verified" },
    { index: 50, agency: "tdi", level: "advanced_open_water", status: "verified" },
    // A second imported-card case, from a different prior shop than Hana's —
    // verified but still waiting on the one-tap staff confirm.
    {
      index: 51,
      agency: "padi",
      level: "open_water",
      status: "verified",
      importedFromLabel: "Keys Dive Center",
    },
    // The second wave (52-82): the same spread again — mostly verified across
    // every agency the shop sees, a couple still pending review, one more
    // lapsed card, one more expiring soon. Indices 58, 68, and 78 (all "no
    // contact on file" walk-ups above) stay uncertified on purpose.
    { index: 52, agency: "padi", level: "advanced_open_water", status: "verified" },
    { index: 53, agency: "ssi", level: "open_water", status: "verified" },
    { index: 54, agency: "naui", level: "advanced_open_water", status: "verified" },
    { index: 55, agency: "padi", level: "open_water", status: "verified" },
    { index: 56, agency: "tdi", level: "advanced_open_water", status: "verified" },
    { index: 57, agency: "sdi", level: "open_water", status: "verified" },
    { index: 59, agency: "padi", level: "open_water", status: "pending" },
    { index: 60, agency: "ssi", level: "advanced_open_water", status: "verified" },
    { index: 61, agency: "padi", level: "open_water", status: "verified" },
    { index: 62, agency: "naui", level: "open_water", status: "verified" },
    { index: 63, agency: "padi", level: "rescue", status: "verified" },
    { index: 64, agency: "ssi", level: "advanced_open_water", status: "verified" },
    { index: 65, agency: "sdi", level: "open_water", status: "verified" },
    // Lapsed two months ago — the oldest of the three "refresher due" cases.
    { index: 66, agency: "padi", level: "open_water", status: "verified", expiresAt: dateAt(-60) },
    { index: 67, agency: "tdi", level: "open_water", status: "verified" },
    { index: 69, agency: "padi", level: "open_water", status: "verified" },
    { index: 70, agency: "ssi", level: "advanced_open_water", status: "verified" },
    { index: 71, agency: "padi", level: "open_water", status: "verified" },
    { index: 72, agency: "naui", level: "open_water", status: "pending" },
    { index: 73, agency: "sdi", level: "open_water", status: "verified" },
    { index: 74, agency: "padi", level: "advanced_open_water", status: "verified" },
    { index: 75, agency: "ssi", level: "open_water", status: "verified" },
    { index: 76, agency: "padi", level: "divemaster", status: "verified" },
    { index: 77, agency: "tdi", level: "open_water", status: "verified" },
    { index: 79, agency: "padi", level: "open_water", status: "verified" },
    { index: 80, agency: "ssi", level: "advanced_open_water", status: "verified" },
    { index: 81, agency: "padi", level: "open_water", status: "verified" },
    { index: 82, agency: "sdi", level: "open_water", status: "verified" },
  ];
  const laterCertRows = laterCerts
    .map((cert) => {
      const person = customers[cert.index];
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        agency: cert.agency,
        level: cert.level,
        identifier: `DEMO-${String(cert.index + 1).padStart(4, "0")}`,
        status: cert.status,
        expiresAt: cert.expiresAt ?? null,
        // An imported card keeps reviewedAt null so the confirm nudge shows.
        importedAt: cert.importedFromLabel ? nextCreatedAt() : null,
        importedFromLabel: cert.importedFromLabel ?? null,
      };
    })
    .filter((row) => row !== null);
  if (laterCertRows.length > 0) await db.insert(certifications).values(laterCertRows);

  // Specialty evidence: customer[1] is the AOW diver, fully carded for the
  // demanding trips; customer[2] has a Deep card still awaiting verification so
  // the pending gate is visible on a roster.
  if (customers[1] && customers[2]) {
    await db.insert(specialtyCertifications).values([
      {
        shopId,
        personId: customers[1].id,
        agency: "padi" as const,
        specialty: "deep" as const,
        identifier: "DEMO-SPEC-DEEP-2",
        status: "verified" as const,
        createdAt: nextCreatedAt(),
      },
      {
        shopId,
        personId: customers[1].id,
        agency: "padi" as const,
        specialty: "wreck" as const,
        identifier: "DEMO-SPEC-WRECK-2",
        status: "verified" as const,
        createdAt: nextCreatedAt(),
      },
      {
        shopId,
        personId: customers[1].id,
        agency: "padi" as const,
        specialty: "night" as const,
        identifier: "DEMO-SPEC-NIGHT-2",
        status: "verified" as const,
        createdAt: nextCreatedAt(),
      },
      {
        shopId,
        personId: customers[2].id,
        agency: "ssi" as const,
        specialty: "deep" as const,
        identifier: "DEMO-SPEC-DEEP-3",
        status: "pending" as const,
        createdAt: nextCreatedAt(),
      },
    ]);
  }

  // Extended-roster specialty evidence: the Deep track for the Duane wreck
  // charter (18-20 verified, 22 still pending — AOW alone never clears a
  // wreck gate) and the Night track for the second night dive (24-25
  // verified, 29 pending).
  const extendedSpecialtyPlan: Array<{
    index: number;
    specialty: DiveSpecialty;
    status: "verified" | "pending";
  }> = [
    { index: 18, specialty: "deep", status: "verified" },
    { index: 19, specialty: "deep", status: "verified" },
    { index: 20, specialty: "deep", status: "verified" },
    { index: 22, specialty: "deep", status: "pending" },
    { index: 24, specialty: "night", status: "verified" },
    { index: 25, specialty: "night", status: "verified" },
    { index: 29, specialty: "night", status: "pending" },
    // Cold-water visitors — Drysuit never gates a Key Largo trip, but a
    // traveling diver's card still shows up on their profile.
    { index: 46, specialty: "drysuit", status: "verified" },
    { index: 70, specialty: "drysuit", status: "verified" },
  ];
  const extendedSpecialtyRows = extendedSpecialtyPlan
    .map((plan) => {
      const person = customers[plan.index];
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        agency: "padi" as const,
        specialty: plan.specialty,
        identifier: `DEMO-SPEC-${plan.specialty.toUpperCase()}-${plan.index + 1}`,
        status: plan.status,
        createdAt: nextCreatedAt(),
      };
    })
    .filter((row) => row !== null);
  if (extendedSpecialtyRows.length > 0) {
    await db.insert(specialtyCertifications).values(extendedSpecialtyRows);
  }

  // The imported-card states, on customer[12] (Hana Kobayashi) — the diver whose
  // level card already arrives imported, and whose profile the visual baseline
  // captures. She is booked on nothing (bookings use customers 0-9), so carding
  // her cannot flip any seeded trip's readiness, manifest, or Today queue.
  //
  // Without these rows the two states H-23/H-24 exist for have no baseline at
  // all: the amber "certified · confirm to clear" badge, and the confirm that
  // requires a staffer to attest they have seen the card. Both are what stands
  // between a spreadsheet cell and a depth gate or a gas fill, so both should be
  // protected from a silent regression.
  if (customers[12]) {
    await db.insert(specialtyCertifications).values([
      {
        shopId,
        personId: customers[12].id,
        agency: "padi" as const,
        specialty: "deep" as const,
        identifier: "DEMO-SPEC-DEEP-13",
        status: "verified" as const,
        // Verified but unconfirmed: the gate stays shut and the card reads
        // "certified · confirm to clear" (ADR 20260725-import-specialty-cards).
        importedAt: nextCreatedAt(),
        importedFromLabel: "Coral Coast Divers",
        createdAt: nextCreatedAt(),
      },
    ]);
  }

  // Catalog baselines: DSD/OW welcome uncertified students; continuing
  // education admits only a verified card at the stated level.
  const courseRows = await db
    .insert(courses)
    .values(
      [
        {
          shopId,
          agency: "padi",
          title: "Discover Scuba Diving",
          description: "A supervised first underwater experience with an instructor.",
          priceCents: 17500,
          minimumCertificationLevel: null,
          isIntroCourse: true,
        },
        {
          shopId,
          agency: "padi",
          title: "Open Water Diver",
          description: "The foundational certification course for new divers.",
          priceCents: 49900,
          eLearningPriceCents: 21000,
          minimumCertificationLevel: null,
        },
        {
          shopId,
          agency: "padi",
          title: "Advanced Open Water Diver",
          description: "Build confidence and range with five adventure dives.",
          priceCents: 42500,
          eLearningPriceCents: 19000,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Scuba Refresher",
          description: "A patient skills tune-up before getting back in the water.",
          priceCents: 12500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Rescue Diver",
          description: "Problem prevention and rescue skills for experienced divers.",
          priceCents: 52500,
          eLearningPriceCents: 24500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Nitrox Diver",
          description: "Plan and dive safely with Nitrox.",
          priceCents: 19500,
          eLearningPriceCents: 15000,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Peak Performance Buoyancy",
          description: "Two dives spent fixing weighting, trim, and control.",
          priceCents: 22500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Night Diver",
          description: "Three evening dives and the skills the dark demands.",
          priceCents: 29500,
          eLearningPriceCents: 14500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Deep Diver",
          description: "Four dives that extend your range to 40 meters.",
          priceCents: 42500,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Wreck Diver",
          description: "Survey, mapping, and limited penetration on four dives.",
          priceCents: 44500,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Divemaster",
          description: "The first professional rating, taught as an internship.",
          priceCents: 125000,
          eLearningPriceCents: 32500,
          minimumCertificationLevel: "rescue" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Try Scuba",
          description: "A supervised first scuba experience.",
          priceCents: 15000,
          minimumCertificationLevel: null,
          isIntroCourse: true,
        },
        {
          shopId,
          agency: "ssi",
          title: "SSI Open Water Diver",
          description: "SSI's entry-level autonomous diver certification.",
          priceCents: 47500,
          eLearningPriceCents: 19500,
          minimumCertificationLevel: null,
        },
        {
          shopId,
          agency: "ssi",
          title: "Advanced Adventurer",
          description: "Five guided specialty adventure dives.",
          priceCents: 39900,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Diver Stress & Rescue",
          description: "Recognize stress and respond to diver emergencies.",
          priceCents: 49900,
          eLearningPriceCents: 22500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Nitrox 40",
          description: "Use nitrox mixes up to 40 percent oxygen.",
          priceCents: 18500,
          eLearningPriceCents: 14000,
          minimumCertificationLevel: "open_water" as const,
        },
        // The public page lives at /courses/<slug>; the catalog is the only place
        // slugs are minted, so the seed mints them the same way an import does.
      ].map((course) => ({ ...course, slug: courseSlug(course.title) })),
    )
    .returning();
  const discoverCourse = courseRows.find((course) => course.title === "Discover Scuba Diving");
  if (!discoverCourse) throw new Error("seed: DSD course missing");

  // The demo shop starts where a real shop does: every course pre-filled with
  // DiveDay's default page copy. That default content is the shop's starting
  // point — it edits from there. Open Water is the one a visitor is most
  // likely to open, so it is the most complete.
  for (const template of COURSE_TEMPLATES) {
    const course = courseRows.find((row) => row.title === template.title);
    if (!course) continue;
    await db.update(courses).set(template.content).where(eq(courses.id, course.id));
  }
  const openWaterCourse = courseRows.find((course) => course.title === "Open Water Diver");
  const courseIdByTitle = new Map(courseRows.map((course) => [course.title, course.id]));

  // Two certification paths, because a shop that has built only one never
  // discovers that the builder reorders and that a course can sit on more than
  // one path. The ladder is what a diver asks for at the counter; the wreck
  // path is the one the shop actually sells in the Keys.
  const seededPaths: Array<{ title: string; summary: string; steps: string[] }> = [
    {
      title: "From first breath to Rescue Diver",
      // i18n-exempt: shop-editable seed content (course path summary), not app UI copy
      summary: "A first taste, then the three cards, in the order we teach them.",
      steps: [
        "Discover Scuba Diving",
        "Open Water Diver",
        "Advanced Open Water Diver",
        "Rescue Diver",
      ],
    },
    {
      title: "Wreck diver",
      // i18n-exempt: shop-editable seed content (course path summary), not app UI copy
      summary: "Everything the Spiegel Grove and the Duane ask of you.",
      steps: ["Advanced Open Water Diver", "Nitrox Diver", "Deep Diver", "Wreck Diver"],
    },
  ];
  for (const path of seededPaths) {
    await insertCoursePath(db, {
      shopId,
      title: path.title,
      summary: path.summary,
      steps: path.steps
        .map((title) => courseIdByTitle.get(title))
        .filter((id): id is string => Boolean(id))
        .map((courseId) => ({ courseId })),
    });
  }

  const [existingMolassesTemplate] = await db
    .select()
    .from(globalDiveSites)
    .where(eq(globalDiveSites.slug, "molasses-reef"))
    .limit(1);
  let molassesTemplate = existingMolassesTemplate;
  if (!molassesTemplate) {
    [molassesTemplate] = await db
      .insert(globalDiveSites)
      .values({ slug: "molasses-reef", currentVersion: 2 })
      .returning();
    if (!molassesTemplate) throw new Error("seed: common-site template missing");
    await db.insert(globalDiveSiteVersions).values([
      {
        globalDiveSiteId: molassesTemplate.id,
        version: 1,
        briefing: {
          name: "Molasses Reef",
          locationName: "Key Largo National Marine Sanctuary",
          forecastLatitude: 25.0117,
          forecastLongitude: -80.3764,
          description: "A bright outer-reef classic with a relaxed profile.",
          marineLife: "Parrotfish · angelfish · southern stingrays",
        },
      },
      {
        globalDiveSiteId: molassesTemplate.id,
        version: 2,
        briefing: {
          name: "Molasses Reef",
          locationName: "Key Largo National Marine Sanctuary",
          forecastLatitude: 25.0117,
          forecastLongitude: -80.3764,
          description:
            "A bright outer-reef classic with a relaxed profile and plenty of room to explore.",
          marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
          marineLifeDescription:
            "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels.",
          difficulty: "beginner",
          depthRange: "6–12 m",
          maxDepthMeters: 12,
          currentNote: "Usually gentle; the crew confirms the final plan.",
          divePlan:
            "Follow the coral ridge, pause at the sand channels, then drift back along the shallow garden.",
          landmarks: ["Molasses Reef Light", "Historic ship's winch", "Spanish anchor"],
          imageUrls: [
            commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
            commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
            commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
          ],
        },
      },
    ]);
  }

  const siteRows = await db
    .insert(diveSites)
    .values([
      {
        shopId,
        sourceTemplateId: molassesTemplate.id,
        sourceTemplateVersion: 1,
        name: "Molasses Reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0117,
        forecastLongitude: -80.3764,
        description:
          "A bright outer-reef classic with a relaxed profile and plenty of room to explore.",
        marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
        marineLifeDescription:
          "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels.",
        difficulty: "beginner",
        depthRange: "6–12 m",
        maxDepthMeters: 12,
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Follow the coral ridge, pause at the sand channels, then drift back along the shallow garden.",
        landmarks: ["Molasses Reef Light", "Historic ship's winch", "Spanish anchor"],
        imageUrls: [
          commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
          commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
          commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
        ],
      },
      {
        shopId,
        name: "Spiegel Grove",
        locationName: "Key Largo, Florida",
        // The glossary's canonical gate: a deep wreck dived externally needs
        // AOW + Deep. (Wreck specialty is for penetration, not the whole site.)
        // Every trip that visits inherits at least this (readiness composes it).
        minimumCertificationLevel: "advanced_open_water" as const,
        requiredSpecialties: ["deep"] as DiveSpecialty[],
        forecastLatitude: 25.0789,
        forecastLongitude: -80.2186,
        description:
          "A deliberately sunk former Navy ship with dramatic structure and blue-water scale.",
        marineLife: "Goliath grouper · barracuda · jacks · soft coral",
        marineLifeDescription:
          "Expect big silhouettes, moving schools, and changing light along the exterior decks.",
        difficulty: "advanced",
        depthRange: "18–40 m",
        maxDepthMeters: 40,
        currentNote: "Open-water current can be strong; the crew confirms the line plan.",
        divePlan:
          "Descend together on the mooring line, tour the exterior flight deck and well deck, then return to the ascent line with reserve gas.",
        landmarks: ["Flight deck and cranes", "Well deck"],
        imageUrls: [
          commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
          commonsImage("AtlanticGoliathGrouper.jpg"),
        ],
      },
      {
        shopId,
        name: "Christ of the Abyss",
        locationName: "John Pennekamp Coral Reef State Park",
        forecastLatitude: 25.1292,
        forecastLongitude: -80.4011,
        description: "A shallow, iconic statue site that rewards an unhurried reef dive.",
        marineLife: "Sergeant majors · blue tangs · French angelfish · coral gardens",
        marineLifeDescription:
          "A gentle route with lots to notice near the reef and plenty of light for photos.",
        difficulty: "beginner",
        depthRange: "5–8 m",
        maxDepthMeters: 8,
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Arc from the mooring through the bright sand channels, pause at the statue, then return across the shallow coral garden.",
        landmarks: ["Christ of the Abyss", "Dry Rocks sand channels"],
        imageUrls: [
          commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
          commonsImage("Blue Tang Pickles 20080310.jpg"),
          commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
        ],
      },
      {
        shopId,
        name: "Benwood Wreck",
        locationName: "Key Largo, Florida",
        forecastLatitude: 25.0561,
        forecastLongitude: -80.3222,
        description: "A broken freighter lying in shallow sand — wreck scale without wreck depth.",
        marineLife: "Sergeant majors · glassy sweepers · moray eels · yellowtail snapper",
        marineLifeDescription:
          "The hull is a fish apartment block: look into every gap and something is home.",
        difficulty: "intermediate",
        depthRange: "8–15 m",
        maxDepthMeters: 15,
        currentNote: "Mild, but the site sits in open water — the crew calls the drop.",
        divePlan:
          "Swim the length of the hull from bow to stern along the sand, then return over the plates at 9 meters.",
        landmarks: ["Bow section", "Collapsed midships plates"],
        imageUrls: [
          commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
          commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
        ],
      },
      {
        shopId,
        name: "French Reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0333,
        forecastLongitude: -80.3494,
        description: "Swim-throughs, ledges, and overhangs on a shallow spur-and-groove reef.",
        marineLife: "Nurse sharks · green morays · parrotfish · barracuda",
        marineLifeDescription:
          "The overhangs hide sleeping nurse sharks; check the ceilings, not just the sand.",
        difficulty: "beginner",
        depthRange: "6–14 m",
        maxDepthMeters: 14,
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Drop on the mooring, work the ledges and swim-throughs into the current, then drift back over the coral heads.",
        landmarks: ["Christmas Tree Cave", "Hourglass Cave", "White Sand Bottom Cave"],
        imageUrls: [
          commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
          commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
        ],
      },
      {
        shopId,
        name: "USCGC Duane",
        locationName: "Key Largo, Florida",
        // A second deep advanced wreck, gated the same way Spiegel Grove is.
        minimumCertificationLevel: "advanced_open_water" as const,
        requiredSpecialties: ["deep"] as DiveSpecialty[],
        forecastLatitude: 24.9989,
        forecastLongitude: -80.3903,
        description:
          "A decommissioned Coast Guard cutter sunk upright, with a mast and gun mounts still intact.",
        marineLife: "Goliath grouper · barracuda · amberjack · schooling grunts",
        marineLifeDescription:
          "A resident goliath grouper often holds near the wheelhouse; look into the blue for jacks working the current.",
        difficulty: "advanced",
        depthRange: "15–37 m",
        maxDepthMeters: 37,
        currentNote: "Can run strong on the surface; the crew calls the line and the drop.",
        divePlan:
          "Descend the mooring to the deck, tour the superstructure and gun mounts, then ascend on reserve gas with a safety stop.",
        landmarks: ["Wheelhouse", "Forward gun mount", "Crow's nest"],
        imageUrls: [
          commonsImage("AtlanticGoliathGrouper.jpg"),
          commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
        ],
      },
      {
        shopId,
        name: "Pickles Reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 24.9928,
        forecastLongitude: -80.4092,
        description: "A shallow spur-and-groove reef named for its fossilized-barrel coral heads.",
        marineLife: "Blue tangs · stoplight parrotfish · French angelfish · sergeant majors",
        marineLifeDescription:
          "Grazing parrotfish work the coral heads all day; blue tangs move through in loose, easy groups.",
        difficulty: "beginner",
        depthRange: "5–12 m",
        maxDepthMeters: 12,
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Drift the coral ridge from the mooring, pause over the barrel-shaped heads, then loop back over the sand.",
        landmarks: ["Barrel coral heads", "Anchor chain remnant"],
        imageUrls: [
          commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
          commonsImage("Blue Tang Pickles 20080310.jpg"),
          commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
        ],
      },
    ])
    .returning();
  const siteByName = new Map(siteRows.map((site) => [site.name, site]));
  const molasses = siteByName.get("Molasses Reef");
  if (molasses) {
    await db.insert(diveSiteCreatures).values([
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Stoplight parrotfish",
        kind: "fish",
        imageUrl: commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
        description: "A bright reef grazer with a beak-like mouth.",
        preparationTip: "Move slowly near coral heads and let the colour find you.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Elkhorn coral",
        kind: "coral",
        imageUrl: commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
        description: "Branching coral that makes a remarkable shallow reef silhouette.",
        preparationTip: "Practice neutral buoyancy; never touch or brace on coral.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Southern stingray",
        kind: "ray",
        imageUrl: commonsImage("Dasyatis americana NOAA.jpg"),
        description: "Often seen gliding over the sand channels.",
        preparationTip: "Give rays space and watch from the side, not above.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Blue tang",
        kind: "fish",
        imageUrl: commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
        description: "Electric-blue reef fish that often travel in loose groups.",
        preparationTip: "Scan just above the reef for small groups moving together.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "French angelfish",
        kind: "fish",
        imageUrl: commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
        description: "A tall, dark fish edged with tiny flashes of yellow.",
        preparationTip: "Look beside tall sponges and coral faces where they feed.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Yellowtail snapper",
        kind: "schooling fish",
        imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
        description: "Silver schools marked by a bright yellow stripe and tail.",
        preparationTip: "Look into the blue beyond the reef instead of only looking down.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Goliath grouper",
        kind: "fish",
        imageUrl: commonsImage("AtlanticGoliathGrouper.jpg"),
        description: "Enormous and unbothered; usually parked under a ledge.",
        preparationTip: "Give it room and never block its way out from under an overhang.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Nurse shark",
        kind: "shark",
        imageUrl: commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
        description: "A broad, mellow bottom-resting shark with rounded fins.",
        preparationTip: "Check quiet ledges without crowding or blocking an animal's path.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Reef grouper & grunt",
        kind: "reef fish",
        imageUrl: commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
        description: "Chunky grouper often share the reef with striped grunts.",
        preparationTip: "Pause beside coral overhangs and let hidden fish emerge.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Grooved brain coral",
        kind: "coral",
        imageUrl: commonsImage("Brain coral 2 Molasses Reef 20080309.jpg"),
        description: "Rounded coral patterned with maze-like ridges and valleys.",
        preparationTip: "Notice the pattern while keeping fins and hands safely clear.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Finger sponge",
        kind: "sponge",
        imageUrl: commonsImage("Sponge 06 Molasses Reef 20230714.jpg"),
        description: "Bright tubular sponges that add colour and height to the reef.",
        preparationTip: "Look between coral heads for shapes that do not sway like plants.",
      },
    ]);
    await db.insert(diveSiteMoments).values({
      shopId,
      diveSiteId: molasses.id,
      caption: "A quiet moment watching a ray disappear into blue water.",
      imageUrl: commonsImage("Dasyatis americana NOAA.jpg"),
      isPublished: true,
    });
  }

  // A site with an empty field guide reads as a site the shop does not know.
  // Both of the other seeded sites get one, written to their own character:
  // the wreck is about scale and silhouettes, the statue about a slow shallow
  // reef you can spend an hour on.
  const spiegel = siteByName.get("Spiegel Grove");
  const christ = siteByName.get("Christ of the Abyss");
  const benwood = siteByName.get("Benwood Wreck");
  const french = siteByName.get("French Reef");
  const duane = siteByName.get("USCGC Duane");
  const pickles = siteByName.get("Pickles Reef");
  const laterCreatures = [
    ...(benwood
      ? [
          {
            diveSiteId: benwood.id,
            name: "Glassy sweeper",
            kind: "schooling fish",
            imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
            description: "Copper-colored clouds that fill the shaded spaces inside the hull.",
            preparationTip: "Stay outside the plates and let the school reform around you.",
          },
          {
            diveSiteId: benwood.id,
            name: "Reef grouper",
            kind: "fish",
            imageUrl: commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
            description: "Holds a favorite gap in the wreckage and watches you go past.",
            preparationTip: "Approach slowly and from the side; a crowded fish just leaves.",
          },
        ]
      : []),
    ...(french
      ? [
          {
            diveSiteId: french.id,
            name: "Nurse shark",
            kind: "shark",
            imageUrl: commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
            description: "Often asleep under the ledges, which is where divers miss them.",
            preparationTip: "Look up into the overhangs, and never block the way out of one.",
          },
          {
            diveSiteId: french.id,
            name: "Stoplight parrotfish",
            kind: "fish",
            imageUrl: commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
            description: "You will hear them grazing the coral before you find them.",
            preparationTip: "Hold still near a coral head and follow the crunching sound.",
          },
        ]
      : []),
    ...(spiegel
      ? [
          {
            diveSiteId: spiegel.id,
            name: "Goliath grouper",
            kind: "fish",
            imageUrl: commonsImage("AtlanticGoliathGrouper.jpg"),
            description: "A car-sized grouper that holds station in the ship's shadows.",
            preparationTip: "Keep your distance and your buoyancy; never corner one in a doorway.",
          },
          {
            diveSiteId: spiegel.id,
            name: "Yellowtail snapper",
            kind: "schooling fish",
            imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
            description: "Silver schools that hang above the deck, facing into the current.",
            preparationTip: "Look out into the blue, not only down at the hull.",
          },
          {
            diveSiteId: spiegel.id,
            name: "Remora",
            kind: "fish",
            imageUrl: commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
            description: "Riders that detach and circle when their host moves off.",
            preparationTip: "If one takes an interest in you, keep swimming — it loses interest.",
          },
        ]
      : []),
    ...(christ
      ? [
          {
            diveSiteId: christ.id,
            name: "Sergeant major",
            kind: "fish",
            imageUrl: commonsImage("Blue Tang Pickles 20080310.jpg"),
            description: "Small striped fish that guard purple egg patches on the statue's base.",
            preparationTip: "A guarding male will bump your mask; back off rather than push in.",
          },
          {
            diveSiteId: christ.id,
            name: "French angelfish",
            kind: "fish",
            imageUrl: commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
            description: "Usually in pairs, moving unhurried between coral heads.",
            preparationTip: "Stay still for a moment and the pair will often come to you.",
          },
          {
            diveSiteId: christ.id,
            name: "Elkhorn coral",
            kind: "coral",
            imageUrl: commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
            description: "Shallow branching coral that catches the light on the way back.",
            preparationTip: "This is the shallowest part of the dive — watch your fins above it.",
          },
        ]
      : []),
    ...(duane
      ? [
          {
            diveSiteId: duane.id,
            name: "Goliath grouper",
            kind: "fish",
            imageUrl: commonsImage("AtlanticGoliathGrouper.jpg"),
            description: "A resident that holds near the wheelhouse and rarely moves for divers.",
            preparationTip: "Approach along the deck, not from above — it reads that as a threat.",
          },
          {
            diveSiteId: duane.id,
            name: "Amberjack",
            kind: "schooling fish",
            imageUrl: commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
            description: "Fast-moving schools that patrol the blue water off the wreck.",
            preparationTip: "Look up and out past the structure, not only at the hull.",
          },
        ]
      : []),
    ...(pickles
      ? [
          {
            diveSiteId: pickles.id,
            name: "Blue tang",
            kind: "fish",
            imageUrl: commonsImage("Blue Tang Pickles 20080310.jpg"),
            description: "Loose, easy groups that move across the coral heads all day.",
            preparationTip: "Hover rather than chase — the school circles back on its own.",
          },
          {
            diveSiteId: pickles.id,
            name: "Stoplight parrotfish",
            kind: "fish",
            imageUrl: commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
            description: "The reef's namesake grazer, working the barrel-shaped coral heads.",
            preparationTip: "Listen for the crunch of a beak on coral before you spot the fish.",
          },
        ]
      : []),
  ];
  if (laterCreatures.length > 0) {
    await db.insert(diveSiteCreatures).values(laterCreatures.map((row) => ({ shopId, ...row })));
  }
  const laterMoments = [
    spiegel
      ? {
          diveSiteId: spiegel.id,
          caption: "The moment the flight deck resolves out of the blue on the way down.",
          imageUrl: commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
          isPublished: true,
        }
      : null,
    christ
      ? {
          diveSiteId: christ.id,
          caption: "Eight meters down, hands up, sunlight all the way to the sand.",
          imageUrl: commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
          isPublished: true,
        }
      : null,
  ].filter((row) => row !== null);
  if (laterMoments.length > 0) {
    await db.insert(diveSiteMoments).values(laterMoments.map((row) => ({ shopId, ...row })));
  }

  /**
   * A dated session for a catalog course, or nothing at all when this shop does
   * not carry that title. Spread into the trips list so a missing course drops
   * its session quietly instead of throwing the whole seed.
   */
  function courseSession(
    courseTitle: string,
    trip: {
      title: string;
      description: string;
      startsAt: Date;
      endsAt: Date;
      capacity: number;
      plannedDives?: number;
    },
  ) {
    const courseId = courseIdByTitle.get(courseTitle);
    return courseId ? [{ shopId, courseId, ...trip }] : [];
  }

  const todaySailStart = demoTodayDepartureStart();
  const tripRows = await db
    .insert(trips)
    .values([
      {
        shopId,
        diveSiteId: siteByName.get("Molasses Reef")?.id,
        title: "Two-Tank Reef — Molasses & French",
        // Time-neutral copy: this trip sails at whatever hour keeps it on
        // today's board, so "morning" would read as a bug after lunch.
        description: "Double dip on the outer reef. All levels, OW required.",
        startsAt: todaySailStart, // sails today, so Today always has a board
        endsAt: new Date(todaySailStart.getTime() + 3.5 * 60 * 60 * 1000),
        capacity: 12,
      },
      {
        shopId,
        title: "Night Dive — City of Washington",
        description: "Torches, tarpon, and bioluminescence. Night specialty required.",
        // A twilight double: depart ~7:30 PM Eastern, dive 1 at dusk (matching
        // its "Wreck site at dusk" plan), dive 2 in full dark, 3.5 h dock to
        // dock — two night dives plus a surface interval don't fit in less.
        startsAt: at(2, 23, 30),
        endsAt: at(3, 3, 0),
        capacity: 8,
      },
      {
        shopId,
        diveSiteId: siteByName.get("Spiegel Grove")?.id,
        title: "Wreck Trip — Spiegel Grove",
        description: "The big one. AOW + Deep + nitrox required.",
        startsAt: at(5, 12, 0),
        endsAt: at(5, 16, 0),
        capacity: 10,
      },
      {
        shopId,
        diveSiteId: siteByName.get("Christ of the Abyss")?.id,
        title: "Two-Tank Reef — Christ of the Abyss",
        description: "Classic shallow sites, great for refreshers and new OW divers.",
        startsAt: at(7, 11, 30),
        endsAt: at(7, 15, 0),
        capacity: 12,
      },
      {
        shopId,
        courseId: discoverCourse.id,
        title: "Discover Scuba — Pool & Reef",
        description: "A small, instructor-led first breath underwater. No C-card required.",
        startsAt: at(4, 14, 0),
        endsAt: at(4, 17, 0),
        capacity: 4,
      },
      // The course page is only half a demo without a date to book: this is the
      // session its "See dates" button lands on.
      ...(openWaterCourse
        ? [
            {
              shopId,
              courseId: openWaterCourse.id,
              title: "Open Water Diver — three-day course",
              description: "Certification course over three days. No experience required.",
              startsAt: at(9, 12, 0),
              endsAt: at(11, 21, 0),
              // 5 students to one instructor: a realistic class, and it keeps
              // this session's "N spots left" distinct from every other seeded
              // trip's, which e2e assertions match on by text.
              capacity: 5,
            },
          ]
        : []),
      // A working board is not four boats: these fill out the fortnight so the
      // schedule, the dive-site pages, and the course catalog all have
      // something behind them. Every one leaves a different number of spots —
      // "N spots left" is the string e2e matches trips by, and two trips
      // showing the same count make that assertion ambiguous.
      {
        shopId,
        diveSiteId: benwood?.id,
        title: "Two-Tank Reef — Benwood & Elbow",
        description: "Shallow wreck first, coral heads second. A good day-two boat.",
        startsAt: at(3, 11, 30),
        endsAt: at(3, 15, 0),
        capacity: 12,
      },
      {
        shopId,
        diveSiteId: french?.id,
        title: "Afternoon Two-Tank — French Reef",
        description: "Swim-throughs and ledges, with the light coming in low on the second tank.",
        startsAt: at(6, 17, 0),
        endsAt: at(6, 21, 0),
        capacity: 10,
      },
      ...courseSession("Nitrox Diver", {
        title: "Nitrox Diver — classroom & two dives",
        description: "Analyze your own cylinder, then use the procedures on two reef dives.",
        startsAt: at(8, 12, 0),
        endsAt: at(8, 20, 0),
        capacity: 6,
      }),
      ...courseSession("Peak Performance Buoyancy", {
        title: "Peak Performance Buoyancy — one day",
        description: "A real weight check, then two dives spent hovering.",
        startsAt: at(13, 12, 0),
        endsAt: at(13, 19, 0),
        capacity: 4,
      }),
      ...courseSession("Night Diver", {
        title: "Night Diver — three evenings",
        description: "Dusk, dark, and navigation, over three consecutive evenings.",
        startsAt: at(15, 21, 0),
        endsAt: at(18, 1, 30),
        capacity: 6,
        plannedDives: 3,
      }),
      ...courseSession("Deep Diver", {
        title: "Deep Diver — Spiegel Grove & the wall",
        description: "Four dives building to 40 meters, with gas planning that keeps up.",
        startsAt: at(20, 12, 0),
        endsAt: at(21, 20, 0),
        capacity: 6,
        plannedDives: 4,
      }),
    ])
    .returning();

  await db.insert(tripScheduleDays).values(
    tripRows.flatMap((trip) => {
      if (trip.courseId === openWaterCourse?.id) {
        return [
          { tripId: trip.id, dayNumber: 1, startsAt: at(9, 12), endsAt: at(9, 18) },
          { tripId: trip.id, dayNumber: 2, startsAt: at(10, 10), endsAt: at(10, 18) },
          { tripId: trip.id, dayNumber: 3, startsAt: at(11, 13), endsAt: at(11, 21) },
        ];
      }
      return [{ tripId: trip.id, dayNumber: 1, startsAt: trip.startsAt, endsAt: trip.endsAt }];
    }),
  );

  /**
   * What each tank actually is. "Dive 1 · Dive 2" tells a diver nothing they
   * could not have guessed; these are the words the crew uses at the briefing,
   * which is what makes a trip page worth opening the night before.
   *
   * A trip with no entry here still gets its dives — just unnamed, the way a
   * charter looks before anyone has written the plan.
   */
  const divePlans: Record<string, Array<{ title: string; site?: string; description: string }>> = {
    "Two-Tank Reef — Molasses & French": [
      {
        title: "Molasses Reef",
        site: "Molasses Reef",
        description: "A relaxed sweep along the outer reef. Look for rays in the sand channels.",
      },
      {
        title: "French Reef",
        site: "French Reef",
        description:
          "French Reef is the second tank; the crew confirms the exact mooring at the dock.",
      },
    ],
    "Two-Tank Reef — Benwood & Elbow": [
      {
        title: "Benwood Wreck",
        site: "Benwood Wreck",
        description: "Bow to stern along the sand, then back over the plates. Watch the ceilings.",
      },
      {
        title: "Elbow Reef",
        description:
          "Shallow coral heads and a wreck-strewn bottom; a long, easy second tank on a full tank of air.",
      },
    ],
    "Afternoon Two-Tank — French Reef": [
      {
        title: "French Reef swim-throughs",
        site: "French Reef",
        description: "Christmas Tree Cave and the ledges, into the current and drifting back.",
      },
      {
        title: "White Sand Bottom Cave",
        site: "French Reef",
        description: "The low sun gets into the overhangs — the best light of the day is here.",
      },
    ],
    "Wreck Trip — Spiegel Grove": [
      {
        title: "Flight deck and cranes",
        site: "Spiegel Grove",
        description:
          "Down the mooring together, a tour of the exterior, and back to the line with reserve gas.",
      },
      {
        title: "Well deck",
        site: "Spiegel Grove",
        description: "Shallower and slower after the surface interval, staying outside the hull.",
      },
    ],
    "Two-Tank Reef — Christ of the Abyss": [
      {
        title: "Christ of the Abyss",
        site: "Christ of the Abyss",
        description: "The statue first, before the other boats arrive, then the sand channels.",
      },
      {
        title: "Dry Rocks coral garden",
        site: "Christ of the Abyss",
        description: "A shallow, unhurried loop — the tank most refresher divers remember.",
      },
    ],
    "Night Dive — City of Washington": [
      {
        title: "Wreck site at dusk",
        description: "In the water before the light goes, so the descent is on a familiar bottom.",
      },
      {
        title: "Full dark",
        description: "Torches off for a minute at the safety stop, for the bioluminescence.",
      },
    ],
  };

  const tripDiveRows = tripRows.flatMap((trip) => {
    const plan = divePlans[trip.title] ?? [];
    return Array.from({ length: trip.plannedDives }, (_, index) => {
      const dive = plan[index];
      return {
        tripId: trip.id,
        diveNumber: index + 1,
        title: dive?.title ?? null,
        diveSiteId: dive?.site
          ? (siteByName.get(dive.site)?.id ?? null)
          : index === 0
            ? (trip.diveSiteId ?? null)
            : null,
        description: dive?.description ?? null,
      };
    });
  });
  if (tripDiveRows.length > 0) await db.insert(tripDives).values(tripDiveRows);

  await db.insert(tripRequirements).values(
    tripRows.map((trip) => {
      // The night dive has no site of its own, so its Night gate is trip-level;
      // night diving needs the Night specialty, not a higher level. The wreck
      // trip inherits AOW + Deep from the Spiegel Grove site and adds a
      // trip-level nitrox requirement (deep wreck bottom time).
      const isNight = trip.title.startsWith("Night Dive");
      const isWreck = trip.title.startsWith("Wreck Trip");
      // Same rule createTrip applies: a course session inherits its catalog
      // baseline verbatim, null included — an entry-level class is the one
      // place an uncertified diver belongs on a boat. Everything else takes the
      // shop's default Open Water gate.
      const course = trip.courseId
        ? courseRows.find((entry) => entry.id === trip.courseId)
        : undefined;
      return {
        tripId: trip.id,
        shopId,
        requiresWaiver: true,
        minimumCertificationLevel: course
          ? course.minimumCertificationLevel
          : ("open_water" as const),
        requiredSpecialties: (isNight ? ["night"] : []) as DiveSpecialty[],
        requiresNitrox: isWreck,
        // The premium wreck charter is paid up front; the reef trips are not.
        requiresPayment: isWreck,
      };
    }),
  );

  const discoverSession = tripRows.find((trip) => trip.courseId === discoverCourse.id);
  if (!discoverSession) throw new Error("seed: DSD session missing");
  // Every course session needs an instructor before it can take a booking. The
  // charters get a captain and a divemaster, because a boat with an empty crew
  // list is the one thing no dive shop has ever had.
  const crewByRole = new Map(
    (
      await db
        .select({ id: people.id, role: personRoles.role })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(eq(people.shopId, shopId))
    ).map((row) => [row.role, row.id]),
  );
  const captainId = crewByRole.get("captain");
  const divemasterId = crewByRole.get("divemaster");
  await db.insert(tripAssignments).values(
    tripRows.flatMap((trip) => {
      if (trip.courseId) return [{ tripId: trip.id, personId: instructor.id }];
      return [
        ...(captainId ? [{ tripId: trip.id, personId: captainId }] : []),
        ...(divemasterId ? [{ tripId: trip.id, personId: divemasterId }] : []),
      ];
    }),
  );

  // Conditions are a live reading, not a description: the boat that sails today
  // has this morning's numbers, the next two have yesterday's, and everything
  // further out is honestly blank because nobody has looked yet.
  const conditions: Array<[number, Record<string, unknown>]> = [
    [
      0,
      {
        conditionsSummary:
          "A calm morning is expected; the crew will confirm the final call at the dock.",
        waterTemperatureC: 27,
        visibilityMeters: 18,
        surfaceConditions: "Light east breeze · gentle chop",
      },
    ],
    [
      1,
      {
        conditionsSummary:
          "Warm and still after dark. Bring a light layer for the surface interval.",
        waterTemperatureC: 28,
        visibilityMeters: 15,
        surfaceConditions: "Glassy · no swell forecast",
      },
    ],
    [
      2,
      {
        conditionsSummary:
          "Open water, so the call is made at the dock. Expect current on the line.",
        waterTemperatureC: 26,
        visibilityMeters: 24,
        surfaceConditions: "Moderate southeast wind · 1 m swell",
      },
    ],
  ];
  for (const [index, values] of conditions) {
    const trip = tripRows[index];
    if (!trip) continue;
    await db
      .update(trips)
      .set({ ...values, conditionsUpdatedAt: nowDate() })
      .where(eq(trips.id, trip.id));
  }

  // Booking spread: busy reef trip, quiet night dive, sold-out wreck, fresh listing.
  const [reef, night, wreck] = tripRows;
  if (!reef || !night || !wreck) throw new Error("seed: failed to insert demo trips");

  /**
   * Later sailings carry their own regulars — divers 10 and up, never the ten
   * who crew today's boat. Today's roster and its readiness counts are asserted
   * exactly; a name added to it changes what the departure board says.
   *
   * The remaining-seat counts these produce are load-bearing too. "N spots
   * left" is how e2e picks a trip out of the schedule, so no seeded trip may
   * leave six seats (a spec creates its own six-seat boat), only the reef trip
   * may leave three, and only the wreck charter may read Full.
   */
  const laterRosters: Array<[string, number[]]> = [
    ["Two-Tank Reef — Benwood & Elbow", [10, 11, 12]],
    ["Afternoon Two-Tank — French Reef", [13, 14, 15]],
    ["Nitrox Diver — classroom & two dives", [16, 17]],
    ["Night Diver — three evenings", [13]],
    ["Deep Diver — Spiegel Grove & the wall", [17]],
  ];
  const bookingRows = [
    // The first reef booking is pinned (canonical demo only) so a recap link can
    // be minted deterministically for the visual tests.
    ...customers.slice(0, 9).map((c, index) => ({
      tripId: reef.id,
      personId: c.id,
      ...(index === 0 && pinRecapBooking ? { id: DEMO_RECAP_BOOKING_ID } : {}),
    })),
    ...customers.slice(4, 7).map((c) => ({ tripId: night.id, personId: c.id })),
    ...customers.slice(0, 10).map((c) => ({ tripId: wreck.id, personId: c.id })),
    ...laterRosters.flatMap(([title, indexes]) => {
      const trip = tripRows.find((row) => row.title === title);
      if (!trip) return [];
      return indexes
        .map((index) => customers[index])
        .filter((person) => person !== undefined)
        .map((person) => ({ tripId: trip.id, personId: person.id }));
    }),
  ];
  const bookingRows_ = await db
    .insert(bookings)
    .values(
      bookingRows.map((row) => ({
        shopId,
        status: "booked" as const,
        createdAt: nextCreatedAt(),
        ...row,
      })),
    )
    .returning();

  // H-13 demo: one night-trip seat came in through a shared inbox under a
  // different name than the person already on file for that email, so it carries
  // the identity-unconfirmed flag. The roster shows the fail-closed "Confirm
  // identity" gate until staff vouch for it — the diver can't board on the
  // matched person's evidence. Reuses the booking's own createdAt so nothing new
  // is stamped against the clock. The diver is already blocked (no Night
  // specialty), so this adds a blocker rather than flipping a ready seat.
  const nightIdentityBooking = bookingRows_.find(
    (b) => b.tripId === night.id && b.personId === customers[4]?.id,
  );
  if (nightIdentityBooking) {
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nightIdentityBooking.createdAt })
      .where(eq(bookings.id, nightIdentityBooking.id));
  }

  // Payment demo, spread across the boats a visitor actually looks at — not
  // just the pay-to-board wreck charter. Reef and Night don't require payment
  // to board (requiresPayment is wreck-only), so these rows never change who
  // can board; they exist so Reports shows real revenue for the current month
  // instead of $0, including on a freshly minted "try the demo" shop, which
  // never runs seedHistory's back-fill.
  const wreckBookings = bookingRows_.filter((b) => b.tripId === wreck.id);
  const reefBookings = bookingRows_.filter((b) => b.tripId === reef.id);
  const nightBookings = bookingRows_.filter((b) => b.tripId === night.id);
  const findBooking = (rows: typeof bookingRows_, personIndex: number) =>
    rows.find((b) => b.personId === customers[personIndex]?.id);
  const bookingByTripTitle = (tripTitle: string, personIndex: number) => {
    const trip = tripRows.find((row) => row.title === tripTitle);
    if (!trip) return undefined;
    return findBooking(
      bookingRows_.filter((b) => b.tripId === trip.id),
      personIndex,
    );
  };
  const paidBooking = findBooking(wreckBookings, 1);
  const depositBooking = findBooking(wreckBookings, 0);

  const paymentPlan: Array<{
    booking: (typeof bookingRows_)[number] | undefined;
    status: "paid" | "deposit_paid";
    amountCents: number;
  }> = [
    // Wreck: a solid majority paid or on deposit, a few still owing 5 days out.
    { booking: paidBooking, status: "paid", amountCents: 18_000 },
    { booking: depositBooking, status: "deposit_paid", amountCents: 6_000 },
    { booking: findBooking(wreckBookings, 2), status: "paid", amountCents: 18_000 },
    { booking: findBooking(wreckBookings, 5), status: "paid", amountCents: 18_000 },
    { booking: findBooking(wreckBookings, 6), status: "deposit_paid", amountCents: 6_000 },
    // Reef: today's busy boat, paid ahead of the dock like a real morning.
    { booking: findBooking(reefBookings, 1), status: "paid", amountCents: 12_000 },
    { booking: findBooking(reefBookings, 2), status: "paid", amountCents: 12_000 },
    { booking: findBooking(reefBookings, 3), status: "paid", amountCents: 12_000 },
    { booking: findBooking(reefBookings, 5), status: "deposit_paid", amountCents: 4_000 },
    { booking: findBooking(reefBookings, 6), status: "paid", amountCents: 12_000 },
    { booking: findBooking(reefBookings, 7), status: "paid", amountCents: 12_000 },
    // Night: quiet boat, still a couple of paid seats.
    { booking: findBooking(nightBookings, 5), status: "paid", amountCents: 9_500 },
    { booking: findBooking(nightBookings, 6), status: "deposit_paid", amountCents: 3_500 },
    // Later sailings this month.
    {
      booking: bookingByTripTitle("Two-Tank Reef — Benwood & Elbow", 10),
      status: "paid",
      amountCents: 12_000,
    },
    {
      booking: bookingByTripTitle("Two-Tank Reef — Benwood & Elbow", 11),
      status: "deposit_paid",
      amountCents: 4_000,
    },
    {
      booking: bookingByTripTitle("Afternoon Two-Tank — French Reef", 13),
      status: "paid",
      amountCents: 11_000,
    },
    {
      booking: bookingByTripTitle("Afternoon Two-Tank — French Reef", 15),
      status: "deposit_paid",
      amountCents: 3_500,
    },
    {
      booking: bookingByTripTitle("Nitrox Diver — classroom & two dives", 16),
      status: "paid",
      amountCents: 19_500,
    },
    {
      booking: bookingByTripTitle("Night Diver — three evenings", 13),
      status: "paid",
      amountCents: 9_500,
    },
    {
      booking: bookingByTripTitle("Deep Diver — Spiegel Grove & the wall", 17),
      status: "deposit_paid",
      amountCents: 5_000,
    },
  ];
  const paymentSeed = paymentPlan
    .filter((row) => row.booking !== undefined)
    .map((row) => ({
      bookingId: (row.booking as (typeof bookingRows_)[number]).id,
      status: row.status,
      amountCents: row.amountCents,
    }));
  if (paymentSeed.length > 0) {
    await db
      .insert(bookingPayments)
      .values(paymentSeed.map((row) => ({ shopId, currency: "usd", ...row })));
  }

  // Post-trip recap demo: a crew shout-out on the pinned reef trip and a couple
  // of diver photos on the pinned recap booking, so /recap/[token] shows the
  // shout-out block and the photo strip out of the box.
  await db
    .update(trips)
    .set({
      recapShoutout:
        "What a day on the water — glassy surface and a curious green turtle on the second tank. Thanks for diving with us, and tag Blue Mantis in your shots!",
    })
    .where(eq(trips.id, reef.id));
  // The first reef booking carries the recap photos. On the canonical demo this
  // is the pinned id; on a minted demo it's whatever random id that booking got.
  const recapBookingId = bookingRows_.find(
    (b) => b.tripId === reef.id && b.personId === customers[0]?.id,
  )?.id;
  if (!recapBookingId) throw new Error("seed: recap booking missing from reef roster");
  await db.insert(recapPhotos).values([
    {
      shopId,
      bookingId: recapBookingId,
      tripId: reef.id,
      imageUrl: commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
      caption: "French angelfish cruising the coral",
    },
    {
      shopId,
      bookingId: recapBookingId,
      tripId: reef.id,
      imageUrl: commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
      caption: "A whole squad of blue tangs",
    },
  ]);

  // A real booking never sits with zero waiver activity: the live
  // booking-creation flow issues a waiver request the instant a diver joins a
  // trip (issueWaiverOnJoin). The seed mirrors that so every upcoming booking
  // already has a waiver on file — except the reef trip's first-booked diver
  // (the pinned recap booking above), who stays genuinely unsent. That one
  // holdout is the shop's real-world straggler — a request that quietly never
  // went out — and it's what keeps the "click Send waiver" flows (staff UI,
  // e2e) demonstrable.
  //
  // Most divers fill out their waiver before the boat leaves — that's the
  // norm at a real front desk, not the exception — so the seed signs it for
  // the large majority of upcoming bookings. A signature is effective for the
  // *person*, not just the one booking (effectiveWaiverForBooking in
  // src/lib/waivers.ts reuses a diver's latest completed waiver across every
  // trip they're on), so today's reef roster (customers 1-8; customer[0]
  // Priya is the deliberate holdout above) gets signed too. That still leaves
  // today's boat with one diver flagged "Readiness needs attention" — a
  // realistic morning, not an empty one (see e2e/manifest.spec.ts and
  // e2e/check-in.spec.ts, both keyed on Priya specifically). Wreck and Night
  // stay genuinely mixed regardless: wreck also gates on AOW + Deep +
  // verified nitrox + payment, and night on the Night specialty, so signing a
  // waiver alone clears at most one wreck seat (customer[1], already fully
  // carded and paid) and never touches night's specialty gate.
  const waiverTemplate = await getCurrentWaiverTemplate(db, shopId);
  if (!waiverTemplate) throw new Error("seed: waiver template missing before upcoming waivers");
  const signedWaiverBookingIds = new Set(
    [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((index) => findBooking(reefBookings, index)?.id),
      findBooking(wreckBookings, 9)?.id,
      bookingByTripTitle("Two-Tank Reef — Benwood & Elbow", 10)?.id,
      bookingByTripTitle("Afternoon Two-Tank — French Reef", 13)?.id,
      bookingByTripTitle("Nitrox Diver — classroom & two dives", 16)?.id,
    ].filter((id): id is string => id !== undefined),
  );
  let upcomingWaiverToken = 0;
  const upcomingWaiverRows = bookingRows_
    .filter((booking) => booking.id !== recapBookingId)
    .map((booking) => {
      upcomingWaiverToken++;
      const createdAt = nextCreatedAt();
      const signed = signedWaiverBookingIds.has(booking.id);
      return {
        shopId,
        bookingId: booking.id,
        personId: booking.personId,
        templateId: waiverTemplate.id,
        templateTitle: waiverTemplate.title,
        templateVersion: waiverTemplate.version,
        templateBody: waiverTemplate.body,
        // Never a real bearer token (nobody is meant to sign these seeded
        // links), but unique per shop row so a fleet of minted demo shops
        // can never collide on the table's global tokenHash constraint.
        tokenHash: `seed-waiver-${shopId}-${upcomingWaiverToken}`,
        // Comfortably past every seeded upcoming trip (furthest is ~21 days
        // out) so a fresh demo never opens with an already-expired link.
        expiresAt: at(30, 12),
        createdAt,
        ...(signed
          ? {
              status: "completed" as const,
              signedName: "Signed on file",
              signatureMethod: "in_person" as const,
              consentedAt: createdAt,
              signedAt: createdAt,
              completedAt: createdAt,
            }
          : {}),
      };
    });
  if (upcomingWaiverRows.length > 0) await db.insert(waiverRecords).values(upcomingWaiverRows);

  await seedMoreTrips(db, shopId, {
    customers,
    siteByName,
    courseRows,
    instructorId: instructor.id,
    captainId,
    divemasterId,
    waiverTemplate,
  });

  // Two shop-wide promo codes, so the staff page and the diver-facing promo
  // box both have something real behind them. The Stripe ids are fabricated —
  // the demo never connects an account — the same convention the seeded orders
  // and tips already use.
  await db
    .insert(shopPromoCodes)
    .values([
      {
        shopId,
        code: "REEF10",
        description: "Standing returning-diver discount",
        discountPercent: 10,
        scope: "all" as const,
        status: "active" as const,
        stripeCouponId: "coupon_demo_reef10",
        stripePromotionCodeId: "promo_demo_reef10",
        createdAt: at(-30, 9),
      },
      {
        shopId,
        code: "OPENWATER25",
        description: "Course push — expired, kept as history",
        discountPercent: 25,
        scope: "courses" as const,
        status: "active" as const,
        maxRedemptions: 20,
        expiresAt: at(-1, 12),
        stripeCouponId: "coupon_demo_ow25",
        stripePromotionCodeId: "promo_demo_ow25",
        createdAt: at(-45, 9),
      },
    ])
    // Codes are shop config, not schedule data, so `resetDemoSchedule` leaves
    // them in place — re-seeding a reset shop must not collide on the
    // (shop, code) unique index.
    .onConflictDoNothing();

  await seedNitrox(db, shopId, customers, wreck, bookingRows_);
  await seedRentalFit(db, shopId, customers);
  await seedFrontDesk(db, shopId, customers, tripRows, bookingRows_, opts.history !== false);
  // The trailing quarter of already-sailed trips that gives owner reporting
  // something to report. Off for the lean unit-test template and for trial
  // shops (see callers); on for the demo shop and the e2e fleet.
  if (opts.history !== false) {
    await seedHistory(db, shopId, instructor.id);
  }
}

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
async function seedHistory(
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
    })),
  );

  // The bookable pool is exactly the history-only cohort (see above): large
  // enough that a wrapping slice fills even a 12-seat boat with distinct divers,
  // and never a diver who also sits on an upcoming trip.
  const pool = histPeople.map((person) => person.id);

  // Trips that already sailed. daysAgo is measured from the frozen clock, so the
  // spread lands in this month (month-to-date), last month, and the one before.
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
      hour: 12,
      title: "Two-Tank Reef — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 10,
    },
    {
      daysAgo: 4,
      hour: 12,
      title: "Wreck Trip — Duane",
      capacity: 10,
      priceCents: 18000,
      booked: 10,
    },
    {
      daysAgo: 8,
      hour: 12,
      title: "Two-Tank Reef — Benwood & Elbow",
      capacity: 12,
      priceCents: 13000,
      booked: 8,
    },
    {
      daysAgo: 12,
      hour: 23,
      title: "Night Dive — Molasses",
      capacity: 8,
      priceCents: 14000,
      booked: 6,
    },
    {
      daysAgo: 16,
      hour: 12,
      title: "Reef Refresh — Christ of the Abyss",
      capacity: 12,
      priceCents: 12500,
      booked: 11,
    },
    {
      daysAgo: 19,
      hour: 12,
      title: "Two-Tank Reef — French & Pickles",
      capacity: 10,
      priceCents: 13000,
      booked: 7,
    },
    {
      daysAgo: 25,
      hour: 12,
      title: "Wreck Trip — Spiegel Grove",
      capacity: 10,
      priceCents: 18000,
      booked: 9,
    },
    {
      daysAgo: 29,
      hour: 12,
      title: "Two-Tank Reef — Molasses",
      capacity: 12,
      priceCents: 13000,
      booked: 12,
    },
    {
      daysAgo: 33,
      hour: 16,
      title: "Afternoon Two-Tank — French Reef",
      capacity: 10,
      priceCents: 13000,
      booked: 8,
    },
    {
      daysAgo: 38,
      hour: 23,
      title: "Night Dive — City of Washington",
      capacity: 8,
      priceCents: 14000,
      booked: 7,
    },
    {
      daysAgo: 43,
      hour: 12,
      title: "Two-Tank Reef — Benwood",
      capacity: 12,
      priceCents: 13000,
      booked: 9,
    },
    {
      daysAgo: 48,
      hour: 12,
      title: "Reef Day — Elbow",
      capacity: 12,
      priceCents: 12500,
      booked: 10,
    },
    {
      daysAgo: 53,
      hour: 12,
      title: "Wreck Trip — Bibb",
      capacity: 10,
      priceCents: 18000,
      booked: 8,
    },
    {
      daysAgo: 58,
      hour: 12,
      title: "Two-Tank Reef — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 11,
    },
    {
      daysAgo: 64,
      hour: 12,
      title: "Two-Tank Reef — Pickles",
      capacity: 10,
      priceCents: 13000,
      booked: 6,
    },
    {
      daysAgo: 70,
      hour: 23,
      title: "Night Dive — Benwood",
      capacity: 8,
      priceCents: 14000,
      booked: 5,
    },
    {
      daysAgo: 76,
      hour: 12,
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
      hour: 12,
      title: "Two-Tank Reef — Molasses",
      capacity: 12,
      priceCents: 13000,
      booked: 10,
    },
    {
      daysAgo: 87,
      hour: 23,
      title: "Night Dive — French Reef",
      capacity: 8,
      priceCents: 14000,
      booked: 6,
    },
    {
      daysAgo: 92,
      hour: 12,
      title: "Wreck Trip — USCGC Duane",
      capacity: 10,
      priceCents: 18500,
      booked: 9,
    },
    {
      daysAgo: 97,
      hour: 12,
      title: "Two-Tank Reef — Pickles Reef",
      capacity: 12,
      priceCents: 13000,
      booked: 8,
    },
    {
      daysAgo: 103,
      hour: 16,
      title: "Afternoon Two-Tank — French Reef",
      capacity: 10,
      priceCents: 13000,
      booked: 7,
    },
    {
      daysAgo: 109,
      hour: 12,
      title: "Reef Day — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 12,
    },
    {
      daysAgo: 115,
      hour: 12,
      title: "Wreck Trip — Spiegel Grove",
      capacity: 10,
      priceCents: 18000,
      booked: 10,
    },
    {
      daysAgo: 121,
      hour: 12,
      title: "Two-Tank Reef — Benwood",
      capacity: 12,
      priceCents: 13000,
      booked: 9,
    },
    {
      daysAgo: 127,
      hour: 23,
      title: "Night Dive — City of Washington",
      capacity: 8,
      priceCents: 14000,
      booked: 5,
    },
    {
      daysAgo: 133,
      hour: 12,
      title: "Reef Day — Christ of the Abyss",
      capacity: 12,
      priceCents: 12500,
      booked: 11,
    },
    {
      daysAgo: 139,
      hour: 12,
      title: "Two-Tank Reef — Elbow",
      capacity: 12,
      priceCents: 13000,
      booked: 8,
    },
    {
      daysAgo: 146,
      hour: 12,
      title: "Wreck Trip — Bibb",
      capacity: 10,
      priceCents: 18000,
      booked: 7,
    },
    {
      daysAgo: 153,
      hour: 12,
      title: "Two-Tank Reef — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 10,
    },
    {
      daysAgo: 160,
      hour: 16,
      title: "Afternoon Two-Tank — Pickles Reef",
      capacity: 10,
      priceCents: 13000,
      booked: 6,
    },
    {
      daysAgo: 167,
      hour: 12,
      title: "Reef Day — French Reef",
      capacity: 12,
      priceCents: 12500,
      booked: 9,
    },
    {
      daysAgo: 174,
      hour: 23,
      title: "Night Dive — Molasses Reef",
      capacity: 8,
      priceCents: 14000,
      booked: 4,
    },
    {
      daysAgo: 181,
      hour: 12,
      title: "Wreck Trip — Duane",
      capacity: 10,
      priceCents: 18000,
      booked: 8,
    },
    {
      daysAgo: 188,
      hour: 12,
      title: "Two-Tank Reef — Christ of the Abyss",
      capacity: 12,
      priceCents: 13000,
      booked: 10,
    },
    {
      daysAgo: 196,
      hour: 12,
      title: "Reef Day — Benwood & Elbow",
      capacity: 12,
      priceCents: 12500,
      booked: 7,
    },
    {
      daysAgo: 204,
      hour: 12,
      title: "Wreck Trip — Spiegel Grove",
      capacity: 10,
      priceCents: 18000,
      booked: 9,
    },
    {
      daysAgo: 212,
      hour: 16,
      title: "Afternoon Two-Tank — Molasses",
      capacity: 10,
      priceCents: 13000,
      booked: 5,
    },
    {
      daysAgo: 221,
      hour: 12,
      title: "Two-Tank Reef — French & Christ",
      capacity: 12,
      priceCents: 13000,
      booked: 11,
    },
    {
      daysAgo: 230,
      hour: 23,
      title: "Night Dive — Benwood Wreck",
      capacity: 8,
      priceCents: 14000,
      booked: 6,
    },
    {
      daysAgo: 239,
      hour: 12,
      title: "Wreck Trip — Bibb",
      capacity: 10,
      priceCents: 18000,
      booked: 10,
    },
    {
      daysAgo: 249,
      hour: 12,
      title: "Reef Day — Pickles Reef",
      capacity: 12,
      priceCents: 12500,
      booked: 8,
    },
    {
      daysAgo: 259,
      hour: 12,
      title: "Two-Tank Reef — Molasses & French",
      capacity: 12,
      priceCents: 13000,
      booked: 9,
    },
    {
      daysAgo: 270,
      hour: 12,
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
        waiver: !cancelled && k % 9 !== 0,
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
        tokenHash: `hist-waiver-${waiverToken}`,
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
            stripeCustomerId: `cus_demo_${invoiceSeq}`,
            stripeInvoiceId: `in_demo_${invoiceSeq}`,
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
        stripeSessionId: `cs_tip_demo_${i + 1}`,
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
  ];
  // The written reviews go on three *different* departures, so the public list
  // reads like a shop's history rather than one memorable boat day.
  const commentedTrips = new Set<string>();
  const reviewRows = plans
    .map((plan, i) => {
      const booking = bookingRows[i];
      if (!booking || plan.status !== "checked_in" || i % 4 !== 0) return null;
      const wantsComment =
        commentedTrips.size < reviewComments.length && !commentedTrips.has(booking.tripId);
      if (wantsComment) commentedTrips.add(booking.tripId);
      const comment = wantsComment ? reviewComments[commentedTrips.size - 1] : null;
      // The third written review stays unpublished — that is the "waiting on
      // you" card the staff Reviews page exists to clear.
      const isPublished = comment === null || commentedTrips.size < 3;
      const createdAt = new Date(plan.createdAt.getTime() + 6 * 60 * 60 * 1000);
      return {
        shopId,
        bookingId: booking.id,
        tripId: booking.tripId,
        personId: plan.personId,
        rating: i % 3 === 0 ? 5 : 4,
        comment,
        isPublished,
        publishedAt: isPublished ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (reviewRows.length > 0) await db.insert(tripReviews).values(reviewRows);
}

/**
 * The paperwork side of a working week: divers waiting on a sold-out charter,
 * rental sizes already asked for on the boats that have not sailed yet, a
 * couple of invoices out, and the confirmation emails that went with them —
 * including one that bounced, because they do.
 *
 * Nothing here touches today's boat. Its roster, its readiness counts, and the
 * blocker copy on the departure board are asserted exactly, and they describe a
 * morning where the work has not been done yet — which is the point of showing
 * it.
 */
async function seedFrontDesk(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
  tripRows: { id: string; title: string }[],
  bookingRows: { id: string; tripId: string; personId: string }[],
  includeHistoryData: boolean,
): Promise<void> {
  const tripByTitle = new Map(tripRows.map((trip) => [trip.title, trip.id]));
  const wreckId = tripByTitle.get("Wreck Trip — Spiegel Grove");

  // Keep the export useful on a fresh demo: these are the small operational
  // records that otherwise tend to remain empty because they are created by
  // later staff actions in a real shop.
  const listPeople = [9, 10, 11, 12, 43, 45, 47, 49, 51]
    .map((index) => customers[index])
    .filter((person) => person !== undefined);
  if (includeHistoryData && listPeople.length > 0) {
    await db
      .insert(lastMinuteListEntries)
      .values(
        listPeople.map((person, index) => ({
          shopId,
          personId: person.id,
          availableFrom: dateAt(index === 0 ? 0 : 2),
          availableUntil: dateAt(30),
          unsubscribedAt: index === listPeople.length - 1 ? nowDate() : null,
          createdAt: nextCreatedAt(),
        })),
      )
      .onConflictDoNothing();
  }

  // The sold-out charter is where a wait-list earns its keep.
  if (includeHistoryData && wreckId) {
    const waiting = [10, 11, 12].map((index) => customers[index]).filter((c) => c !== undefined);
    if (waiting.length > 0) {
      await db.insert(tripWaitlistEntries).values(
        waiting.map((person) => ({
          shopId,
          tripId: wreckId,
          personId: person.id,
          createdAt: nextCreatedAt(),
        })),
      );
    }

    const [promo] = await db
      .insert(tripLastMinutePromos)
      .values({
        shopId,
        tripId: wreckId,
        status: "sent",
        discountPercent: 25,
        code: "DEMO-REEF-25",
        stripeCouponId: "coupon_demo_reef",
        stripePromotionCodeId: "promo_demo_reef",
        expiresAt: at(2, 18),
        recipientCount: Math.max(1, listPeople.length - 1),
        createdByPersonId: null,
        createdAt: nextCreatedAt(),
      })
      .onConflictDoNothing()
      .returning({ id: tripLastMinutePromos.id });
    void promo;

    const booking = bookingRows.find((row) => row.tripId === wreckId);
    if (booking) {
      const [recorder] = await db
        .select({ id: people.id })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(and(eq(people.shopId, shopId), eq(personRoles.role, "captain")))
        .limit(1);
      if (recorder) {
        await db.insert(rollCallEvents).values({
          shopId,
          tripId: wreckId,
          bookingId: booking.id,
          recordedByPersonId: recorder.id,
          status: "boarded",
          checkpoint: "departure",
          source: "live",
          note: "Demo roll call — checked in at the dock.",
          occurredAt: nowDate(),
        });
      }
      const [checkout] = await db
        .insert(bookingCheckouts)
        .values({
          shopId,
          tripId: wreckId,
          status: "pending",
          stripeAccountId: "acct_demo",
          stripeSessionId: "cs_demo_pending",
          checkoutUrl: "https://checkout.stripe.com/c/pay/demo-pending",
          customerEmail: "priya.sharma@example.com",
          amountPerDiverCents: 18_000,
          totalCents: 18_000,
          expiresAt: at(1, 12),
          createdAt: nextCreatedAt(),
        })
        .onConflictDoNothing({ target: bookingCheckouts.stripeSessionId })
        .returning();
      if (checkout) {
        await db.insert(bookingCheckoutBookings).values({
          shopId,
          checkoutId: checkout.id,
          bookingId: booking.id,
        });
      }
      await db
        .insert(paymentOperationIntents)
        .values({
          shopId,
          kind: "checkout_session",
          status: "succeeded",
          tripId: wreckId,
          bookingId: booking.id,
          stripeObjectId: "cs_demo_pending",
          startedAt: nextCreatedAt(),
          resolvedAt: nowDate(),
        })
        .onConflictDoNothing();
    }
  }

  // Orders are deliberately absent. An order belongs to a Stripe account the
  // shop connected itself, and fabricating one here would show the settings
  // page a connected integration whose "Refresh status" button then calls the
  // real Stripe API and fails. The payment states that gate boarding are
  // seeded on the wreck charter instead, where they are real.

  // The confirmations that went out. Only successes: a seeded bounce would put
  // a permanent red row on the dashboard that no amount of retrying clears,
  // since there is no provider behind it to succeed on the second attempt.
  const notified = bookingRows.filter((booking) => booking.tripId === wreckId).slice(0, 4);
  const deliveries = notified.map((booking, index) => ({
    shopId,
    bookingId: booking.id,
    kind: "booking_confirmation" as const,
    status: "sent" as const,
    providerMessageId: `demo-msg-${index}`,
    attemptedAt: new Date(nowMs() - (index + 1) * 60 * 60 * 1000),
  }));
  if (deliveries.length > 0) {
    await db.insert(notificationDeliveries).values(deliveries);
    await db
      .insert(notificationDeliveryAttempts)
      .values(deliveries.map((delivery) => ({ ...delivery, isRetry: false })));
  }
}

/**
 * The fit book the front desk already keeps: sizes for the divers who have
 * been in before, so tomorrow's prep list is mostly filled in before anyone
 * asks. Deliberately partial — a real fit book always is, and the gaps are
 * what the departure board is complaining about.
 */
async function seedRentalFit(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
): Promise<void> {
  const fits: Array<
    [
      number,
      {
        bcd: string | null;
        wetsuit: string | null;
        boot: string;
        fin: string;
        weights?: string;
        ownsRegulator?: boolean;
        needsStaffFit?: boolean;
      },
    ]
  > = [
    [0, { bcd: "S", wetsuit: "S", boot: "6", fin: "S", weights: "6 kg" }],
    [1, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "8 kg" }],
    // A diver with their own reg — the prep list has to leave it off.
    [3, { bcd: "L", wetsuit: "M", boot: "10", fin: "M", ownsRegulator: true }],
    [4, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "5 kg" }],
    // H-06 demo: the shop is out of this diver's size, so they're flagged for
    // hands-on fitting — their sizes are deliberately blanked on the prep list and they
    // get named in its "fit these divers at check-in" section instead.
    [7, { bcd: "XL", wetsuit: "XL", boot: "12", fin: "L", weights: "10 kg", needsStaffFit: true }],
    // Sizes half-recorded, which is how a fit book actually looks.
    [12, { bcd: null, wetsuit: "M", boot: "7", fin: "M" }],
    // The extended roster: the fit book a shop actually keeps after a few
    // seasons — most divers fully recorded, a few with their own regulator,
    // one more out-of-stock size, and a couple still half-filled in.
    [18, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "9 kg" }],
    [19, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "7 kg" }],
    [20, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "8 kg", ownsRegulator: true }],
    [21, { bcd: "S", wetsuit: "S", boot: "6", fin: "S", weights: "5 kg" }],
    [24, { bcd: "M", wetsuit: "M", boot: "8", fin: "M", weights: "6 kg" }],
    [25, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "6 kg" }],
    [29, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "8 kg" }],
    [31, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "6 kg" }],
    [33, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "9 kg", ownsRegulator: true }],
    [35, { bcd: "M", wetsuit: "M", boot: "8", fin: "M", weights: "6 kg" }],
    [40, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "8 kg" }],
    // Another out-of-stock size — the second XL the prep list flags today.
    [
      42,
      { bcd: "XL", wetsuit: "XL", boot: "13", fin: "XL", weights: "11 kg", needsStaffFit: true },
    ],
    [44, { bcd: "S", wetsuit: "S", boot: "6", fin: "S", weights: "5 kg" }],
    [46, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "8 kg" }],
    [52, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "7 kg" }],
    [55, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "5 kg" }],
    [61, { bcd: "M", wetsuit: "M", boot: "8", fin: "M", weights: "6 kg", ownsRegulator: true }],
    [63, { bcd: "L", wetsuit: "L", boot: "11", fin: "L", weights: "9 kg" }],
    [64, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "6 kg" }],
    [70, { bcd: "L", wetsuit: "L", boot: "10", fin: "L", weights: "8 kg" }],
    [74, { bcd: "M", wetsuit: "M", boot: "9", fin: "M", weights: "7 kg" }],
    [80, { bcd: "S", wetsuit: "S", boot: "7", fin: "S", weights: "5 kg" }],
    // Sizes half-recorded — a second version of the gap above.
    [26, { bcd: "M", wetsuit: null, boot: "8", fin: "M" }],
    [59, { bcd: null, wetsuit: "S", boot: "6", fin: "S" }],
  ];
  const profiles = fits
    .map(([index, fit]) => {
      const person = customers[index];
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        rentsBcd: true,
        rentsRegulator: !fit.ownsRegulator,
        rentsWetsuit: true,
        rentsMaskFins: true,
        rentsWeights: true,
        bcdSize: fit.bcd,
        wetsuitSize: fit.wetsuit,
        bootSize: fit.boot,
        finSize: fit.fin,
        weightPreference: fit.weights ?? null,
        needsStaffFitAt: fit.needsStaffFit ? nowDate() : null,
        needsStaffFitNote: fit.needsStaffFit ? "No XL BCD left — fit from the spares" : null,
      };
    })
    .filter((row) => row !== null);
  if (profiles.length > 0) await db.insert(rentalFitProfiles).values(profiles);
}

/**
 * A fuller month: charters and course sessions beyond the four headline
 * boats seeded above, so the schedule reads like a shop that runs most days
 * of the week — not four trips in a fortnight. Every catalog course gets at
 * least one dated session somewhere in here (several get two), the two new
 * dive sites (Duane, Pickles Reef) earn their keep, and a couple of trips
 * are cancelled outright — the weather does that to a real boat schedule.
 *
 * Drawn entirely from the extended roster (customers[10] and up) so nothing
 * here touches today's three exactly-asserted boats, and Hana (customers[12],
 * who must stay booked on *nothing*, see the comment at her cert rows above)
 * never appears. Most bookings get a signed waiver — the same "most people
 * fill it out" norm as today's reef trip — with a steady ~1-in-7 left
 * unsigned so a diver profile or a trip's Guests tab still shows the
 * occasional straggler.
 */
async function seedMoreTrips(
  db: DbExecutor,
  shopId: string,
  ctx: {
    customers: { id: string }[];
    siteByName: Map<string, { id: string; name: string }>;
    courseRows: Array<{
      id: string;
      title: string;
      minimumCertificationLevel:
        | "open_water"
        | "advanced_open_water"
        | "rescue"
        | "divemaster"
        | "instructor"
        | null;
    }>;
    instructorId: string;
    captainId: string | undefined;
    divemasterId: string | undefined;
    waiverTemplate: { id: string; title: string; version: number; body: string };
  },
): Promise<void> {
  const { customers, siteByName, courseRows, instructorId, captainId, divemasterId } = ctx;
  const courseByTitle = new Map(courseRows.map((course) => [course.title, course]));

  // Everyone from the extended roster except: Hana (12, must stay unbooked),
  // and the five deliberately-uncertified walk-ups (27, 38, 58, 68, 78), who
  // only ever appear on an entry-level session below.
  const excludedFromPool = new Set([12, 27, 38, 58, 68, 78]);
  const generalPool = customers
    .map((_, index) => index)
    .filter((index) => index >= 10 && index < customers.length && !excludedFromPool.has(index));
  let poolCursor = 0;
  const draw = (n: number): number[] => {
    const picked: number[] = [];
    for (let i = 0; i < n; i++) {
      const index = generalPool[poolCursor % generalPool.length];
      if (index !== undefined) picked.push(index);
      poolCursor++;
    }
    return picked;
  };

  type ExtraTripDef = {
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    siteName?: string;
    courseTitle?: string;
    isNight?: boolean;
    isWreck?: boolean;
    status?: "scheduled" | "cancelled";
    conditionsHold?: boolean;
    conditionsSummary?: string;
    roster: number[];
  };

  // Each capacity/booked pair is chosen so its remaining-seat count never
  // reads "3 spots left" (the reef trip's exact, asserted text), "Full" (the
  // wreck charter's alone), or "6 spots left" (reserved for a spec's own
  // throwaway trip) — see the comment above `laterRosters`.
  const tripDefs: ExtraTripDef[] = [
    {
      title: "Morning Two-Tank — Molasses Reef",
      description: "An early boat on the outer reef, back at the dock before the wind picks up.",
      startsAt: at(1, 7, 0),
      endsAt: at(1, 10, 30),
      capacity: 12,
      siteName: "Molasses Reef",
      roster: draw(8),
    },
    {
      title: "Two-Tank Reef — French Reef",
      description: "Ledges and swim-throughs — a second boat the same week as the regulars.",
      startsAt: at(2, 11, 0),
      endsAt: at(2, 14, 30),
      capacity: 10,
      siteName: "French Reef",
      roster: draw(8),
    },
    {
      title: "Scuba Refresher — half day",
      description: "A patient skills tune-up before getting back in the water.",
      startsAt: at(4, 9, 0),
      endsAt: at(4, 12, 0),
      capacity: 4,
      courseTitle: "Scuba Refresher",
      // Both lapsed-card divers from the roster above — exactly who a
      // refresher course is for.
      roster: [31, 66],
    },
    {
      title: "Two-Tank Reef — Benwood & Molasses",
      description: "Shallow wreck first, coral heads second — a quiet midweek boat.",
      startsAt: at(6, 8, 0),
      endsAt: at(6, 11, 30),
      capacity: 12,
      siteName: "Benwood Wreck",
      roster: draw(5),
    },
    {
      title: "Sunset Two-Tank — French Reef",
      description: "Ledges and swim-throughs with the light coming in low on the second tank.",
      startsAt: at(8, 16, 0),
      endsAt: at(8, 19, 30),
      capacity: 10,
      siteName: "French Reef",
      roster: draw(9),
    },
    {
      title: "Rescue Diver — two-day course",
      description: "Problem prevention and rescue skills for experienced divers.",
      // Kept clear of the seeded Open Water course (day 9-11) and Deep Diver
      // (day 20-21) — both also crew Marcus, and overlapping his assignment
      // window would collide (see the "no seeded course may overlap" rule
      // near seedMoreTrips's top).
      startsAt: at(58, 8, 0),
      endsAt: at(59, 17, 0),
      capacity: 4,
      courseTitle: "Rescue Diver",
      roster: [29, 40, 42],
    },
    {
      title: "Sunset Two-Tank — Christ of the Abyss (weather hold)",
      description: "Cancelled ahead of a small-craft advisory; rescheduling with everyone booked.",
      startsAt: at(10, 16, 0),
      endsAt: at(10, 19, 30),
      capacity: 10,
      siteName: "Christ of the Abyss",
      status: "cancelled",
      conditionsHold: true,
      conditionsSummary: "Small-craft advisory through the afternoon — the crew called it early.",
      roster: [],
    },
    {
      title: "Discover Scuba Diving — afternoon",
      description: "A small, instructor-led first breath underwater. No C-card required.",
      startsAt: at(12, 13, 0),
      endsAt: at(12, 16, 0),
      capacity: 4,
      courseTitle: "Discover Scuba Diving",
      roster: [27, ...draw(1)],
    },
    {
      title: "Wreck Trip — USCGC Duane",
      description: "A second deep advanced wreck. AOW + Deep + nitrox required.",
      startsAt: at(14, 12, 0),
      endsAt: at(14, 16, 0),
      capacity: 10,
      siteName: "USCGC Duane",
      isWreck: true,
      roster: [18, 19, 20, 21, 22, 23],
    },
    {
      title: "Two-Tank Reef — French Reef (small craft advisory)",
      description: "Cancelled for weather; nobody had booked yet.",
      startsAt: at(17, 11, 0),
      endsAt: at(17, 14, 30),
      capacity: 10,
      siteName: "French Reef",
      status: "cancelled",
      conditionsHold: true,
      conditionsSummary: "Small-craft advisory — rescheduled for later in the month.",
      roster: [],
    },
    {
      title: "Two-Tank Reef — Pickles Reef",
      description:
        "The barrel-coral classic — beginner-friendly and one of the busiest boats this week.",
      startsAt: at(16, 11, 30),
      endsAt: at(16, 15, 0),
      capacity: 12,
      siteName: "Pickles Reef",
      roster: draw(11),
    },
    {
      title: "Family Two-Tank — Christ of the Abyss",
      description: "A gentle, shallow boat — a good first charter for a family diving together.",
      startsAt: at(19, 10, 0),
      endsAt: at(19, 13, 30),
      capacity: 8,
      siteName: "Christ of the Abyss",
      roster: draw(6),
    },
    {
      title: "Try Scuba — SSI first dive",
      description: "A supervised first scuba experience.",
      // Day 20 is the seeded Deep Diver session's own window (day 20-21) —
      // kept clear so both keep their own claim on Marcus's crew slot.
      startsAt: at(61, 13, 0),
      endsAt: at(61, 16, 0),
      capacity: 4,
      courseTitle: "Try Scuba",
      roster: draw(2),
    },
    {
      title: "Midweek Two-Tank — Molasses Reef",
      description: "A quiet boat on the outer reef — plenty of room this week.",
      startsAt: at(23, 12, 0),
      endsAt: at(23, 15, 30),
      capacity: 12,
      siteName: "Molasses Reef",
      roster: draw(4),
    },
    {
      title: "Three-Day SSI Certification — Open Water",
      description: "SSI's entry-level autonomous diver certification.",
      // Days 22 and 24 are reserved by e2e specs that create their own
      // Marcus-crewed session there (courses.spec.ts, gear-fit-and-age.spec.ts)
      // — kept clear so setTripCrew's overlap check never collides with them.
      startsAt: at(63, 9, 0),
      endsAt: at(65, 17, 0),
      capacity: 4,
      courseTitle: "SSI Open Water Diver",
      // The three previously-uncertified walk-ups — finally taking the class.
      roster: [58, 68, 78],
    },
    {
      title: "Night Dive — French Reef",
      description: "Torches, tarpon, and bioluminescence. Night specialty required.",
      startsAt: at(25, 23, 0),
      endsAt: at(26, 2, 30),
      capacity: 8,
      isNight: true,
      roster: [24, 25, 29],
    },
    {
      title: "Two-Tank Reef — Benwood Wreck",
      description: "Bow to stern along the sand, then back over the plates.",
      startsAt: at(26, 9, 0),
      endsAt: at(26, 12, 30),
      capacity: 10,
      siteName: "Benwood Wreck",
      roster: draw(8),
    },
    {
      title: "Advanced Adventurer — two-day course",
      description: "Five guided specialty adventure dives.",
      startsAt: at(26, 13, 0),
      endsAt: at(27, 17, 0),
      capacity: 5,
      courseTitle: "Advanced Adventurer",
      roster: [52, 55, 61],
    },
    {
      title: "Two-Site Combo — Statue & Molasses Reef",
      description: "Classic shallow sites, then the outer reef on the second tank.",
      startsAt: at(28, 11, 0),
      endsAt: at(28, 14, 30),
      capacity: 12,
      siteName: "Christ of the Abyss",
      roster: draw(7),
    },
    {
      title: "Two-Tank Reef — French Reef & Molasses",
      description: "Ledges first, the outer reef second — a two-site charter, dock to dock.",
      startsAt: at(30, 8, 0),
      endsAt: at(30, 11, 30),
      capacity: 12,
      siteName: "French Reef",
      roster: draw(8),
    },
    {
      title: "Advanced Wreck — USCGC Duane",
      description: "A second sailing to the Duane. AOW + Deep + nitrox required.",
      startsAt: at(33, 12, 0),
      endsAt: at(33, 16, 0),
      capacity: 10,
      siteName: "USCGC Duane",
      isWreck: true,
      roster: draw(6),
    },
    {
      title: "Peak Performance Buoyancy — weekend",
      description: "A real weight check, then two dives spent hovering.",
      startsAt: at(35, 9, 0),
      endsAt: at(35, 17, 0),
      capacity: 4,
      courseTitle: "Peak Performance Buoyancy",
      roster: draw(2),
    },
    {
      title: "Two-Tank Reef — Pickles & French",
      description: "A second sailing to the barrel-coral reef, paired with French Reef.",
      startsAt: at(36, 11, 30),
      endsAt: at(36, 15, 0),
      capacity: 12,
      siteName: "Pickles Reef",
      roster: draw(10),
    },
    {
      title: "Diver Stress & Rescue — SSI two-day",
      description: "Recognize stress and respond to diver emergencies.",
      startsAt: at(39, 9, 0),
      endsAt: at(40, 17, 0),
      capacity: 4,
      courseTitle: "Diver Stress & Rescue",
      roster: [64, 70],
    },
    {
      title: "Wreck Diver — PADI four dives",
      description: "Survey, mapping, and limited penetration on four dives.",
      startsAt: at(41, 9, 0),
      endsAt: at(42, 17, 0),
      capacity: 4,
      courseTitle: "Wreck Diver",
      roster: [74, 80],
    },
    {
      title: "Nitrox 40 — SSI one day",
      description: "Use nitrox mixes up to 40 percent oxygen.",
      startsAt: at(44, 9, 0),
      endsAt: at(44, 17, 0),
      capacity: 5,
      courseTitle: "Nitrox 40",
      roster: draw(3),
    },
    {
      title: "Afternoon Two-Tank — Christ of the Abyss",
      description: "A late boat on the shallow statue site — good light for photos.",
      startsAt: at(46, 15, 0),
      endsAt: at(46, 18, 30),
      capacity: 10,
      siteName: "Christ of the Abyss",
      roster: draw(8),
    },
    {
      title: "Two-Tank Reef — Benwood & French",
      description: "The shallow wreck, then ledges and swim-throughs on the second tank.",
      startsAt: at(48, 8, 0),
      endsAt: at(48, 11, 30),
      capacity: 12,
      siteName: "Benwood Wreck",
      roster: draw(10),
    },
    {
      title: "Night Dive — Benwood Wreck",
      description: "A shallower night charter — good for a diver's first dive after dark.",
      startsAt: at(50, 22, 30),
      endsAt: at(51, 2, 0),
      capacity: 8,
      isNight: true,
      roster: draw(4),
    },
    {
      title: "Sunrise Two-Tank — Molasses Reef",
      description: "First boat out, calm water, and the reef to yourselves for an hour.",
      startsAt: at(52, 7, 0),
      endsAt: at(52, 10, 30),
      capacity: 12,
      siteName: "Molasses Reef",
      roster: draw(10),
    },
    {
      title: "Divemaster — PADI internship kickoff",
      description: "The first professional rating, taught as an internship.",
      startsAt: at(54, 9, 0),
      endsAt: at(54, 13, 0),
      capacity: 2,
      courseTitle: "Divemaster",
      // Already Rescue-certified — the internship's actual entry gate.
      roster: [63],
    },
    {
      title: "Family Two-Tank — Molasses Reef",
      description: "A relaxed outer-reef boat, good for a family diving together.",
      startsAt: at(56, 10, 0),
      endsAt: at(56, 13, 30),
      capacity: 8,
      siteName: "Molasses Reef",
      roster: draw(6),
    },
  ];

  const insertedTrips = await db
    .insert(trips)
    .values(
      tripDefs.map((def) => ({
        shopId,
        diveSiteId: def.siteName ? siteByName.get(def.siteName)?.id : undefined,
        courseId: def.courseTitle ? courseByTitle.get(def.courseTitle)?.id : undefined,
        title: def.title,
        description: def.description,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        capacity: def.capacity,
        status: def.status ?? "scheduled",
        conditionsHold: def.conditionsHold ?? false,
        conditionsSummary: def.conditionsSummary,
      })),
    )
    .returning();

  await db.insert(tripScheduleDays).values(
    insertedTrips.map((trip) => ({
      tripId: trip.id,
      dayNumber: 1,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
    })),
  );

  await db.insert(tripRequirements).values(
    insertedTrips.map((trip, i) => {
      const def = tripDefs[i];
      return {
        tripId: trip.id,
        shopId,
        requiresWaiver: true,
        // Course sessions gate on their own catalog minimum (Discover Scuba,
        // SSI Open Water, and Try Scuba all admit an uncertified diver — the
        // same rule createTrip applies); every other trip takes the shop's
        // default Open Water gate. The Duane wreck's AOW + Deep comes from
        // the site row itself and merges in at read time (readiness.ts).
        minimumCertificationLevel: def.courseTitle
          ? (courseByTitle.get(def.courseTitle)?.minimumCertificationLevel ?? null)
          : ("open_water" as const),
        requiredSpecialties: (def.isNight ? ["night"] : []) as DiveSpecialty[],
        requiresNitrox: def.isWreck ?? false,
        requiresPayment: def.isWreck ?? false,
      };
    }),
  );

  await db.insert(tripAssignments).values(
    insertedTrips.flatMap((trip, i) => {
      const def = tripDefs[i];
      if (def.courseTitle) return [{ tripId: trip.id, personId: instructorId }];
      return [
        ...(captainId ? [{ tripId: trip.id, personId: captainId }] : []),
        ...(divemasterId ? [{ tripId: trip.id, personId: divemasterId }] : []),
      ];
    }),
  );

  const insertedBookings = await db
    .insert(bookings)
    .values(
      insertedTrips.flatMap((trip, i) =>
        tripDefs[i].roster
          .map((index) => customers[index])
          .filter((person): person is { id: string } => person !== undefined)
          .map((person) => ({
            shopId,
            tripId: trip.id,
            personId: person.id,
            status: "booked" as const,
            createdAt: nextCreatedAt(),
          })),
      ),
    )
    .returning();

  // Most divers fill out their waiver before the boat leaves — roughly 6 in
  // 7 here, the same "most people sign" norm as today's reef trip — leaving
  // a steady trickle of stragglers so a Guests tab or a diver's profile still
  // shows the occasional unsigned card.
  let extraWaiverToken = 0;
  const extraWaiverRows = insertedBookings.map((booking) => {
    extraWaiverToken++;
    const createdAt = nextCreatedAt();
    const signed = extraWaiverToken % 7 !== 0;
    return {
      shopId,
      bookingId: booking.id,
      personId: booking.personId,
      templateId: ctx.waiverTemplate.id,
      templateTitle: ctx.waiverTemplate.title,
      templateVersion: ctx.waiverTemplate.version,
      templateBody: ctx.waiverTemplate.body,
      tokenHash: `seed-extra-waiver-${shopId}-${extraWaiverToken}`,
      // Comfortably past the furthest trip seeded here (day 56).
      expiresAt: at(75, 12),
      createdAt,
      ...(signed
        ? {
            status: "completed" as const,
            signedName: "Signed on file",
            signatureMethod: "in_person" as const,
            consentedAt: createdAt,
            signedAt: createdAt,
            completedAt: createdAt,
          }
        : {}),
    };
  });
  if (extraWaiverRows.length > 0) await db.insert(waiverRecords).values(extraWaiverRows);

  // The Duane wreck readiness track: three of the six divers paid or on
  // deposit — the other three (blocked by cert/specialty/nitrox regardless,
  // see the extended-roster certs above) still owe nothing on file.
  const duaneTrip = insertedTrips.find((trip) => trip.title === "Wreck Trip — USCGC Duane");
  if (duaneTrip) {
    const duaneBookings = insertedBookings.filter((b) => b.tripId === duaneTrip.id);
    const findDuaneBooking = (index: number) =>
      duaneBookings.find((b) => b.personId === customers[index]?.id);
    const duanePaymentPlan: Array<{
      booking: { id: string } | undefined;
      status: "paid" | "deposit_paid";
      amountCents: number;
    }> = [
      { booking: findDuaneBooking(18), status: "paid", amountCents: 18_000 },
      { booking: findDuaneBooking(19), status: "deposit_paid", amountCents: 6_000 },
      { booking: findDuaneBooking(20), status: "paid", amountCents: 18_000 },
    ];
    const duanePaymentSeed = duanePaymentPlan
      .filter((row) => row.booking !== undefined)
      .map((row) => ({
        shopId,
        bookingId: (row.booking as { id: string }).id,
        status: row.status,
        amountCents: row.amountCents,
        currency: "usd",
      }));
    if (duanePaymentSeed.length > 0) await db.insert(bookingPayments).values(duanePaymentSeed);
  }

  // A little front-desk texture on the trips this back-fill added: a
  // wait-list entry on the nearly-full Pickles Reef charter, and a
  // last-minute promo on the quietest midweek boat.
  const picklesTrip = insertedTrips.find((trip) => trip.title === "Two-Tank Reef — Pickles Reef");
  const quietTrip = insertedTrips.find((trip) => trip.title === "Midweek Two-Tank — Molasses Reef");
  const waitlistCandidate = customers[draw(1)[0] ?? -1];
  if (picklesTrip && waitlistCandidate) {
    await db.insert(tripWaitlistEntries).values({
      shopId,
      tripId: picklesTrip.id,
      personId: waitlistCandidate.id,
      createdAt: nextCreatedAt(),
    });
  }
  if (quietTrip) {
    await db
      .insert(tripLastMinutePromos)
      .values({
        shopId,
        tripId: quietTrip.id,
        status: "sent",
        discountPercent: 20,
        code: "DEMO-MIDWEEK-20",
        stripeCouponId: "coupon_demo_midweek",
        stripePromotionCodeId: "promo_demo_midweek",
        expiresAt: at(22, 18),
        recipientCount: 6,
        createdByPersonId: null,
        createdAt: nextCreatedAt(),
      })
      .onConflictDoNothing();
  }
}

/**
 * Nitrox demo: a couple of verified EANx cards (and one pending), plus an
 * Nitrox request on the wreck charter — so the prep list shows a real
 * mix split and a real card gate the moment a fresh checkout boots.
 */
async function seedNitrox(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
  wreck: { id: string },
  bookingRows: { id: string; tripId: string; personId: string }[],
): Promise<void> {
  // Two verified EANx cards, one still pending review.
  await db.insert(nitroxCertifications).values([
    {
      shopId,
      personId: customers[0].id,
      agency: "padi" as const,
      identifier: "EANX-0001",
      status: "verified" as const,
      reviewedAt: nowDate(),
    },
    {
      shopId,
      personId: customers[1].id,
      agency: "ssi" as const,
      identifier: "EANX-0002",
      status: "verified" as const,
      reviewedAt: nowDate(),
    },
    {
      shopId,
      personId: customers[2].id,
      agency: "padi" as const,
      identifier: "EANX-0003",
      status: "pending" as const,
    },
  ]);

  // The Duane wreck readiness track (see the extended-roster certs/specialty
  // above): three EANx cards verified, one still pending — the same "almost
  // ready" spread the rest of the roster gets.
  const duaneNitroxPlan: Array<[number, "verified" | "pending"]> = [
    [18, "verified"],
    [19, "verified"],
    [20, "verified"],
    [22, "pending"],
  ];
  const duaneNitroxRows = duaneNitroxPlan
    .map(([index, status]) => {
      const person = customers[index];
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        agency: "padi" as const,
        identifier: `EANX-${String(index + 1).padStart(4, "0")}`,
        status,
        reviewedAt: status === "verified" ? nowDate() : null,
      };
    })
    .filter((row) => row !== null);
  if (duaneNitroxRows.length > 0) await db.insert(nitroxCertifications).values(duaneNitroxRows);

  // The imported nitrox state, on the same diver as the imported specialty card
  // above: verified so it is never a boarding blocker, unconfirmed so the *fill*
  // still gives plain air (authorizesNitroxFill) and the confirm asks the staffer
  // to attest they have seen the card (H-24).
  if (customers[12]) {
    await db.insert(nitroxCertifications).values([
      {
        shopId,
        personId: customers[12].id,
        agency: "padi" as const,
        identifier: "EANX-0013",
        status: "verified" as const,
        importedAt: nowDate(),
        importedFromLabel: "Coral Coast Divers",
      },
    ]);
  }

  // History carried in from the shop's previous system, on the same diver as
  // the imported cards above (ADR 20260725-import-prior-visits). Hana is booked
  // on nothing, so her history can never touch a seeded trip's readiness,
  // manifest, or Today queue — which is also the point being demonstrated:
  // imported visits are inert.
  //
  // The three rows are the three shapes the profile has to render honestly: a
  // completed booking, one the old system recorded as cancelled (struck through,
  // never counted as a dive), and one with no price on it. Clock-anchored like
  // every other seeded date so the visual baseline stays pixel-stable.
  if (customers[12]) {
    await db.insert(priorVisits).values([
      {
        shopId,
        personId: customers[12].id,
        visitedOn: dateAt(-384),
        title: "Two-tank morning — Molasses Reef",
        statusLabel: "Completed",
        amountLabel: "$165.00",
        sourceLabel: "Coral Coast Divers",
        sourceReference: "CCD-20418",
        dedupeKey: "ref:ccd-20418",
        importedAt: nowDate(),
      },
      {
        shopId,
        personId: customers[12].id,
        visitedOn: dateAt(-201),
        title: "Night dive — Benwood Wreck",
        statusLabel: "Cancelled",
        amountLabel: "$95.00",
        sourceLabel: "Coral Coast Divers",
        sourceReference: "CCD-22677",
        dedupeKey: "ref:ccd-22677",
        importedAt: nowDate(),
      },
      {
        shopId,
        personId: customers[12].id,
        visitedOn: dateAt(-97),
        title: "Drysuit specialty — pool session",
        statusLabel: "Completed",
        amountLabel: null,
        sourceLabel: "Coral Coast Divers",
        sourceReference: "CCD-24003",
        dedupeKey: "ref:ccd-24003",
        importedAt: nowDate(),
      },
    ]);
  }

  // A Nitrox request from a diver whose card is verified, on the
  // nitrox-required wreck charter.
  const wreckBookingForCert = bookingRows.find(
    (b) => b.tripId === wreck.id && b.personId === customers[0].id,
  );
  if (wreckBookingForCert) {
    await db
      .update(bookings)
      .set({ wantsNitrox: true })
      .where(eq(bookings.id, wreckBookingForCert.id));
  }
}

/**
 * Restore the demo playground to its seeded state. Wipes everything a visitor
 * can touch — trips and their sessions, bookings and everything hanging off
 * them (waivers, roll call), the course catalog, cards, rental fit,
 * and every non-staff person (seeded customers plus any walk-ups the booking
 * flow created) — then re-seeds the schedule. The shop, its default waiver
 * template, staff, and their logins are deliberately left in place so the demo
 * session stays valid (docs ADR 20260718-demo-mode).
 *
 * Deletes run children-first so foreign keys never block a reset, however far
 * a visitor drove the tool (signed a waiver, saved a fit, ran roll call).
 */
export async function resetDemoSchedule(
  db: DbExecutor,
  shopId: string,
  opts: { history?: boolean } = {},
): Promise<void> {
  const shopTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shopId));
  const tripIds = shopTrips.map((t) => t.id);

  // Booking- and trip-dependent operational history first. Delete order is a
  // topological sort of the foreign-key graph: every table that references
  // bookings, trips, or people must be cleared before those parents. A missing
  // child here surfaces as an FK-violation mid-run — e.g. a waitlist entry or
  // order left behind blocks the trips/bookings delete and dirties the next
  // test's fixture (regression tests live in seed.test.ts).
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
  await db.delete(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId));
  // References people, so it clears before them like any other people-scoped row.
  await db.delete(priorVisits).where(eq(priorVisits.shopId, shopId));
  await db.delete(waiverRecords).where(eq(waiverRecords.shopId, shopId));
  await db.delete(bookingPayments).where(eq(bookingPayments.shopId, shopId));
  // Readiness/confirm capabilities reference bookings, so they must go before them.
  await db.delete(bookingCapabilities).where(eq(bookingCapabilities.shopId, shopId));
  // Tips reference bookings, so they must go before them — same FK this
  // cascade's sibling (deleteDemoShopCascade) already fixed (Codex finding:
  // this reset path had its own, separate child-first list and was missed).
  await db.delete(tips).where(eq(tips.shopId, shopId));
  await db
    .delete(notificationDeliveryAttempts)
    .where(eq(notificationDeliveryAttempts.shopId, shopId));
  await db.delete(notificationSendQueue).where(eq(notificationSendQueue.shopId, shopId));
  await db.delete(notificationDeliveries).where(eq(notificationDeliveries.shopId, shopId));
  // Recap photos reference bookings and trips, so they must go before both.
  await db.delete(recapPhotos).where(eq(recapPhotos.shopId, shopId));
  // Reviews reference bookings, trips, and people — all three parents below.
  await db.delete(tripReviews).where(eq(tripReviews.shopId, shopId));
  // Stripe checkout/refund state references bookings, trips, and orders, so it
  // must be cleared before those parents or the deletes below FK-violate and
  // abort the whole reset mid-run — leaving a prior payment test's trips and
  // bookings to leak into the next test's fixture (this is what made trips.spec
  // flake under the full suite). booking_checkout_bookings references both
  // booking_checkouts and bookings; payment_operation_intents references trips,
  // bookings, orders, and booking_checkouts — so both go before booking_checkouts.
  await db.delete(bookingCheckoutBookings).where(eq(bookingCheckoutBookings.shopId, shopId));
  await db.delete(paymentOperationIntents).where(eq(paymentOperationIntents.shopId, shopId));
  // A redemption points at the checkout that spent the code, so it goes first
  // (docs ADR 20260729-shop-promo-codes). The codes themselves are shop config
  // and survive a schedule reset.
  await db.delete(shopPromoRedemptions).where(eq(shopPromoRedemptions.shopId, shopId));
  await db.delete(bookingCheckouts).where(eq(bookingCheckouts.shopId, shopId));
  // Orders (and their line items) reference bookings and people; the waitlist
  // references trips and people. Both must go before the parents below.
  await db.delete(orderLineItems).where(eq(orderLineItems.shopId, shopId));
  await db.delete(orders).where(eq(orders.shopId, shopId));
  await db.delete(tripWaitlistEntries).where(eq(tripWaitlistEntries.shopId, shopId));
  // References trips (last-minute-deal blasts) and people (the last-minute
  // list itself), so both must go before the trips/people deletes below or
  // this FK-violates and aborts the whole reset mid-run (docs ADR
  // 20260727-last-minute-fill-promos; same class of bug the tripWaitlistEntries
  // comment above already walks).
  await db.delete(tripLastMinutePromos).where(eq(tripLastMinutePromos.shopId, shopId));
  // Before the entries they point at. Added with Leo's self-serve unsubscribe
  // (docs ADR 20260731-self-serve-unsubscribe) but not to this ordering, which
  // made every `/api/test/reset` throw 23503 mid-run and leave the demo shop
  // half-reset — the e2e fleet then failed in whichever spec happened to read
  // the wreckage next, which is why the flake moved around between runs.
  await db
    .delete(lastMinuteListUnsubscribeTokens)
    .where(eq(lastMinuteListUnsubscribeTokens.shopId, shopId));
  await db.delete(lastMinuteListEntries).where(eq(lastMinuteListEntries.shopId, shopId));
  // References people (courtesy-email opt-out tokens minted for waitlist
  // invites and trip recaps), so it must go before the people deletes below
  // or this FK-violates and aborts the whole reset mid-run — the same class
  // of bug the last-minute-list unsubscribe token comment above already walks.
  await db
    .delete(personCourtesyEmailUnsubscribeTokens)
    .where(eq(personCourtesyEmailUnsubscribeTokens.shopId, shopId));
  await db.delete(bookings).where(eq(bookings.shopId, shopId));
  await db.delete(tripRequirements).where(eq(tripRequirements.shopId, shopId));
  if (tripIds.length > 0) {
    await db.delete(tripAssignments).where(inArray(tripAssignments.tripId, tripIds));
    await db.delete(tripDives).where(inArray(tripDives.tripId, tripIds));
  }
  await db.delete(trips).where(eq(trips.shopId, shopId));
  await db.delete(diveSiteMoments).where(eq(diveSiteMoments.shopId, shopId));
  await db.delete(diveSiteCreatures).where(eq(diveSiteCreatures.shopId, shopId));
  await db.delete(diveSites).where(eq(diveSites.shopId, shopId));
  // Paths first: their steps cascade from either side, but a path row itself
  // is only shop-scoped, so deleting courses alone would strand it. A course
  // inquiry references its course without cascade (a lead is evidence, not
  // something a schedule reset should silently vanish), so it must go before
  // the courses delete or this FK-violates and aborts the whole reset mid-run
  // — the same class of bug the comment above already walks.
  await db.delete(coursePaths).where(eq(coursePaths.shopId, shopId));
  await db.delete(courseInquiries).where(eq(courseInquiries.shopId, shopId));
  await db.delete(courses).where(eq(courses.shopId, shopId));
  await db.delete(certifications).where(eq(certifications.shopId, shopId));
  await db.delete(specialtyCertifications).where(eq(specialtyCertifications.shopId, shopId));
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.shopId, shopId));

  // Everyone except the four staff seeded once at shop creation (seedDemo's
  // and createDemoShop's own `staffDefs`, by full name since canonical and
  // minted shops give them different emails) — seeded customers, booking-flow
  // walk-ups, and any staff invited or promoted mid-test. Checking `STAFF_ROLES`
  // alone isn't enough: e2e/staff-invite.spec.ts invites and accepts a new
  // instructor, which makes them a real staff-role person indistinguishable
  // from the seeded four by role — so without the name check, that invited
  // person became permanently "stable" and leaked into every later spec
  // sharing this worker (a "Priya Nair" row on the settings/team screenshot
  // whose invite email embeds the wall-clock millisecond it was created,
  // never matching twice — this was the flakiest screenshot in the visual
  // suite, stability 0.07).
  const STABLE_STAFF_NAMES = new Set(["Dana Reyes", "Marcus Webb", "Keiko Tanaka", "Sal Moretti"]);
  const staffRows = await db
    .select({ personId: personRoles.personId, fullName: people.fullName })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])));
  const stableStaffIds = new Set(
    staffRows.filter((r) => STABLE_STAFF_NAMES.has(r.fullName)).map((r) => r.personId),
  );

  const shopPeople = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shopId));
  const purgeIds = shopPeople.map((p) => p.id).filter((id) => !stableStaffIds.has(id));
  if (purgeIds.length > 0) {
    await db.delete(personRoles).where(inArray(personRoles.personId, purgeIds));
    // Login rows reference people (user_accounts.person_id), so they must go
    // before the people they belong to or the delete below FK-violates (23503),
    // aborts the whole reset mid-run, and leaks the churned schedule into the
    // next spec's fixture. A purged person carries a login whenever a flow
    // minted one for them — contact import (src/db/import.ts), diver signup,
    // and staff invite/accept all do — so this is not hypothetical; it is what
    // made trips.spec flake under the full suite. deleteDemoShopCascade already
    // clears these; the per-reset path must too. Account tokens (email verify /
    // password reset) reference the login row itself, one layer further down
    // the same chain — a forgot-password request against a purged person's
    // account leaves one behind, so it must go before user_accounts for the
    // identical reason (security review finding on 20260725-account-lifecycle-emails).
    const purgeAccountIds = (
      await db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(inArray(userAccounts.personId, purgeIds))
    ).map((row) => row.id);
    if (purgeAccountIds.length > 0) {
      await db.delete(accountTokens).where(inArray(accountTokens.userAccountId, purgeAccountIds));
    }
    await db.delete(userAccounts).where(inArray(userAccounts.personId, purgeIds));
    await db.delete(people).where(inArray(people.id, purgeIds));
  }

  // Shop-level fixtures a test can mutate directly (not just schedule data)
  // (Codex finding): `shops.review_url` (Settings → Review link) and a
  // connected `shop_stripe_accounts` row (`/api/test/seed-stripe-account`)
  // both persist across resets otherwise, since neither is schedule/booking
  // data — leaking into whichever spec runs next in the same worker and
  // making its assertions order-dependent (e2e/recap.spec.ts's own "review
  // link starts absent" check, for one). The canonical seed never sets
  // either, so restoring to that state is just deleting/nulling them.
  // `shops.depth_unit` is the same class of leak: it's the only
  // shop-settings column e2e/depth-and-age-surfaces.spec.ts's "read back in
  // the shop's own unit" test mutates (metres → feet, mid-test), and nothing
  // ever flips it back — a second run against the same server (e.g. a local
  // `pnpm exec playwright test` rerun without restarting `next start`)
  // starts already on "feet" and the test's own `/Maximum depth \(metres\)/`
  // locator then never matches, hanging for the full test timeout rather
  // than failing fast.
  await db.update(shops).set({ reviewUrl: null, depthUnit: "meters" }).where(eq(shops.id, shopId));
  await db.delete(shopStripeAccounts).where(eq(shopStripeAccounts.shopId, shopId));

  // The waiver is the same class of fixture. Editing the release text saves a
  // *new version* rather than mutating the signed one, so a spec that edits it
  // leaves the shop on version 2 — and the next spec asserting "Version 1" or
  // reading the default body sees the previous test's edit instead. The signed
  // records referencing these rows were cleared at the top of this reset, so
  // the templates can be replaced outright. The title is immutable in the UI,
  // so the existing one is the shop's own (the canonical demo and a minted one
  // seed different titles) and is what gets restored.
  const [existingWaiver] = await db
    .select({ title: waiverTemplates.title })
    .from(waiverTemplates)
    .where(eq(waiverTemplates.shopId, shopId))
    .limit(1);
  await db.delete(waiverTemplates).where(eq(waiverTemplates.shopId, shopId));
  await db.insert(waiverTemplates).values({
    shopId,
    title: existingWaiver?.title ?? DEFAULT_WAIVER_TITLE,
    version: 1,
    body: DEFAULT_WAIVER_BODY,
    createdAt: nowDate(),
  });

  await seedDemoSchedule(db, shopId, { history: opts.history === true });
}

/** Default lifetime of a minted demo shop before the reaper clears it. */
export const DEFAULT_DEMO_TTL_MS = 7 * DAY_MS;

/**
 * Delete a demo shop and every row it owns. There is no `ON DELETE CASCADE` on
 * the shop-scoped foreign keys, so this is a hand-maintained topological delete:
 * every table that references bookings, trips, orders, checkouts, dive sites, or
 * people is cleared before those parents, and the shop row goes last. The
 * **global** dive-site catalog (`globalDiveSites`) is shared across shops and is
 * deliberately never touched.
 *
 * The guard on this ordering is `reap-demos.test.ts`, but read it before trusting
 * it: it is a set of hand-written per-table cases (a tip, an account token, a
 * last-minute unsubscribe token), **not** a sweep that proves every table is
 * empty. A new table with a shop-scoped FK is therefore invisible to it until
 * someone adds a case — which is exactly how
 * `last_minute_list_unsubscribe_tokens` slipped through and started aborting
 * every `/api/test/reset` mid-run. Adding a table here means adding its case
 * there in the same change.
 *
 * Never call this on the canonical blue-mantis demo or any real shop; the reaper
 * below only ever passes it a minted demo (`isDemo`, non-canonical slug).
 */
export async function deleteDemoShopCascade(db: DbExecutor, shopId: string): Promise<void> {
  const shopTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shopId));
  const tripIds = shopTrips.map((t) => t.id);
  const shopPeople = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shopId));
  const personIds = shopPeople.map((p) => p.id);

  // Order/checkout/booking dependents first.
  await db.delete(orderLineItems).where(eq(orderLineItems.shopId, shopId));
  await db.delete(paymentOperationIntents).where(eq(paymentOperationIntents.shopId, shopId));
  await db.delete(orders).where(eq(orders.shopId, shopId));
  await db.delete(bookingCheckoutBookings).where(eq(bookingCheckoutBookings.shopId, shopId));
  // Redemptions reference checkouts; the codes themselves are referenced *by*
  // checkouts, so the codes go after them (docs ADR 20260729-shop-promo-codes).
  await db.delete(shopPromoRedemptions).where(eq(shopPromoRedemptions.shopId, shopId));
  await db.delete(bookingCheckouts).where(eq(bookingCheckouts.shopId, shopId));
  await db.delete(shopPromoCodes).where(eq(shopPromoCodes.shopId, shopId));
  await db.delete(bookingPayments).where(eq(bookingPayments.shopId, shopId));
  await db.delete(tips).where(eq(tips.shopId, shopId));
  await db.delete(bookingCapabilities).where(eq(bookingCapabilities.shopId, shopId));
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
  await db.delete(recapPhotos).where(eq(recapPhotos.shopId, shopId));
  await db.delete(tripReviews).where(eq(tripReviews.shopId, shopId));
  await db.delete(waiverRecords).where(eq(waiverRecords.shopId, shopId));
  await db
    .delete(notificationDeliveryAttempts)
    .where(eq(notificationDeliveryAttempts.shopId, shopId));
  await db.delete(notificationSendQueue).where(eq(notificationSendQueue.shopId, shopId));
  await db.delete(notificationDeliveries).where(eq(notificationDeliveries.shopId, shopId));
  await db.delete(tripWaitlistEntries).where(eq(tripWaitlistEntries.shopId, shopId));
  // Same reasoning as resetDemoSchedule above (docs ADR 20260727-last-minute-fill-promos),
  // including the unsubscribe tokens that reference the entries.
  await db.delete(tripLastMinutePromos).where(eq(tripLastMinutePromos.shopId, shopId));
  await db
    .delete(lastMinuteListUnsubscribeTokens)
    .where(eq(lastMinuteListUnsubscribeTokens.shopId, shopId));
  await db.delete(lastMinuteListEntries).where(eq(lastMinuteListEntries.shopId, shopId));
  // References people, same reasoning as resetDemoSchedule above.
  await db
    .delete(personCourtesyEmailUnsubscribeTokens)
    .where(eq(personCourtesyEmailUnsubscribeTokens.shopId, shopId));
  if (tripIds.length > 0) {
    await db.delete(tripAssignments).where(inArray(tripAssignments.tripId, tripIds));
    await db.delete(tripDives).where(inArray(tripDives.tripId, tripIds));
  }
  await db.delete(tripRequirements).where(eq(tripRequirements.shopId, shopId));
  await db.delete(bookings).where(eq(bookings.shopId, shopId));
  await db.delete(trips).where(eq(trips.shopId, shopId));
  await db.delete(tripSeries).where(eq(tripSeries.shopId, shopId));

  // People-scoped records and the shop's own catalog/config.
  await db.delete(certifications).where(eq(certifications.shopId, shopId));
  await db.delete(specialtyCertifications).where(eq(specialtyCertifications.shopId, shopId));
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.shopId, shopId));
  await db.delete(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId));
  await db.delete(priorVisits).where(eq(priorVisits.shopId, shopId));
  await db.delete(diveSiteMoments).where(eq(diveSiteMoments.shopId, shopId));
  await db.delete(diveSiteCreatures).where(eq(diveSiteCreatures.shopId, shopId));
  await db.delete(diveSites).where(eq(diveSites.shopId, shopId));
  // Paths first: their steps cascade from either side, but a path row itself
  // is only shop-scoped, so deleting courses alone would strand it. A course
  // inquiry references its course without cascade (a lead is evidence, not
  // something a schedule reset should silently vanish), so it must go before
  // the courses delete or this FK-violates and aborts the whole reset mid-run
  // — the same class of bug the comment above already walks.
  await db.delete(coursePaths).where(eq(coursePaths.shopId, shopId));
  await db.delete(courseInquiries).where(eq(courseInquiries.shopId, shopId));
  await db.delete(courses).where(eq(courses.shopId, shopId));
  await db.delete(waiverTemplates).where(eq(waiverTemplates.shopId, shopId));
  await db.delete(shopStripeAccounts).where(eq(shopStripeAccounts.shopId, shopId));
  await db.delete(mediaDeletionAttempts).where(eq(mediaDeletionAttempts.shopId, shopId));

  if (personIds.length > 0) {
    // Account tokens reference user_accounts, one layer further down the same
    // chain the comment above already walks — a demo owner who ever requested
    // a reset link leaves one behind, and it must go before user_accounts or
    // this FK-violates and strands the shop past the reaper's TTL (security
    // review finding on 20260725-account-lifecycle-emails).
    const demoAccountIds = (
      await db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(inArray(userAccounts.personId, personIds))
    ).map((row) => row.id);
    if (demoAccountIds.length > 0) {
      await db.delete(accountTokens).where(inArray(accountTokens.userAccountId, demoAccountIds));
    }
    await db.delete(userAccounts).where(inArray(userAccounts.personId, personIds));
    await db.delete(personRoles).where(inArray(personRoles.personId, personIds));
  }
  await db.delete(people).where(eq(people.shopId, shopId));
  await db.delete(shops).where(eq(shops.id, shopId));
}

/**
 * Clear minted demo shops older than `maxAgeMs`. Selects only `isDemo` shops
 * whose slug is not the canonical demo — so blue-mantis and every real shop are
 * untouchable here — and deletes each in its own transaction so one failure
 * doesn't strand the rest. Time comes through `now` (clock rule); the cron route
 * supplies the TTL from env.
 */
export async function reapExpiredDemoShops(
  db: AppDb,
  opts: { now?: number; maxAgeMs?: number } = {},
): Promise<{ deleted: number; slugs: string[] }> {
  const now = opts.now ?? nowMs();
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_DEMO_TTL_MS;
  const cutoff = new Date(now - maxAgeMs);

  const expired = await db
    .select({ id: shops.id, slug: shops.slug })
    .from(shops)
    .where(
      and(eq(shops.isDemo, true), ne(shops.slug, DEMO_SHOP_SLUG), lt(shops.createdAt, cutoff)),
    );

  for (const shop of expired) {
    await db.transaction(async (tx) => deleteDemoShopCascade(tx, shop.id));
  }
  return { deleted: expired.length, slugs: expired.map((s) => s.slug) };
}

/**
 * Delete every minted demo shop right now, regardless of age — the canonical
 * blue-mantis demo and all real shops are left alone. The e2e reset uses this so
 * the shared test database doesn't accumulate the disposable shops each "Try the
 * live demo" mints (age-based reaping is unreliable under the frozen e2e clock,
 * since `created_at` is a real wall-clock default).
 */
export async function purgeMintedDemoShops(db: AppDb): Promise<number> {
  const minted = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.isDemo, true), ne(shops.slug, DEMO_SHOP_SLUG)));
  for (const shop of minted) {
    await db.transaction(async (tx) => deleteDemoShopCascade(tx, shop.id));
  }
  return minted.length;
}

/**
 * Hard ceiling on how many minted demo shops may exist at once — the aggregate
 * bound the per-IP rate limit can't provide (security review, finding 1).
 * `DEMO_SHOP_MAX_LIVE` overrides it; a non-positive or non-numeric value keeps
 * the default.
 */
export const DEFAULT_DEMO_SHOP_MAX_LIVE = 200;

function mintedDemoCap(): number {
  const configured = Number(process.env.DEMO_SHOP_MAX_LIVE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DEMO_SHOP_MAX_LIVE;
}

/**
 * Evict the oldest minted demos until there is room for one more under the cap.
 * Only minted demos are ever eligible — the canonical blue-mantis demo (by slug)
 * and every real shop (`isDemo:false`) are excluded, so this can never delete a
 * real tenant. Runs inside the caller's transaction so the eviction and the new
 * mint commit together.
 */
export async function enforceMintedDemoCap(db: DbExecutor): Promise<void> {
  const cap = mintedDemoCap();
  const live = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.isDemo, true), ne(shops.slug, DEMO_SHOP_SLUG)))
    .orderBy(asc(shops.createdAt));
  const toEvict = live.length - (cap - 1);
  for (let i = 0; i < toEvict; i++) {
    await deleteDemoShopCascade(db, live[i].id);
  }
}
