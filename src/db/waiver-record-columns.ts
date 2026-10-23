import { getTableColumns } from "drizzle-orm";
import { WAIVER_SEALED_FIELDS, type WaiverSealedField } from "@/lib/waiver-integrity";
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
 *   `draftShopAnswers` — what a bearer typed before signing. Nothing about
 *   readiness reads an unsigned draft.
 * - `shopAnswers` — the shop's own questions as answered. They inform and
 *   never gate, so no status read, roster or manifest has a use for them; the
 *   signed record reads them through {@link WAIVER_SEALED_COLUMNS}, because
 *   the seal covers them.
 * - `tokenHash`, `tokenSealed` — the bearer link. A status read must never be
 *   able to hand it back out.
 * - `integrityHash` — only the integrity check reads the seal, through
 *   {@link WAIVER_SEALED_COLUMNS}.
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
  tokenHash: _tokenHash,
  tokenSealed: _tokenSealed,
  integrityHash: _integrityHash,
  ...stateColumns
} = getTableColumns(waiverRecords);

export const WAIVER_STATE_COLUMNS = stateColumns;

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
