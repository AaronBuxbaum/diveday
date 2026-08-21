import type { DbExecutor } from "./client";
import {
  certifications,
  type DiveSpecialty,
  people,
  personRoles,
  specialtyCertifications,
} from "./schema";
import { customerDefs } from "./seed-cast";
import { birthDateTurning, dateAt, nextCreatedAt } from "./seed-clock";

/**
 * The shop's divers and the evidence on file for them.
 *
 * Deliberately not a uniform set: alongside the fully-carded regulars there are
 * cards still queued for review, one expiring inside the month, one already
 * lapsed, agencies the shop does not teach, and two divers with no emergency
 * contact at all. A demo where every gate is green cannot show a crew what the
 * gates are *for*.
 *
 * **Order is load-bearing.** Every later scenario indexes into the returned
 * list by position (`customers[3]` is a specific person to the rosters, the
 * payments, and the manifests), so this must stay a single ordered insert in
 * `customerDefs` order.
 */
export async function seedDivers(
  db: DbExecutor,
  shopId: string,
): Promise<(typeof people.$inferSelect)[]> {
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
    { index: 14, agency: "padi", level: "rescue", status: "verified" },
    { index: 15, agency: "naui", level: "open_water", status: "verified" },
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
    { index: 31, agency: "tdi", level: "open_water", status: "verified" },
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
    { index: 44, agency: "ssi", level: "open_water", status: "verified" },
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
    { index: 66, agency: "padi", level: "open_water", status: "verified" },
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

  return customers;
}
