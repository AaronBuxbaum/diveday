/**
 * **The numbers a crew reaches for during, not after.**
 *
 * DiveDay's offline manifest is the document a crew has in hand when everything
 * else is unavailable — encrypted, primed 48 hours ahead, readable on a phone
 * with no signal. Until now it carried who is aboard, their certification
 * evidence, their waivers, their buddy teams and their emergency **contact**:
 * the person to phone *afterwards*. Nothing on it was any use *during*. Grep
 * the tree for `chamber`, `hyperbaric`, `recompression` or `evacuation` before
 * this landed and you got nothing (issue #688).
 *
 * Every value here is the **shop's own**, and DiveDay authors none of them. The
 * nearest chamber differs by dock, the hotline differs by country, and a wrong
 * number on this screen is worse than an empty one — a crew dialling a
 * confidently-printed number that rings nowhere has lost the minute it took to
 * find out.
 *
 * **A reference card, not a workflow.** Nothing here reminds, escalates,
 * messages, or opens an incident report. It is fixed text a shop already has
 * laminated somewhere the phone is not.
 */
export type EmergencyContactLine = {
  /** What this number is, in the shop's words — "Chamber (Key Largo)". */
  label: string;
  /** Dialled as typed. Kept as free text: an international dive line is not a `tel:`-shaped string until the shop writes it. */
  phone: string;
};

export type EmergencyReference = {
  /** The lines a crew dials, in the order the shop wants to read them. */
  lines: EmergencyContactLine[];
  /**
   * The vessel and who to raise on shore — the two facts a coastguard asks for
   * first and the one person who can start everything else.
   */
  vessel: string;
  shoreContact: string;
  /**
   * The shop's own emergency action plan, as prose. Free text on purpose: it is
   * a laminated card being retyped, not a form to fill in, and every shop's is
   * shaped by its dock.
   */
  plan: string;
};

export const EMPTY_EMERGENCY_REFERENCE: EmergencyReference = {
  lines: [],
  vessel: "",
  shoreContact: "",
  plan: "",
};

/**
 * The settings form's line slots — enough for chamber, hotline, coastguard, and
 * two the shop invents.
 *
 * Named rather than counted so the form can key its rows by slot instead of by
 * array index: these are fixed positions a shop fills in, not a list that
 * reorders, and a named key says so.
 */
export const EMERGENCY_LINE_SLOTS = ["one", "two", "three", "four", "five"] as const;

export const MAX_EMERGENCY_LINES = EMERGENCY_LINE_SLOTS.length;

/** Trimmed, empty entries dropped, and bounded — what a save writes. */
export function normalizeEmergencyReference(input: {
  lines: EmergencyContactLine[];
  vessel: string;
  shoreContact: string;
  plan: string;
}): EmergencyReference {
  return {
    // A line needs a number to be worth dialling; a label alone is a note, and
    // this is not the place for notes.
    lines: input.lines
      .map((line) => ({ label: line.label.trim(), phone: line.phone.trim() }))
      .filter((line) => line.phone.length > 0)
      .slice(0, MAX_EMERGENCY_LINES),
    vessel: input.vessel.trim(),
    shoreContact: input.shoreContact.trim(),
    plan: input.plan.trim(),
  };
}

/**
 * **The boat a departure sails on, as a coastguard asks for it** (fourth
 * review, item 11): its name, call sign and MMSI, each off the boat's own row
 * in Settings > Boats. Call sign and MMSI are null when the shop has not typed
 * them.
 */
export type VesselIdentity = {
  name: string;
  callSign: string | null;
  mmsi: string | null;
};

/**
 * The shop's reference as one departure prints it: the shop's own numbers and
 * plan, and the departure's own boat in place of the shop-wide vessel line.
 * `boat` is optional so a snapshot an older build saved offline, which never
 * carried it, still reads as the shop line.
 */
export type DepartureEmergencyReference = EmergencyReference & {
  boat?: VesselIdentity | null;
};

/**
 * **The departure's own boat, the shop line only as the fallback.** The shop's
 * vessel line is one free-text field for the whole fleet, so on a two-boat
 * shop it names the wrong hull on half the departures, and the MMSI read off
 * the card is the other boat's. A departure on a boat prints that boat and
 * drops the shop line; a departure on no boat (a shore day, or one nobody has
 * put on a hull yet) keeps the shop line, which is all there is.
 *
 * **A boat whose row holds neither radio fact keeps the shop line too**
 * (review B1). The two fields arrived empty on every existing boat, and the
 * shop line is where a shop typed its MMSI and working channel; clearing it
 * then would print a card with only a hull name on it until someone found the
 * fields in Settings > Boats, whose hub row names how many are still empty.
 */
export function emergencyReferenceForDeparture(
  reference: EmergencyReference,
  boat: VesselIdentity | null,
): DepartureEmergencyReference {
  if (!boat) return { ...reference, boat: null };
  if (!boat.callSign && !boat.mmsi) return { ...reference, boat };
  return { ...reference, vessel: "", boat };
}

/** The longest call sign a form accepts: ITU call signs run to seven, ship stations to nine. */
export const MAX_CALL_SIGN_LENGTH = 12;

/**
 * A call sign as typed, made what is read over the radio: trimmed, inner runs
 * of space collapsed, upper-cased. Null for an empty box; `"invalid"` for
 * anything past {@link MAX_CALL_SIGN_LENGTH} or holding more than letters,
 * digits, a space or a hyphen, so a typo refuses the save rather than printing.
 */
export function normalizeCallSign(input: string): string | null | "invalid" {
  const value = input.trim().replace(/\s+/g, " ").toUpperCase();
  if (value === "") return null;
  if (value.length > MAX_CALL_SIGN_LENGTH || !/^[A-Z0-9][A-Z0-9 -]*$/.test(value)) {
    return "invalid";
  }
  return value;
}

/**
 * An MMSI as typed: spaces and hyphens a shop copies off a licence are
 * dropped, and what is left must be exactly nine digits (ITU-R M.585). Null
 * for an empty box, `"invalid"` otherwise, matching the column's check.
 */
export function normalizeMmsi(input: string): string | null | "invalid" {
  const value = input.replace(/[\s-]/g, "");
  if (value === "") return null;
  return /^[0-9]{9}$/.test(value) ? value : "invalid";
}

/**
 * Whether the shop has recorded anything at all.
 *
 * Two readers, two answers. The manifest keeps the panel either way and states
 * the absence in words — a silently empty panel is indistinguishable from a
 * shop that has no numbers — but asks for nothing, because its reader is on a
 * boat. Settings' hub row is where the same absence becomes an errand, beside
 * the form that ends it.
 */
export function hasEmergencyReference(reference: EmergencyReference): boolean {
  // The departure's boat is not counted: a hull name is not a number to call,
  // so a card that prints only the boat still states the absence.
  return (
    reference.lines.length > 0 ||
    reference.vessel.length > 0 ||
    reference.shoreContact.length > 0 ||
    reference.plan.length > 0
  );
}

/**
 * **Whether the card carries a number a crew can dial** (fifth loop, item 3).
 * The vessel, the shore contact and the plan are worth having, but a crew at
 * sea reaches for a chamber or a coast guard number first; with none, the card
 * is blank for the question Today's row and the first-run step ask.
 */
export function emergencyCardHasNumbers(reference: Pick<EmergencyReference, "lines">): boolean {
  return reference.lines.some((line) => line.phone.trim().length > 0);
}
