import { isPlausibleDateOfBirth } from "./age";
import { isValidCalendarDate } from "./calendar-date";
import { PARTICIPANT_TYPES, type ParticipantType } from "./participant-types";

/**
 * **The walk-in form's party rows** (fifth loop, item 9): the field names the
 * client rows post and the action reads back, kept out of both so neither
 * spells them alone.
 */

/** The form's name for `KeepTypedOnRefusal`, so a refused party comes back typed. */
export const WALK_IN_PARTY_FORM = "walk-in-party";

/** The most people one walk-in form seats: the first person and seven more. */
export const WALK_IN_PARTY_MAX = 8;

/** Row 0 is the form's own first person, whose name, email and phone are the form's fields. */
export const WALK_IN_FIRST_ROW = 0;

/** What the on-file choice posts for "New person"; otherwise it posts the record's id. */
export const WALK_IN_NEW_PERSON = "new";

export type WalkInMemberField = "name" | "minor" | "dob" | "type" | "match";

/**
 * A party row's field: `member-<n>-name`, `-minor` ("Under 18"), `-dob` (the
 * date of birth asked beside it), `-type` ("Coming as") or `-match` (the
 * on-file choice: a record's id, or {@link WALK_IN_NEW_PERSON}).
 */
export function walkInMemberField(row: number, field: WalkInMemberField): string {
  return `member-${row}-${field}`;
}

/** Facts a row and the first person both carry. */
export type WalkInMemberFacts = {
  minor: boolean;
  /** Only beside a ticked "Under 18". */
  dateOfBirth?: string;
  /** The on-file choice, when the form came back asking for one. */
  match?: string;
};

/** A party row as posted. `row` is its number on the form, which a refusal names. */
export type WalkInPartyRow = WalkInMemberFacts & {
  row: number;
  fullName: string;
  participantType?: ParticipantType;
};

export type WalkInParty = {
  /**
   * The first person's own facts (row 0). Their "Coming as" is not read here:
   * the form posts it as the plain `participantType` field the single walk-in
   * already uses (`newDiverSchema`), and an absent one reads as a diver, the
   * stricter default. A stray `member-0-type` is ignored.
   */
  first: WalkInMemberFacts;
  rows: WalkInPartyRow[];
  /**
   * Something the form could not have sent: more rows than it allows, an
   * unknown type, a date that is not a plausible birth date, or a choice that
   * is neither "new" nor an id. The action refuses the whole form rather than
   * seat a party with somebody quietly left off (security review N5).
   */
  invalid: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Partial<Record<WalkInMemberField, string>>;

function facts(raw: Raw): { facts: WalkInMemberFacts; invalid: boolean } {
  const minor = raw.minor === "true";
  const dob = raw.dob?.trim() || undefined;
  const match = raw.match?.trim() || undefined;
  const dobInvalid =
    minor && dob !== undefined && !(isValidCalendarDate(dob) && isPlausibleDateOfBirth(dob));
  const matchInvalid = match !== undefined && match !== WALK_IN_NEW_PERSON && !UUID.test(match);
  const out: WalkInMemberFacts = { minor };
  if (minor && dob && !dobInvalid) out.dateOfBirth = dob;
  if (match && !matchInvalid) out.match = match;
  return { facts: out, invalid: dobInvalid || matchInvalid };
}

/**
 * The party a form posted: the first person's own facts (row 0) and the rows
 * after it, in row order, without the empty ones. Reads only field names the
 * client could have written.
 */
export function readWalkInParty(entries: Iterable<[string, FormDataEntryValue]>): WalkInParty {
  const byRow = new Map<number, Raw>();
  for (const [name, value] of entries) {
    const match = /^member-(\d{1,4})-(name|minor|dob|type|match)$/.exec(name);
    if (!match || typeof value !== "string") continue;
    const row = Number(match[1]);
    const current = byRow.get(row) ?? {};
    current[match[2] as WalkInMemberField] = value;
    byRow.set(row, current);
  }
  let invalid = false;
  const first = facts(byRow.get(WALK_IN_FIRST_ROW) ?? {});
  invalid ||= first.invalid;
  const rows: WalkInPartyRow[] = [];
  for (const [row, raw] of [...byRow.entries()].sort(([a], [b]) => a - b)) {
    if (row === WALK_IN_FIRST_ROW) continue;
    const fullName = raw.name?.trim() ?? "";
    if (!fullName) continue;
    const read = facts(raw);
    const type = raw.type?.trim() || undefined;
    const typeInvalid =
      type !== undefined && !(PARTICIPANT_TYPES as readonly string[]).includes(type);
    invalid ||= read.invalid || typeInvalid;
    rows.push({
      row,
      fullName,
      ...read.facts,
      ...(type && !typeInvalid ? { participantType: type as ParticipantType } : {}),
    });
  }
  if (rows.length > WALK_IN_PARTY_MAX - 1) invalid = true;
  return { first: first.facts, rows, invalid };
}
