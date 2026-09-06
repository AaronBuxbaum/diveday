import { and, eq, isNull } from "drizzle-orm";

import { nowDate } from "@/lib/clock";
import type { SelfDeclaredLevel } from "@/lib/self-registration";
import type { AppDb } from "./client";
import { findOrCreatePerson } from "./people";
import { saveRentalFit } from "./rental-fit";
import { people, personRoles } from "./schema";
import { recordSelfDeclaredCards } from "./self-declared-cards";
import { issueAndDeliverPersonWaiver } from "./waiver-issue";

/**
 * **A diver puts themselves on the shop's file, before any booking exists**
 * (issue #1236).
 *
 * The counter's QR, and the one write behind it. Everything it does, a staff
 * member could already do from `/shop/**`; what is new is that the *diver* does
 * it, unauthenticated, with no seat to hang it on.
 *
 * ### One outcome, whatever happened
 *
 * The return type carries no branch a caller could render differently, and that
 * is deliberate rather than convenient. Matching a returning diver by email is
 * right for the write and would be a **person-enumeration oracle** in the
 * response: a visitor who could tell "created" from "found" could type any
 * address and learn whether that person dives with this shop. The medical
 * referral is the same leak in a worse form — a hard block is a fact about
 * somebody's health.
 *
 * So the shop learns all of it, on its own surfaces, and the visitor is told
 * only that the shop has their details. `src/lib/self-registration.ts` states
 * the rule; this is where it is kept.
 *
 * ### Nothing here is evidence
 *
 * The certification is stamped `selfDeclaredAt`, so `reviewCertification` will
 * ask for the physical card before it promotes the row — a number typed on a
 * phone must never inherit the one-tap "Mark certified" a colleague's
 * transcription gets. The fit is a living preference. The medical answers are
 * not captured here at all: the release that follows carries them, through the
 * ordinary flow, with the ordinary hard block.
 */
export type SelfRegistrationInput = {
  shopId: string;
  fullName: string;
  /**
   * Already trimmed and lower-cased by the caller, like every
   * `findOrCreatePerson` caller. **Null for a phone-only walk-in**, who is
   * therefore never matched: an email is what makes a returning diver the
   * *same* diver — sign-once, the cert history and the fit all hang off one
   * person row — and inventing a synthetic address to match on would put a
   * fake, mailable-looking value in front of the shop.
   *
   * A phone-only registration lands as its own record and the shop merges it if
   * it turns out to be somebody they know (`mergeDiver`). That is the honest
   * outcome, and it leaks nothing either: a visitor cannot tell it from the
   * matched case, because both end on the same page.
   */
  email: string | null;
  phone?: string;
  certification?: {
    agency: "padi" | "ssi" | "naui" | "sdi" | "raid" | "bsac" | "cmas" | "other";
    level: SelfDeclaredLevel;
    identifier?: string;
  };
  fit?: {
    wetsuitSize?: string;
    bootSize?: string;
    finSize?: string;
  };
  now?: Date;
};

/**
 * A walk-in who gave a phone number and no email. Always a new row — there is
 * nothing to match on — and `findOrCreatePerson`'s unique-violation converge
 * has nothing to do, since the constraint it races against is on the email.
 */
async function createPhoneOnlyPerson(
  tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  input: SelfRegistrationInput,
): Promise<{ person: { id: string }; created: true }> {
  const [person] = await tx
    .insert(people)
    .values({
      shopId: input.shopId,
      fullName: input.fullName,
      email: null,
      phone: input.phone,
    })
    .returning({ id: people.id });
  if (!person) throw new Error("registerDiverAtShop: person insert returned no row");
  await tx.insert(personRoles).values({ personId: person.id, role: "diver" });
  return { person, created: true };
}

export async function registerDiverAtShop(
  db: AppDb,
  input: SelfRegistrationInput,
): Promise<{ personId: string }> {
  const now = input.now ?? nowDate();
  const { personId, created } = await db.transaction(async (tx) => {
    const { person, created } = input.email
      ? await findOrCreatePerson(tx, {
          shopId: input.shopId,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
        })
      : await createPhoneOnlyPerson(tx, input);
    // **Only on creation.** The mark means "this record came from the diver",
    // not "this diver was here recently" — a returning diver re-submitting
    // keeps whatever the row already said, and a person the shop typed in
    // itself never acquires one.
    if (created) {
      await tx
        .update(people)
        .set({ selfRegisteredAt: now })
        .where(and(eq(people.id, person.id), isNull(people.selfRegisteredAt)));
    }
    return { personId: person.id, created };
  });

  // **The card goes through `recordSelfDeclaredCards`, never `createCertification`.**
  //
  // That module exists for exactly this threat model — an unauthenticated form
  // resolving a person by shop and email — and a `security-reviewer` pass found
  // this route bypassing all three of its guards. Each one is a real attack
  // with only a victim's email address behind it: **anti-displacement** (a
  // stranger's "Instructor" claim landing beside the shop's own verified card,
  // moving the booking gate `decideTripAdmission` believes); **the number goes
  // to `declared_identifier`, not `identifier`** (that column is a key, and a
  // claim carrying one reads as `certification_pending`, which withdraws the
  // real diver's card-entry form); and **the lock**, which serializes two
  // declaration writers on one record.
  //
  // It also fixes an availability bug of its own: `createCertification` wrote
  // `""` into that key column, and the partial unique index counts `''`, so the
  // *second* walk-in at a shop to name an agency and no number had their claim
  // silently dropped — and eight submissions, one per agency, would have killed
  // self-declared cards for that shop permanently.
  if (input.certification) {
    await recordSelfDeclaredCards(db, {
      shopId: input.shopId,
      personId,
      level: input.certification.level,
      agency: input.certification.agency,
      identifier: input.certification.identifier,
      now,
    });
  }

  // **Only for a person this submission created.**
  //
  // `saveRentalFit` upserts and writes all seven `rents*` flags, so handing it
  // a matched person let anyone holding a diver's email address wipe their
  // stated fit — every flag to `false`, their size replaced, `fitStatedAt`
  // refreshed so it still read as freshly stated. The boat's packing list then
  // drops that diver's BCD, regulator, wetsuit and weights, and they find out
  // at the dock. Staff need `canOverrideGearRequest` to rewrite a diver's fit;
  // an anonymous form must not be able to at all (`security-reviewer`, #1236).
  //
  // A returning diver correcting their sizes does it the way they already
  // could: the shop's own record, or the counter.
  if (created && input.fit) {
    await saveRentalFit(db, {
      shopId: input.shopId,
      personId,
      // Sizes without a claim about what they rent: the diver is telling the
      // shop what fits, not ordering equipment. Staff set the rest at prep.
      rentsBcd: false,
      rentsRegulator: false,
      rentsWetsuit: false,
      rentsMaskFins: false,
      rentsWeights: false,
      rentsDiveComputer: false,
      rentsGopro: false,
      rentsDrysuit: false,
      rentsHoodGloves: false,
      rentsTorch: false,
      rentsSmb: false,
      wetsuitSize: input.fit.wetsuitSize,
      bootSize: input.fit.bootSize,
      finSize: input.fit.finSize,
    });
  }

  return { personId };
}

/**
 * **The release, issued and sent after the visitor already has their answer.**
 *
 * Deliberately not part of `registerDiverAtShop`, and deliberately called from
 * `after()`: this is the half that talks to SES, and a **new** diver's send is
 * a real network round trip while a **returning** diver whose release still
 * stands sends nothing at all (`issueWaiverRequest` refuses `already_completed`,
 * which is sign-once working). On the request path that difference is a
 * measurable person-enumeration oracle — the one thing this whole module is
 * shaped to deny — so both submissions return on the same work and the mail
 * leaves afterwards (`security-reviewer`, #1236).
 *
 * **The link goes to the diver, not to the screen**, for the same reason:
 * handing the visitor straight into their own waiver page would be the nicest
 * counter flow, and a returning diver has no link to hand over. Sending it out
 * of band is indistinguishable by construction, and it is the path staff
 * already use.
 *
 * Sign-once is untouched either way: an already-signed diver is refused, no
 * second link is minted, and the refusal never reaches the visitor.
 */
export async function deliverSelfRegistrationWaiver(
  db: AppDb,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  await issueAndDeliverPersonWaiver(db, input.shopId, input.personId, {
    now: input.now ?? nowDate(),
  });
}
