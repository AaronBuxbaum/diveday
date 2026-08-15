/**
 * **Does this look like a certification card number at all?**
 *
 * One question, asked at the one place a diver's *claim* becomes the shop's
 * *evidence*: the card sighting on the diver record, where a staffer says they
 * are holding the physical card and types what is printed on it
 * (`certifications.selfDeclaredAt`, ADR 20260814-self-declared-cards). Until
 * this existed that field was bounded only by 2–120 characters, so **"xx"**
 * promoted a stranger's typed "Instructor" to `verified` — the state readiness,
 * trip admission, every course prerequisite and the nitrox fill gate read.
 *
 * The check is deliberately **loose**, because agency card numbers genuinely
 * vary: PADI is a run of digits, SSI mixes letters and digits, and shops
 * transcribe them with hyphens, spaces, slashes and the odd `#`. Two properties
 * are all that is asserted, and both are about a human typing something rather
 * than nothing:
 *
 * 1. **At least {@link MIN_CARD_NUMBER_LENGTH} characters** once trimmed. Three
 *    and not four: no agency issues a two-character number, but old BSAC and
 *    CMAS-federation member numbers do reach down to three, and refusing a real
 *    card is the expensive direction (below). "xx", "ok" and "-" do not survive.
 * 2. **At least one digit.** Every agency's number carries them, and it is what
 *    separates a transcribed card from a word — "none", "n/a", "asdf", "same",
 *    the four things a hurried person types into a required box.
 *
 * What it is emphatically **not** is an agency-format table. A per-agency regex
 * would refuse a real card the moment an agency changed its numbering or a shop
 * met a card from a body DiveDay has never seen, and a staffer holding a
 * genuine card who cannot record it is pushed toward the one thing this whole
 * feature exists to prevent: deciding at the rail, off the diver's word.
 *
 * **It is a typo filter, not proof.** "1234" passes, and nothing downstream may
 * ever cite this as evidence that a number is real — the agency lookup a
 * staffer does before certifying is the evidence, and this only stops the box
 * being filled with something that was never on a card at all.
 *
 * Framework-free and returns a boolean, never a sentence: the words a refusal
 * gets belong to the UI (src/i18n).
 */

/** Shortest thing that can plausibly be a card number, in trimmed characters. */
export const MIN_CARD_NUMBER_LENGTH = 3;

/** Longest, mirroring the column's own bound on the capture forms. */
export const MAX_CARD_NUMBER_LENGTH = 120;

/**
 * The same two properties as an HTML `pattern`, so the browser can refuse a
 * typo **without a round trip**.
 *
 * This is not a second opinion — the server check below is the gate, and a
 * hand-built post never sees this. It is there because a server refusal on this
 * particular form costs more than the sentence it delivers: the sighting lives
 * in a `<details>` that a redirect re-collapses, and the agency and level the
 * staffer picked go with it. Refusing in the box keeps every value where it was
 * typed and puts the cursor back on the one that was wrong.
 *
 * Deliberately **weaker** than {@link isPlausibleCardNumber}, never stricter:
 * it cannot trim, so it counts raw characters, and the upper bound is left off
 * entirely. Anything this refuses the server refuses too; the reverse is
 * allowed and simply arrives as the ordinary refusal. A browser that cannot
 * compile it ignores the attribute, which is the same outcome.
 */
export const CARD_NUMBER_INPUT_PATTERN = `(?=[\\s\\S]*\\p{Nd})[\\s\\S]{${MIN_CARD_NUMBER_LENGTH},}`;

export function isPlausibleCardNumber(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < MIN_CARD_NUMBER_LENGTH) return false;
  if (trimmed.length > MAX_CARD_NUMBER_LENGTH) return false;
  // Unicode-aware: `\d` alone would miss a number typed on a keyboard whose
  // digits are not ASCII, and refusing that staffer's real card is the failure
  // mode this file's docstring argues against.
  return /\p{Nd}/u.test(trimmed);
}
