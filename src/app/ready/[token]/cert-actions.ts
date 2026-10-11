"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createNitroxCertification } from "@/db/nitrox";
import { createCertification, createSpecialtyCertification } from "@/db/readiness";
import { certificationAgency, certificationLevel, diveSpecialty } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { revalidateAndRedirect } from "@/lib/navigation";
import { base, bounceTarget, contextFor, refuseWhileHeld } from "./action-helpers";

/**
 * The diver's own certification card, typed in from their phone.
 *
 * Capture, never clearance. `createCertification` stores every card `pending`,
 * and only a staff review (`reviewCertification`) makes one count toward
 * readiness — so nothing a diver types here can clear their own cert gate, and
 * the boarding decision stays exactly where it was. What it changes is that a
 * diver told "we still need your certification card" now has somewhere to put
 * it: before this, the readiness page named the blocker and offered no way to
 * answer it, so the card arrived as a photo in a reply-to email, or at the dock.
 *
 * `agency` and `level` are validated against the database enums rather than a
 * hand-written list, so widening the enum can never leave this refusing a card
 * the column accepts (the same rule `CertificationAgency` exists for).
 */
const certificationSchema = z.object({
  agency: z.enum(certificationAgency.enumValues),
  level: z.enum(certificationLevel.enumValues),
  // Long enough for every agency's format, short enough that the box can never
  // be used to push a body at the column.
  identifier: z.string().trim().min(2).max(60),
});

export async function saveCertificationFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=cert`);

  const created = await createCertification(ctx.db, {
    // The person and shop come from the verified capability, never from the
    // form: a bearer of this token can only ever file a card against its own
    // booking's diver.
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    agency: parsed.data.agency,
    level: parsed.data.level,
    identifier: parsed.data.identifier,
    // **Stamped as the diver's own word, because that is what it is.** Without
    // it the row is byte-for-byte a staff transcription of a card somebody
    // held, and `reviewCertification`'s one-tap promote — which asks for a
    // sighting only from an unsighted self-declaration — would launder a
    // number typed on a phone into `verified`, the state readiness and the
    // fill gate both read. `security-reviewer`, 2026-08-20.
    selfDeclaredAt: nowDate(),
  });
  // `createCertification` returns null when a live card already holds this
  // shop/agency/number — most often the diver's own card, already on file and
  // possibly already verified. Say so rather than reporting a failure: there is
  // nothing for them to fix, and re-typing it would only be refused again.
  revalidateAndRedirect(base(token), `${base(token)}?saved=${created ? "cert" : "cert-known"}`);
}

/**
 * A specialty card the trip demands — Deep, Wreck, Night, Drysuit.
 *
 * The number is **required**, unlike the level declaration a booking form takes:
 * `specialty_certifications.identifier` is `NOT NULL`, because a specialty is a
 * yes/no gate on a materially riskier dive and there is no version of one that
 * is only a claim with no number behind it.
 *
 * `selfDeclaredAt` is what makes this form safe to offer at all. It is why
 * `specialty_certifications` gained the column on 2026-08-20: without it a row a
 * diver typed is byte-for-byte a staff transcription, and
 * `reviewSpecialtyCertification`'s ordinary one-tap confirm would promote an
 * invented number to `verified` — the state that clears a depth gate past 18 m.
 * With it, that tap asks the staffer for the card in their hand.
 */
const specialtySchema = z.object({
  agency: z.enum(certificationAgency.enumValues),
  specialty: z.enum(diveSpecialty.enumValues),
  identifier: z.string().trim().min(2).max(60),
});

export async function saveSpecialtyFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const parsed = specialtySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=cert`);

  const created = await createSpecialtyCertification(ctx.db, {
    // Shop and person come from the verified capability, never the form.
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    agency: parsed.data.agency,
    specialty: parsed.data.specialty,
    identifier: parsed.data.identifier,
    selfDeclaredAt: nowDate(),
  });
  revalidateAndRedirect(base(token), `${base(token)}?saved=${created ? "cert" : "cert-known"}`);
}

/**
 * A nitrox card, from the diver rather than the counter.
 *
 * Same contract as the two above: filed `pending`, cleared only by a staffer.
 * `authorizesNitroxFill` reads `verified` and nothing else, so this can put a
 * number on the record and can never put enriched air in a cylinder.
 */
const nitroxCertSchema = z.object({
  agency: z.enum(certificationAgency.enumValues),
  identifier: z.string().trim().min(2).max(60),
});

export async function saveNitroxCertificationFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const parsed = nitroxCertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=cert`);

  const created = await createNitroxCertification(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    agency: parsed.data.agency,
    identifier: parsed.data.identifier,
    selfDeclaredAt: nowDate(),
  });
  revalidateAndRedirect(base(token), `${base(token)}?saved=${created ? "cert" : "cert-known"}`);
}
