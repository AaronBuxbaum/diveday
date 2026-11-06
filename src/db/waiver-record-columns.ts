import { getTableColumns } from "drizzle-orm";
import {
  type MedicalAnswerFields,
  physicianClearanceSealed,
  WAIVER_SEALED_FIELDS,
  type WaiverSealedField,
} from "@/lib/waiver-integrity";
import type { WaiverStateFields } from "@/lib/waivers";
import { waiverRecords } from "./schema";

/**
 * **A waiver record as every status read needs it** (code review 2026-10-10,
 * item 17): every column except the ones only the signing page, the signed
 * copy and the integrity audit read.
 *
 * - `templateBody` — the full release text as signed, the widest column on the
 *   row and the one a roster, a readiness pass or a booking handoff never
 *   shows. The signed copy (`getSignedWaiverRecordForShop`) and the
 *   integrity audit read it through {@link WAIVER_SEALED_COLUMNS}, because
 *   the seal covers it.
 * - `draftSignerName`, `draftMedicalAnswers`, `draftGuardian`,
 *   `draftShopAnswers`, `draftMedicalAlert`, `draftViaLinkId` — what a bearer typed before
 *   signing. Nothing about readiness reads an unsigned draft.
 * - `shopAnswers` — the shop's own questions as answered. They inform and
 *   never gate, so no status read, roster or manifest has a use for them; the
 *   signed record reads them through {@link WAIVER_SEALED_COLUMNS}, because
 *   the seal covers them.
 * - `medicalAlert` — the diver's medical alert for the crew, medical-class
 *   free text that informs and never gates. Only its own readers see it
 *   (`src/db/medical-alerts.ts`, behind `canReadMedicalAlert`) and the signed
 *   record through {@link WAIVER_SEALED_COLUMNS}; a roster or readiness pass
 *   that carried it would hand it to every staffer.
 * - `tokenHash` — the bearer link. A status read must never be
 *   able to hand it back out.
 * - `integrityHash`, `medicalAnswerSeal` — only the integrity check reads a
 *   seal, through {@link WAIVER_SEALED_COLUMNS}.
 *
 * `medicalAnswers` stays: the roster's medical-hold summary
 * (`flaggedMedicalPrompts`) reads it on a `medical_review` record.
 *
 * The narrowing is in the type too: a reader that starts needing one of these
 * fails to compile rather than reading `undefined`.
 */
const {
  templateBody: _templateBody,
  draftSignerName: _draftSignerName,
  draftMedicalAnswers: _draftMedicalAnswers,
  draftGuardian: _draftGuardian,
  draftShopAnswers: _draftShopAnswers,
  shopAnswers: _shopAnswers,
  draftMedicalAlert: _draftMedicalAlert,
  draftViaLinkId: _draftViaLinkId,
  medicalAlert: _medicalAlert,
  tokenHash: _tokenHash,
  integrityHash: _integrityHash,
  medicalAnswerSeal: _medicalAnswerSeal,
  ...stateColumns
} = getTableColumns(waiverRecords);

export const WAIVER_STATE_COLUMNS = stateColumns;

const allColumnsForState = getTableColumns(waiverRecords);

/**
 * {@link WAIVER_STATE_COLUMNS} plus the physician's answer seal, for a read
 * that decides boarding. Hand each row to {@link withTrustedClearance} before
 * any rule sees it; the seal never leaves this file.
 */
export const WAIVER_BOARDING_COLUMNS = {
  ...stateColumns,
  medicalAnswerSeal: allColumnsForState.medicalAnswerSeal,
};

/**
 * **A clearance counts only while its seal verifies** (final attacker review
 * B1, glossary *Physician answer seal*): the record a boarding read hands to
 * the rules, with a clearance stamp whose seal is missing or wrong taken off,
 * so the referral holds as unanswered. Checked here, at read time, because the
 * nightly pass reaches a row every few nights at most.
 */
export function withTrustedClearance<R extends WithSeal>(row: R): Omit<R, "medicalAnswerSeal"> {
  const { medicalAnswerSeal: _seal, ...record } = withVerifiedClearance(row);
  return record;
}

type WithSeal = MedicalAnswerFields & { medicalAnswerSeal: string | null };

/**
 * {@link withTrustedClearance} for a reader that keeps the whole row, seal included (the token
 * page's completed record, the signature log, the import's hold check): the same rule, a stamp
 * whose seal is missing or wrong taken off, and nothing else touched.
 */
export function withVerifiedClearance<R extends WithSeal>(row: R): R {
  if (row.medicalClearedAt === null || physicianClearanceSealed(row)) return row;
  return { ...row, medicalClearedAt: null, medicalClearedByPersonId: null };
}

/**
 * One waiver record read through {@link WAIVER_STATE_COLUMNS} — the shape the
 * status rules in `src/lib/waivers.ts` decide from. A reader annotated with it
 * fails to compile if the column list above ever drops a field those rules
 * read.
 */
export type WaiverStateRecord = WaiverStateFields;

const allColumns = getTableColumns(waiverRecords);

/**
 * **A waiver record as the integrity readers need it** (#2358): every column
 * any seal version covers, and the seal (`WAIVER_SEALED_FIELDS`,
 * src/lib/waiver-integrity.ts). Never the bearer token, the unsigned draft,
 * the delivery columns or the shop's later acts on the row, none of which a
 * seal covers or a signature log shows.
 */
export const WAIVER_SEALED_COLUMNS = Object.fromEntries(
  WAIVER_SEALED_FIELDS.map((field) => [field, allColumns[field]]),
) as { [Field in WaiverSealedField]: (typeof allColumns)[Field] };

/**
 * **Every draft column of a pending link, cleared** (security review M1): what
 * a bearer typed before signing, which belongs to whoever typed it. Spread by
 * every writer that moves a pending link to another diver (the split in
 * `bookings.ts`, the repoint in `identity-repoint.ts`) and by erasure
 * (`anonymize.ts`), so a draft never ends up filed under someone who did not
 * type it, where the typist's erasure cannot find it.
 * `waiver-record-columns.test.ts` compares the keys with every `draft*`
 * column of the schema, so a new draft column cannot be missed.
 */
export const CLEARED_DRAFT_COLUMNS = {
  draftSignerName: null,
  draftAcknowledged: false,
  draftMedicalAnswers: null,
  draftGuardian: null,
  draftShopAnswers: null,
  draftMedicalAlert: null,
  draftViaLinkId: null,
} as const satisfies {
  [Column in keyof typeof allColumns as Column extends `draft${string}` ? Column : never]:
    | null
    | false;
};
