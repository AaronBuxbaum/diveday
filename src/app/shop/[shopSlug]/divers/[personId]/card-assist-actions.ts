"use server";

import { runAssist } from "@/db/assists";
import { readGearNote } from "@/db/desk-assists";
import { certificationAgency } from "@/db/schema";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  CERT_SCAN_FEATURE,
  certScanCall,
  certScanFields,
  parseCardImage,
  scanCard,
} from "@/lib/assists/cert-scan";
import {
  offeredSizeFields,
  RENTAL_NOTE_FEATURE,
  rentalNoteCall,
  rentalNoteFields,
} from "@/lib/assists/rental-note";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * The diver record's assists: a card photo into the add-a-card form
 * (`certscan`) and the diver's gear note into the size boxes (`gear-text`).
 * Both only answer form values; neither writes a row, and the forms they fill
 * submit through their own actions exactly as typed values would.
 */

/** The add-a-card form's choices, each labelled in the shop's language for the prompt. */
function deskCardOptions(locale: string) {
  const label = staffTranslator(locale);
  const cards: (readonly [string, string])[] = [
    ...Object.entries(CERTIFICATION_LEVEL_KEYS).map(
      ([value, key]) => [`level:${value}`, label(key)] as const,
    ),
    ...Object.entries(SPECIALTY_KEYS).map(
      ([value, key]) => [`specialty:${value}`, label(key)] as const,
    ),
    ["nitrox", label("divers.specialty.nitroxOption")] as const,
  ];
  return { agencies: certificationAgency.enumValues, cards };
}

export async function readCardPhotoAction(
  shopSlug: string,
  image: { data: string; mediaType: string },
): Promise<Record<string, string> | null> {
  const { db, shop } = await requireShopSurface(shopSlug);
  const parsed = parseCardImage(image?.data, image?.mediaType);
  if (!parsed) return null;
  const options = deskCardOptions(shop.defaultLocale);
  const value = await scanCard((model) =>
    runAssist(db, {
      shopId: shop.id,
      feature: CERT_SCAN_FEATURE,
      call: certScanCall(parsed, options, model),
    }),
  );
  const fields = certScanFields(value);
  const values: Record<string, string> = {};
  if (fields.agency) values.agency = fields.agency;
  if (fields.card) values.card = fields.card;
  if (fields.cardNumber) values.identifier = fields.cardNumber;
  return Object.keys(values).length > 0 ? values : null;
}

export async function readGearNoteAction(
  shopSlug: string,
  rawPersonId: string,
  form: Record<string, string> = {},
): Promise<Record<string, string> | null> {
  const personId = uuidParam(rawPersonId);
  if (!personId) return null;
  const { db, shop } = await requireShopSurface(shopSlug);
  const note = await readGearNote(db, shop.id, personId);
  if (!note) return null;
  const value = await runAssist(db, {
    shopId: shop.id,
    feature: RENTAL_NOTE_FEATURE,
    call: rentalNoteCall(note.note),
  });
  // The form as it stands: a box staff already filled is not overwritten.
  const fields = rentalNoteFields(value, offeredSizeFields(note.rentalItems), form);
  return Object.keys(fields).length > 0 ? fields : null;
}
