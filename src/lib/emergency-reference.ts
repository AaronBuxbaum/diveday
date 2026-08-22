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
 * Whether the shop has recorded anything at all.
 *
 * The manifest asks staff to fill it in when this is false rather than
 * rendering nothing: a silently empty panel is indistinguishable from a shop
 * that has no numbers, and getting shops to fill it in is the entire value.
 */
export function hasEmergencyReference(reference: EmergencyReference): boolean {
  return (
    reference.lines.length > 0 ||
    reference.vessel.length > 0 ||
    reference.shoreContact.length > 0 ||
    reference.plan.length > 0
  );
}

/**
 * A `tel:` href for a number a shop typed.
 *
 * Strips everything a dialler does not use — spaces, brackets, dots, dashes —
 * while keeping a leading `+` and any `,`/`;` pause a shop wrote for an
 * extension. The point is one tap while holding somebody's regulator, so the
 * displayed text stays exactly as the shop wrote it and only the href is
 * normalized.
 */
export function telHref(phone: string): string | null {
  const trimmed = phone.trim();
  // **A tap must dial what is written, or nothing.**
  //
  // Stripping the non-dialable characters and asking only whether three digits
  // survived turned every mixed value into a confidently wrong link:
  // `VHF 16 / 22A` became `tel:1622`, `Ch 16 (MMSI 338055501)` became
  // `tel:16338055501`, `1-800-DIVE-911` became `tel:1800911`, and
  // `Chamber 305-555-0177 ext 4` became `tel:30555501774`. The seeded shop
  // already writes `Mantis II - VHF 16, MMSI 338055501` into this shape, so it
  // is the expected data, not an edge case — and this module's own docblock
  // says a wrong number here is worse than an empty one. On a boat it is the
  // seconds this card exists to save (`code-reviewer`, after issue #688).
  //
  // So the *whole* value has to look like a dialable number: an optional
  // leading `+`, digits, and the separators a real number carries — spaces,
  // dashes, dots, brackets, and a pause/wait/DTMF tail. Anything with a letter,
  // a slash, a comma between two numbers, or a second `+` is prose, and prose
  // renders as text beside a number nobody can tap by mistake.
  if (!/^\+?[\d\s().-]*[\d][\d\s().-]*[,;*#\d]*$/.test(trimmed)) return null;
  const dialled = trimmed.replace(/[^\d+,;*#]/g, "");
  const digits = dialled.replace(/\D/g, "");
  // Two digits is not a phone number; some emergency short codes are three
  // (112, 911, 999), so the floor sits just below them.
  return digits.length >= 3 ? `tel:${dialled}` : null;
}
