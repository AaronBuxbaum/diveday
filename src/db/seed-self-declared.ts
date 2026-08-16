import type { DbExecutor } from "./client";
import { lastMinuteListEntries, people, personRoles } from "./schema";
import { dateAt, nextCreatedAt } from "./seed-clock";
import { recordSelfDeclaredCards } from "./self-declared-cards";

/**
 * **Two joiners who told the shop something about themselves** — the marks a
 * staffer reads on the last-minute-deal panel before mailing a discount to
 * everybody on it (ADR 20260814-self-declared-cards).
 *
 * Until this module no seeded diver had ever declared anything. Every name on
 * blue-mantis's last-minute list rendered *"Level not said"* — the one branch of
 * `certificationSummaryText` that carries no mark and no tone — so the warning
 * treatment, the "· below this departure's minimum" words and "Not certified yet
 * — diver's word" had only ever been rendered in jsdom. That is the exact shape
 * of a feature that ships inert: green unit tests over a safeguard nobody has
 * ever seen at a real width, in either theme.
 *
 * **Two new people rather than a mark on an existing diver, and that is the
 * whole design of this file.** Every uncarded diver already on the demo's
 * last-minute list (Amara Osei, Felix Grant) holds a seat on an upcoming
 * departure, and a self-declared card would flip that seat's blocker from
 * `certification_missing` to `certification_self_declared` — a readiness surface
 * nothing here has any business moving. A joiner who has never dived with the
 * shop cannot touch a readiness count, because they hold no seat: that is the
 * only way to seed this feature without borrowing somebody else's asserted
 * fixture. It is also what a last-minute list is mostly made of.
 *
 * **Two of them, on a list of ten, on a demo that is a sales surface.** One
 * unverified claim and one uncertified joiner is what a real list looks like; a
 * list where everybody is unverified is a worse demo, and `seed-front-desk.ts`
 * makes that argument at the row it deliberately seeds `succeeded`. Nothing
 * here filters a blast, reorders the mail, or disables a send — informing is the
 * design.
 *
 * **Written through `recordSelfDeclaredCards`, never by inserting a
 * `certifications` row directly**, so the seed cannot drift from the writer's
 * own anti-displacement rules and so a change to what a declaration *is* reaches
 * the demo automatically.
 *
 * Adds only, and called late like `seedCertGates`/`seedMinimumSeats`: nothing
 * seeded before it moves, and neither joiner is booked on anything, so no head
 * count opens and no roster changes.
 *
 * **Rides the history flag**, exactly like the last-minute list these two join
 * (`seed-front-desk.ts`). Not decoration: an entry on that list is what makes
 * Today raise a `last_minute_fill` row for an under-booked departure, so seeding
 * one into the lean unit-test template — or into a freshly minted demo shop,
 * which has no list at all — would put a queue row on boards that have never had
 * one. The demo shop and the e2e fleet run with history on, which is where this
 * belongs.
 */

/**
 * The window both joiners state, and the one number in this file that is load
 * bearing.
 *
 * Selah's window starts **today** so the headline reef departure has one marked
 * recipient before a demo visitor opens it. Rowan still starts tomorrow, which
 * keeps the first capture's list realistic without putting two marked rows on
 * the three-person headline list. The reef panel's two visual baselines and
 * exact-count wait are consequently updated together in `e2e/visual.spec.ts`.
 */
const AVAILABLE_UNTIL_DAYS = 30;

const JOINERS = [
  {
    fullName: "Rowan Feld",
    email: "rowan.feld@example.com",
    phone: "+1-305-555-0196",
    availableFromDays: 1,
    /**
     * A claim, and nothing behind it. Open Water clears the shop's ordinary
     * reef gate, so this row is *not* below most departures' bar — which is
     * what makes it the useful one: it proves the warning tone means "nobody
     * has seen this card" and not "this diver cannot board". The nitrox tick
     * carries its own separate mark, because the two can differ.
     */
    declaration: { level: "open_water" as const, nitrox: true },
  },
  {
    fullName: "Selah Mbeki",
    email: "selah.mbeki@example.com",
    phone: "+1-305-555-0197",
    availableFromDays: 0,
    /**
     * The answer the list had no way to give until 2026-08-15, and the one the
     * whole column exists for: a Discover Scuba customer, a snorkeller, the
     * non-diving half of a couple. It lands as a stamp on the person and never
     * as a certification row, and it is below *every* bar there is — so this
     * row is lifted above the ten-name cap on any departure that asks for
     * anything at all.
     */
    declaration: { noCertification: true },
  },
] as const;

export async function seedSelfDeclaredJoiners(
  db: DbExecutor,
  shopId: string,
  includeHistoryData: boolean,
): Promise<void> {
  if (!includeHistoryData) return;
  const availableUntil = dateAt(AVAILABLE_UNTIL_DAYS);

  // Sequential, never `Promise.all`: this can be handed a transaction, and a
  // drizzle transaction is one checked-out client
  // (`scripts/check-db-concurrency.mjs`).
  for (const joiner of JOINERS) {
    const [person] = await db
      .insert(people)
      .values({
        shopId,
        fullName: joiner.fullName,
        email: joiner.email,
        phone: joiner.phone,
        createdAt: nextCreatedAt(),
      })
      .returning();
    if (!person) throw new Error(`seed: self-declared joiner insert returned no row`);
    // The same role `findOrCreatePerson` gives anybody who arrives through one
    // of the public opt-ins — this seeds what that path produces, so it must
    // produce the same person.
    await db.insert(personRoles).values({ personId: person.id, role: "diver" as const });

    await db.insert(lastMinuteListEntries).values({
      shopId,
      personId: person.id,
      availableFrom: dateAt(joiner.availableFromDays),
      availableUntil,
      createdAt: nextCreatedAt(),
    });

    await recordSelfDeclaredCards(db, {
      shopId,
      personId: person.id,
      ...joiner.declaration,
      now: nextCreatedAt(),
    });
  }
}
