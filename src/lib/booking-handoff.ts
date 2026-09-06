import type { WaiverRecord } from "@/db/schema";
import type { CertificationLevel } from "@/lib/certification-levels";
import { MINUTE_MS, nowDate } from "@/lib/clock";
import { certificationRank } from "@/lib/readiness";
import { isCompletedWaiverCurrent } from "@/lib/waivers";

/**
 * The door remembers who opened it (ADR 20260906-before-you-ask, decision 3).
 *
 * A booking page reached from a diver's own link — the thread's next dive —
 * carries a short-lived handoff minted from that capability, and arrives with
 * the standing facts folded into one panel, each naming the day it was kept.
 * This module is the pure half: how long a handoff lives, which facts may be
 * folded and from what, and the never-list the fold is held to by test.
 *
 * What a fact is *not*: a card is never verified here (only a card the shop
 * already verified is named), a head count is never inferred, a medical answer
 * is never carried forward, and the emergency contact's phone is never shown —
 * the name is enough to say "we have one" and the thread is where it changes.
 */
export const HANDOFF_TTL_MS = 10 * MINUTE_MS;
/** The query key the booking page reads the handoff off. */
export const HANDOFF_QUERY_PARAM = "from";
/** One cold-email link per diver per hour (H-68 b), keyed on the delivery row. */
export const HANDOFF_OFFER_COOLDOWN_MS = 60 * MINUTE_MS;

export type KnownDiverFact =
  | { kind: "card"; level: CertificationLevel; keptAt: Date }
  | { kind: "waiver"; keptAt: Date }
  | { kind: "own_gear"; keptAt: Date }
  | { kind: "sizes"; keptAt: Date }
  | { kind: "contact"; name: string };

/**
 * Field names that never fold into a fact, whatever a reader hands in. Held
 * by `booking-handoff.test.ts`: the fold's output is walked and any of these
 * keys, at any depth, fails it.
 */
export const NEVER_HANDED_OFF = [
  "answers",
  "medical",
  "dateOfBirth",
  "phone",
  "emergencyContactPhone",
  "identifier",
  "declaredIdentifier",
  "partySize",
  "capacity",
] as const;

export type KnownDiverSources = {
  certifications: readonly {
    level: CertificationLevel;
    status: "pending" | "verified";
    reviewedAt: Date | null;
    importedAt: Date | null;
    createdAt: Date;
  }[];
  waivers: readonly WaiverRecord[];
  currentTemplateGeneration: number | null;
  rentalFit: {
    rentsBcd: boolean;
    rentsRegulator: boolean;
    rentsWetsuit: boolean;
    rentsMaskFins: boolean;
    rentsWeights: boolean;
    bcdSize: string | null;
    wetsuitSize: string | null;
    bootSize: string | null;
    finSize: string | null;
    fitStatedAt: Date | null;
    updatedAt: Date;
  } | null;
  emergencyContact: { name: string | null; phone: string | null } | null;
  now?: Date;
};

/**
 * The facts a known diver's booking page may fold, in the order the panel
 * reads them. Each is only ever a fact the shop already holds: the highest
 * card a staffer verified, the waiver that still stands under the current
 * release, whether the diver brings their own gear or which sizes were kept,
 * and that an emergency contact is on file. Anything absent renders nothing.
 */
export function foldKnownDiverFacts(sources: KnownDiverSources): KnownDiverFact[] {
  const now = sources.now ?? nowDate();
  const facts: KnownDiverFact[] = [];

  const verified = sources.certifications
    .filter((card) => card.status === "verified")
    .sort((a, b) => certificationRank(b.level) - certificationRank(a.level));
  const card = verified[0];
  if (card) {
    facts.push({
      kind: "card",
      level: card.level,
      keptAt: card.reviewedAt ?? card.importedAt ?? card.createdAt,
    });
  }

  const standing = sources.waivers
    .filter((record) => isCompletedWaiverCurrent(record, sources.currentTemplateGeneration, now))
    .map((record) => record.signedAt ?? record.completedAt)
    .filter((at): at is Date => at !== null)
    .sort((a, b) => b.getTime() - a.getTime());
  const waiverAt = standing[0];
  if (waiverAt) facts.push({ kind: "waiver", keptAt: waiverAt });

  const fit = sources.rentalFit;
  if (fit) {
    const keptAt = fit.fitStatedAt ?? fit.updatedAt;
    const rentsNothing =
      !fit.rentsBcd && !fit.rentsRegulator && !fit.rentsWetsuit && !fit.rentsMaskFins;
    const hasSizes = Boolean(fit.bcdSize || fit.wetsuitSize || fit.bootSize || fit.finSize);
    if (rentsNothing) facts.push({ kind: "own_gear", keptAt });
    else if (hasSizes) facts.push({ kind: "sizes", keptAt });
  }

  const contact = sources.emergencyContact;
  if (contact?.name && contact.phone) facts.push({ kind: "contact", name: contact.name });

  return facts;
}

/** The booking page's own path with the handoff on it. */
export function handoffHref(path: string, token: string): string {
  return `${path}?${HANDOFF_QUERY_PARAM}=${encodeURIComponent(token)}`;
}
