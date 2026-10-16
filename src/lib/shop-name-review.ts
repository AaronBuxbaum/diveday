/**
 * **Whether a shop name could pass for someone else in a mail client's From
 * column** (issue #2450, Aaron's decision of 2026-10-16: a denylist of brand and
 * trust words, checked at sign-up and rename).
 *
 * Shop mail leads with the shop's name, "{Shop} via DiveDay", from DiveDay's own
 * verified domain. `encodeDisplayName` already stops a name injecting a header or
 * faking the address, but a shop called "PayPal Security" still sends as that. A
 * match here does not refuse the name: it flags the shop for a human, and until
 * one clears it the shop's mail goes out under the plain "DiveDay" display name
 * (`fromAddressFor`). A shop is never blocked from signing up over a word.
 *
 * Pure, with no list in the database: the words are a short, reviewable
 * constant. Folded before it looks, so the cheap disguises do not work: case,
 * accents, full-width letters, zero-width characters, look-alike Cyrillic and
 * Greek letters, digits and symbols standing in for letters ("Paypa1",
 * "Amaz0n"), and punctuation or spaces cut into a word ("P a y P a l",
 * "Sup.port"). It will flag real names that read like these words ("Silver Bank
 * Whale Divers", "Apple Bay Divers"); that is accepted, since the cost of a
 * false flag is a plain sender name until someone clears it.
 */

/** Distinctive brands, matched anywhere in the name with every gap removed. */
const BRANDS_ANYWHERE = [
  "paypal",
  "venmo",
  "coinbase",
  "binance",
  "docusign",
  "microsoft",
  "facebook",
  "instagram",
  "whatsapp",
  "netflix",
  "amazon",
  "google",
  "wellsfargo",
  "bankofamerica",
  "citibank",
  "mastercard",
  "americanexpress",
  "diveday",
];

/** Short or common-word brands, matched only as a whole word. */
const BRAND_WORDS = new Set([
  "apple",
  "stripe",
  "chase",
  "visa",
  "amex",
  "irs",
  "dhl",
  "fedex",
  "usps",
  "ups",
  "ebay",
  "meta",
  "hsbc",
  "citi",
  "zelle",
  "dropbox",
]);

/** Words that dress a name as an institution or a department, matched as whole words. */
const TRUST_WORDS = new Set([
  "security",
  "support",
  "bank",
  "banking",
  "billing",
  "payment",
  "payments",
  "invoice",
  "refund",
  "refunds",
  "fraud",
  "verification",
  "verify",
  "official",
  "admin",
  "administrator",
  "helpdesk",
]);

/** Trust phrases of more than one word. */
const TRUST_PHRASES = [" customer service ", " help desk ", " account team ", " account services "];

/** Letters from other scripts that look like a Latin one. */
const LOOKALIKES: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ο: "o",
  ρ: "p",
  α: "a",
  ν: "v",
  τ: "t",
  ι: "i",
  κ: "k",
};

/** Digits and symbols typed in place of a letter. `1` is `l` or `i`, so both are tried. */
const STAND_INS: Record<string, string> = {
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

// biome-ignore lint/suspicious/noMisleadingCharacterClass: removing combining marks and invisible characters is the point.
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const COMBINING = /[̀-ͯ]/g;

function fold(name: string): string {
  const plain = name.replace(INVISIBLE, "").normalize("NFKD").replace(COMBINING, "").toLowerCase();
  let out = "";
  for (const char of plain) out += LOOKALIKES[char] ?? char;
  return out;
}

function standIns(text: string, one: "l" | "i"): string {
  let out = "";
  for (const char of text) out += char === "1" ? one : (STAND_INS[char] ?? char);
  return out;
}

function reads(text: string): boolean {
  const squashed = text.replace(/[^a-z0-9]+/g, "");
  if (BRANDS_ANYWHERE.some((brand) => squashed.includes(brand))) return true;
  // Whole words twice: with punctuation as a gap ("pay-pal"), and with
  // punctuation removed ("sup.port").
  const spaced = text.replace(/[^a-z0-9]+/g, " ").trim();
  const joined = text
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const form of [spaced, joined]) {
    for (const word of form.split(" ")) {
      if (BRAND_WORDS.has(word) || TRUST_WORDS.has(word)) return true;
    }
    if (TRUST_PHRASES.some((phrase) => ` ${form} `.includes(phrase))) return true;
  }
  return false;
}

export function shopNameNeedsReview(name: string): boolean {
  const folded = fold(name);
  return reads(standIns(folded, "l")) || reads(standIns(folded, "i"));
}

/**
 * Whether a shop's mail must go out under the plain "DiveDay" name right now:
 * its name was flagged, and no human has cleared that flag since. A flag newer
 * than the clearing (a later rename that matched again) holds again.
 */
export function shopNameUnderReview(shop: {
  nameFlaggedAt: Date | null;
  nameClearedAt: Date | null;
}): boolean {
  if (!shop.nameFlaggedAt) return false;
  return !shop.nameClearedAt || shop.nameClearedAt.getTime() < shop.nameFlaggedAt.getTime();
}
