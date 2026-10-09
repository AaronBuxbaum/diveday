import type { GearItemKind, GearServiceKind } from "@/lib/gear";
import type { DiverMessageKey, DiverTranslator } from "./messages";

/**
 * A customer's own gear in the words a message to them uses (ADR
 * 20261008-work-order-follow-up). Lower case, because each one sits inside a
 * sentence ("your gear is ready to collect: regulator, BCD"), and in the
 * diver bundle rather than the staff one, because the reader is the customer.
 * Total over every kind, so a kind added to the register without a word for
 * customers is a compile error here.
 */
const PIECE_KEYS: Record<GearItemKind, DiverMessageKey> = {
  bcd: "notifications.gearPieces.bcd",
  regulator: "notifications.gearPieces.regulator",
  wetsuit: "notifications.gearPieces.wetsuit",
  boots: "notifications.gearPieces.boots",
  mask: "notifications.gearPieces.mask",
  fins: "notifications.gearPieces.fins",
  weights: "notifications.gearPieces.weights",
  dive_computer: "notifications.gearPieces.diveComputer",
  gopro: "notifications.gearPieces.gopro",
  tank: "notifications.gearPieces.tank",
  drysuit: "notifications.gearPieces.drysuit",
  hood: "notifications.gearPieces.hood",
  gloves: "notifications.gearPieces.gloves",
  torch: "notifications.gearPieces.torch",
  dpv: "notifications.gearPieces.dpv",
  smb: "notifications.gearPieces.smb",
  reel: "notifications.gearPieces.reel",
  camera: "notifications.gearPieces.camera",
  nitrox_analyzer: "notifications.gearPieces.nitroxAnalyzer",
  o2_kit: "notifications.gearPieces.o2Kit",
  aed: "notifications.gearPieces.aed",
  first_aid_kit: "notifications.gearPieces.firstAidKit",
  flares: "notifications.gearPieces.flares",
  other: "notifications.gearPieces.other",
};

/** One piece as a customer reads it: "regulator", or "regulator (Apeks XTX200)". */
export function customerGearPieceText(
  t: DiverTranslator,
  piece: { kind: GearItemKind; brandModel?: string | null },
): string {
  const word = t(PIECE_KEYS[piece.kind]);
  const model = piece.brandModel?.trim();
  return model ? t("notifications.gearPieces.withModel", { piece: word, model }) : word;
}

/**
 * The sentence a service reminder opens with, per clock: the clock is the
 * subject of the sentence so the piece's own number never has to agree with a
 * verb ("the visual inspection on your fins is due").
 */
const DUE_KEYS: Record<GearServiceKind, DiverMessageKey> = {
  service: "notifications.gearServiceDue.due.service",
  hydro_test: "notifications.gearServiceDue.due.hydroTest",
  visual_inspection: "notifications.gearServiceDue.due.visualInspection",
  o2_clean: "notifications.gearServiceDue.due.o2Clean",
  aed_pads: "notifications.gearServiceDue.due.aedPads",
  aed_battery: "notifications.gearServiceDue.due.aedBattery",
  expiry: "notifications.gearServiceDue.due.expiry",
  note: "notifications.gearServiceDue.due.note",
};

export function customerGearDueText(
  t: DiverTranslator,
  input: { clock: GearServiceKind; piece: string; date: string },
): string {
  return t(DUE_KEYS[input.clock], { piece: input.piece, date: input.date });
}
