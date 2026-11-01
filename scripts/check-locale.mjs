import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

/**
 * Locale guard contracts (details and ratchet history:
 * `docs/agents/repo-checks.md#locale-coverage`):
 *
 * - UI under `guardedRoots` uses the negotiated locale for date, time and money
 *   formatting; each locale's bundles in `BUNDLES` match keys and ICU placeholders.
 * - Translation parity and identical-value counts are separate checks. The
 *   latter compares string leaves present in both locales, byte-for-byte, per
 *   bundle file. Missing keys are parity failures, not identical values.
 * - Both increases and decreases require an explicit ratchet update. A
 *   `DELIBERATELY_IDENTICAL` entry has a per-key reason and remains checked for
 *   equality; `nothingToTranslate` applies only when all letters are inside
 *   placeholders or rich-text tags.
 * - `check:copy` covers source text not extracted into bundles; rendered-label
 *   declarations in `src/i18n/label-maps.test.ts` make a separate claim.
 * - Legally reviewed waiver and medical wording is excluded from translation
 *   pending H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit, while date formatting remains in scope.
 */

const ROOT = process.cwd();
const LOCALES_DIR = "src/i18n/locales";
const DEFAULT_LOCALE = "en-US";

/**
 * Every message bundle, with the floor below which the bundle is presumed
 * broken rather than merely small. The staff bundle's floor is historical —
 * it started at one key while surfaces migrated off inline English; the
 * migration finished, and `pnpm check:copy` keeps it finished.
 */
const BUNDLES = [
  { file: "diver.json", minimumKeys: 40 },
  // The staff bundle is a directory, one namespace per file, composed by its
  // index.ts (ADR 20260807-per-area-staff-bundles). The single staff.json it
  // replaces was the repo's top merge-conflict magnet — every parallel branch
  // adds staff copy, and one 3,500-line file put every addition in the way of
  // every other. Reading it here means merging the files exactly the way
  // index.ts does: filename = namespace key.
  { dir: "staff", minimumKeys: 1 },
];

/**
 * Rendering code that must never name a locale itself. Scope is the whole UI —
 * `src/app` and `src/components` — not just the public pages: staff read dates
 * too, and a compiled-in `"en-US"` gives them US date order regardless of what
 * their device asks for.
 *
 * `src/lib` and `src/db` are out of scope by design: they *take* a locale as a
 * parameter (`formatShortDate(date, locale, tz)`), and a couple of them use a
 * fixed locale for parsing rather than display (`src/lib/zoned.ts` reads
 * `formatToParts` output, which must not vary).
 */
const guardedRoots = ["src/app", "src/components"];

/**
 * **Keys whose non-default value is the same string on purpose, and why.**
 *
 * Addressed as `<bundle file> <dotted key inside it>` — the two halves
 * `--report` prints, minus the locale its heading carries, because a
 * declaration claims the word is the same in every language and not just in
 * one. Excluded from the ratcheted count and *held* to being identical: if a
 * translator decides one of these does have a Spanish form, the entry fails and
 * the fix is deleting it.
 *
 * A reason per entry, because a blanket rule is how the untranslated-Spanish
 * catch gets given away. These eighteen are the ones issue #1757 examined: the
 * nine agency acronyms, the four rungs of the certification ladder in each of
 * the two bundles that carry it (`rescue` is translated — "Buceador de Rescate"
 * — and is deliberately absent), and "Plan". The other 188 identical values are
 * unexamined and stay in the count.
 *
 * One list for every non-default locale: a key here claims the word is the same
 * in *any* language DiveDay ships, which is true of an acronym and a course
 * name. A third locale that disagrees is a decision, not a merge conflict.
 */
export const DELIBERATELY_IDENTICAL = new Map([
  ["staff/settings.json security.browser.chrome", "browser or operating system brand name"],
  ["staff/settings.json security.browser.edge", "browser or operating system brand name"],
  ["staff/settings.json security.browser.firefox", "browser or operating system brand name"],
  ["staff/settings.json security.browser.opera", "browser or operating system brand name"],
  ["staff/settings.json security.browser.safari", "browser or operating system brand name"],
  ["staff/settings.json security.browser.samsung", "browser or operating system brand name"],
  ["staff/settings.json security.os.android", "browser or operating system brand name"],
  ["staff/settings.json security.os.chromeOs", "browser or operating system brand name"],
  ["staff/settings.json security.os.ios", "browser or operating system brand name"],
  ["staff/settings.json security.os.linux", "browser or operating system brand name"],
  ["staff/settings.json security.os.macOs", "browser or operating system brand name"],
  ["staff/settings.json security.os.windows", "browser or operating system brand name"],

  // Training-agency acronyms — brand names. `other` is the one real word in
  // the group and is translated.
  // The boat's radio identity (fourth review, item 11): the ITU acronym a
  // Spanish-speaking coastguard reads back as "MMSI".
  ["staff/boats.json mmsiLabel", "maritime radio acronym"],
  ["staff/manifest.json emergency.mmsiLabel", "maritime radio acronym"],
  ["diver.json common.certification.agencies.padi", "agency acronym"],
  ["diver.json common.certification.agencies.ssi", "agency acronym"],
  ["diver.json common.certification.agencies.naui", "agency acronym"],
  ["diver.json common.certification.agencies.sdi", "agency acronym"],
  ["diver.json common.certification.agencies.tdi", "agency acronym"],
  ["diver.json common.certification.agencies.cmas", "agency acronym"],
  ["diver.json common.certification.agencies.raid", "agency acronym"],
  ["diver.json common.certification.agencies.gue", "agency acronym"],
  ["diver.json common.certification.agencies.bsac", "agency acronym"],
  ["diver.json common.certification.agencies.nss_cds", "agency acronym"],
  ["diver.json common.certification.agencies.nacd", "agency acronym"],
  ["diver.json common.certification.agencies.iantd", "agency acronym"],
  // The ladder a Spanish-speaking shop names in English, in the diver bundle
  // and again in the staff one (the two never share a string, by design).
  ["diver.json course.certificationLevels.openWater", "course name, used untranslated"],
  ["diver.json course.certificationLevels.advancedOpenWater", "course name, used untranslated"],
  ["diver.json course.certificationLevels.divemaster", "course name, used untranslated"],
  ["diver.json course.certificationLevels.instructor", "course name, used untranslated"],
  ["staff/shared.json readiness.certificationLevels.openWater", "course name, used untranslated"],
  [
    "staff/shared.json readiness.certificationLevels.advancedOpenWater",
    "course name, used untranslated",
  ],
  ["staff/shared.json readiness.certificationLevels.divemaster", "course name, used untranslated"],
  ["staff/shared.json readiness.certificationLevels.instructor", "course name, used untranslated"],
  // Spelled and read the same in Spanish.
  ["staff/incidents.json form.no", "the same word in both languages"],
  // A number and the millimetre symbol, which is SI and the same in Spanish.
  ["staff/gear.json prep.optionThickness", "a number and an SI unit symbol"],
  ["staff/counterRentals.json fill.eanx", "EANx is the gas's international name, then a number"],
  // Examined one by one for issue #1797. Each is a value with no Spanish
  // form to give it: a brand, an acronym, a place, a unit, or a word Spanish
  // diving uses unchanged. Held both ways like every entry above — the day
  // somebody translates one of these, the declaration fails.
  [
    "diver.json marketing.guides.fareharbor.website.rows.row2.theirs",
    "a competitor's own product name",
  ],
  [
    "diver.json marketing.guides.fareharbor.website.rows.row5.theirs",
    "a competitor's own product name",
  ],
  ["staff/divers.json shared.agencies.bsac", "agency acronym"],
  ["staff/divers.json shared.agencies.iantd", "agency acronym"],
  ["staff/divers.json shared.agencies.nacd", "agency acronym"],
  ["staff/divers.json shared.agencies.nss_cds", "agency acronym"],
  ["staff/divers.json shared.agencies.cmas", "agency acronym"],
  ["staff/divers.json shared.agencies.gue", "agency acronym"],
  ["staff/divers.json shared.agencies.naui", "agency acronym"],
  ["staff/divers.json shared.agencies.padi", "agency acronym"],
  ["staff/divers.json shared.agencies.raid", "agency acronym"],
  ["staff/divers.json shared.agencies.sdi", "agency acronym"],
  ["staff/divers.json shared.agencies.ssi", "agency acronym"],
  ["staff/divers.json shared.agencies.tdi", "agency acronym"],
  ["staff/schedule.json builder.courseAgencies.padi", "agency acronym"],
  ["staff/waiversStaff.json record.answerNo", '"No" is the same word in Spanish'],
  ["diver.json marketing.setUp.no", '"No" is the same word in Spanish'],
  ["staff/schedule.json builder.courseAgencies.ssi", "agency acronym"],
  ["diver.json marketing.privacy.processors.awsTerm", "brand"],
  ["diver.json marketing.privacy.processors.googleTerm", "brand"],
  ["diver.json marketing.privacy.processors.metaTerm", "brand"],
  ["diver.json marketing.privacy.processors.anthropicTerm", "brand"],
  ["diver.json marketing.privacy.processors.neonTerm", "brand"],
  ["diver.json marketing.privacy.processors.sentryTerm", "brand"],
  ["diver.json marketing.privacy.processors.stripeTerm", "brand"],
  ["diver.json marketing.privacy.processors.vercelTerm", "brand"],
  ["diver.json rental.itemLabels.gopro", "brand"],
  ["diver.json trip.rentalItems.gopro", "brand"],
  ["diver.json notifications.gearPieces.gopro", "brand"],
  ["staff/inbox.json channel.whatsapp", "brand"],
  ["staff/desk.json lostFound.channels.whatsapp", "brand"],
  ["staff/integrations.json quickbooks.name", "brand"],
  ["staff/integrations.json shopify.name", "brand"],
  ["staff/integrations.json zapier.name", "brand"],
  ["staff/orders.json index.paymentOps.stripeId", "brand"],
  ["staff/settings.json embed.platforms.squarespace.name", "brand"],
  ["staff/settings.json embed.platforms.wix.name", "brand"],
  ["staff/settings.json embed.platforms.wordpress.name", "brand"],
  ["staff/settings.json main.whatsapp.heading", "brand"],
  ["staff/shared.json rentalFit.itemLabels.gopro", "brand"],
  ["staff/today.json actionKind.stuckPaymentOperation", "brand"],
  ["staff/whatsapp.json title", "brand"],
  ["staff/shared.json compass.e", "compass point, the same abbreviation in Spanish"],
  ["staff/shared.json compass.n", "compass point, the same abbreviation in Spanish"],
  ["staff/shared.json compass.ne", "compass point, the same abbreviation in Spanish"],
  ["staff/shared.json compass.s", "compass point, the same abbreviation in Spanish"],
  ["staff/shared.json compass.se", "compass point, the same abbreviation in Spanish"],
  ["staff/integrations.json zapier.webhookPlaceholder", "example URL in a placeholder attribute"],
  [
    "staff/gear.json form.brandModelPlaceholder",
    "example brand and model in a placeholder attribute",
  ],
  [
    "staff/workOrders.json form.brandModelPlaceholder",
    "example brand and model in a placeholder attribute",
  ],
  ["staff/workOrders.json detail.total", "the same word in both languages"],
  ["staff/orders.json new.countryPlaceholder", "example country code in a placeholder attribute"],
  ["staff/diveSites.json form.locationPlaceholder", "example location in a placeholder attribute"],
  ["diver.json inquiry.namePlaceholder", "example name in a placeholder attribute"],
  ["staff/promos.json fields.codePlaceholder", "example promo code in a placeholder attribute"],
  ["staff/diveSites.json form.namePlaceholder", "example site name in a placeholder attribute"],
  [
    "staff/shared.json tripDiveFields.namePlaceholderFirst",
    "example site name in a placeholder attribute",
  ],
  ["staff/divers.json rentalFit.bcdSizePlaceholder", "example size in a placeholder attribute"],
  ["staff/divers.json rentalFit.drysuitSizePlaceholder", "example size in a placeholder attribute"],
  ["staff/divers.json rentalFit.hoodSizePlaceholder", "example size in a placeholder attribute"],
  ["staff/divers.json rentalFit.gloveSizePlaceholder", "example size in a placeholder attribute"],
  ["diver.json rental.hoodSizePlaceholder", "example size in a placeholder attribute"],
  ["diver.json rental.gloveSizePlaceholder", "example size in a placeholder attribute"],
  ["staff/divers.json rentalFit.wetsuitSizePlaceholder", "example size in a placeholder attribute"],
  ["diver.json rental.finSizePlaceholder", "example sizes in a placeholder attribute"],
  ["staff/divers.json rentalFit.finSizePlaceholder", "example sizes in a placeholder attribute"],
  ["staff/gear.json form.sizePlaceholder", "example sizes in a placeholder attribute"],
  ["staff/settings.json embed.platforms.html.name", "format acronym"],
  ["diver.json demo.roles.divemaster.title", "industry rung, not translated in Spanish diving"],
  ["diver.json recap.printSignature", "industry rung, not translated in Spanish diving"],
  ["diver.json trip.crewRole.divemaster", "industry rung, not translated in Spanish diving"],
  [
    "staff/settings.json team.roleLabels.divemaster",
    "industry rung, not translated in Spanish diving",
  ],
  ["staff/trips.json crew.roleDivemaster", "industry rung, not translated in Spanish diving"],
  ["staff/gear.json itemKinds.dpv", "kit acronym, used as-is in Spanish"],
  ["diver.json booking.money.eLearning", "loanword Spanish diving uses"],
  ["staff/reviews.json pulseCategoryBriefing", "loanword Spanish diving uses"],
  ["staff/trips.json phases.checkin", "settled loanword (es-ES README, “Check-in is el check-in”)"],
  [
    "staff/disputeSheet.json checkInHeading",
    "settled loanword (es-ES README, “Check-in is el check-in”)",
  ],
  ["staff/disputeSheet.json total", "the same word in Spanish"],
  [
    "diver.json fallback.phaseCheckin",
    "settled loanword (es-ES README, “Check-in is el check-in”)",
  ],
  [
    "diver.json marketing.featurePages.checkIn.name",
    "settled loanword (es-ES README, “Check-in is el check-in”)",
  ],
  [
    "staff/shared.json shopNavLinks.walkIn",
    "loanword this file already uses (its Spanish reads “Modo mostrador”, “Volver al check-in”)",
  ],
  [
    "staff/backup.json form.bucketLabel",
    "object-storage term this file's own Spanish already uses (“escribir en este bucket”)",
  ],
  [
    "staff/backup.json status.bucket",
    "object-storage term this file's own Spanish already uses (“escribir en este bucket”)",
  ],
  [
    "staff/backup.json form.endpointLabel",
    "object-storage term this file's own Spanish already uses (“sin bucket ni ruta”)",
  ],
  [
    "staff/backup.json status.endpoint",
    "object-storage term this file's own Spanish already uses (“sin bucket ni ruta”)",
  ],
  ["staff/settings.json embed.lookLight", "our own name"],
  ["diver.json account.onboard.timezone.auckland", "place name"],
  ["diver.json account.onboard.timezone.bangkok", "place name"],
  ["diver.json account.onboard.timezone.manila", "place name"],
  ["staff/settings.json main.timezone.zones.auckland", "place name"],
  ["staff/settings.json main.timezone.zones.bangkok", "place name"],
  ["staff/settings.json main.timezone.zones.manila", "place name"],
  ["diver.json account.onboard.timezone.cancun", "place names"],
  ["diver.json account.onboard.timezone.roatan", "place names"],
  ["staff/settings.json main.timezone.zones.cancun", "place names"],
  ["staff/settings.json main.timezone.zones.roatan", "place names"],
  ["diver.json notifications.whatsappTemplate.exampleShopName", "the demo shop's own name"],
  ["diver.json marineLife.species.cobia.name", "the fish's name in Spanish too"],
  ["diver.json marineLife.species.boga.name", "the fish's name in Spanish too"],
  [
    "diver.json marketing.guides.shared.scopeTable.nitrox.what",
    "the gas, and the word Spanish diving uses for it",
  ],
  ["diver.json ready.tanksNitrox", "the gas, and the word Spanish diving uses for it"],
  ["diver.json rental.nitroxLegend", "the gas, and the word Spanish diving uses for it"],
  [
    "diver.json switching.spreadsheet.columns.nitrox.column",
    "the gas, and the word Spanish diving uses for it",
  ],
  ["diver.json trip.requirementMarkerNitrox", "the gas, and the word Spanish diving uses for it"],
  ["staff/diveSites.json form.nitroxCheckbox", "the gas, and the word Spanish diving uses for it"],
  ["staff/diveSites.json list.nitroxBadge", "the gas, and the word Spanish diving uses for it"],
  [
    "staff/divers.json specialty.nitroxAgencyLine",
    "the gas, and the word Spanish diving uses for it",
  ],
  ["staff/divers.json specialty.nitroxLine", "the gas, and the word Spanish diving uses for it"],
  ["staff/divers.json specialty.nitroxOption", "the gas, and the word Spanish diving uses for it"],
  ["staff/orders.json detail.kind.nitrox", "the gas, and the word Spanish diving uses for it"],
  [
    "staff/settings.json import.scopeTable.nitrox.what",
    "the gas, and the word Spanish diving uses for it",
  ],
  [
    "staff/settings.json import.wizard.fieldLabels.nitrox_certified",
    "the gas, and the word Spanish diving uses for it",
  ],
  [
    "staff/settings.json main.rentalPricing.nitroxLabel",
    "the gas, and the word Spanish diving uses for it",
  ],
  [
    "staff/shared.json certificationSummary.nitrox",
    "the gas, and the word Spanish diving uses for it",
  ],
  ["staff/shared.json tripAdmission.nitrox", "the gas, and the word Spanish diving uses for it"],
  ["staff/today.json actionKind.nitroxGate", "the gas, and the word Spanish diving uses for it"],
  ["staff/tripPrep.json nitrox", "the gas, and the word Spanish diving uses for it"],
  ["staff/trips.json requirements.nitrox", "the gas, and the word Spanish diving uses for it"],
  [
    "diver.json notifications.staffReply.reSubject",
    "the mail reply prefix, used unchanged in Spanish",
  ],
  ["diver.json demo.roles.instructor.title", "the same word in Spanish"],
  ["diver.json trip.crewRole.instructor", "the same word in Spanish"],
  ["diver.json waiver.answerNo", "the same word in Spanish"],
  ["staff/diveSites.json form.route.zoomLabel", "the same word in Spanish"],
  ["staff/requests.json flexible", "the same word in Spanish"],
  ["staff/settings.json team.roleLabels.instructor", "the same word in Spanish"],
  ["staff/settings.json team.rolesLegend", "the same word in Spanish"],
  ["staff/tripPrep.json total", "the same word in Spanish"],
  [
    "staff/incidentExport.json executedDiveSurfaceIntervalValue",
    "the unit abbreviation, unchanged in Spanish",
  ],
  ["staff/settings.json main.dockCall.siteOverride", "the unit abbreviation, unchanged in Spanish"],
  ["staff/settings.json main.flySafe.value", "the unit abbreviation, unchanged in Spanish"],
  ["diver.json common.units.feet", "the unit symbol, unchanged in Spanish"],
  ["diver.json common.units.meters", "the unit symbol, unchanged in Spanish"],
  ["diver.json common.units.metersRange", "two depths and the unit symbol, unchanged in Spanish"],
  ["diver.json common.units.feetRange", "two depths and the unit symbol, unchanged in Spanish"],
  ["staff/diveSites.json form.depthPreviewFeetOne", "the unit symbol, unchanged in Spanish"],
  ["staff/diveSites.json form.depthPreviewFeetRange", "two depths and the unit symbol"],
  ["staff/diveSites.json form.depthPreviewMetersOne", "the unit symbol, unchanged in Spanish"],
  ["staff/diveSites.json form.depthPreviewMetersRange", "two depths and the unit symbol"],
  ["diver.json marketing.guides.fareharbor.heroEyebrow", "two product names"],
  ["diver.json marketing.guides.rezdy.heroEyebrow", "two product names"],
  ["staff/settings.json main.units.celsius", "unit name, the same in Spanish"],
  ["staff/settings.json main.units.fahrenheit", "unit name, the same in Spanish"],
  ["staff/shared.json depth.feet", "unit symbol"],
  ["staff/shared.json depth.meters", "unit symbol"],
  ["staff/shared.json temperature.celsius", "unit symbol"],
  ["staff/shared.json temperature.fahrenheit", "unit symbol"],
]);

const sourceExtensions = new Set([".ts", ".tsx"]);
const localeLiteral = /["'`]en-US["'`]/;

async function walk(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (
      sourceExtensions.has(path.extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

/** Every leaf as `dotted.path` → message. */
function flatten(node, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value, dotted));
    else out[dotted] = value;
  }
  return out;
}

/**
 * ICU argument names in a message — `{name}` and the `{count, plural, …}` head
 * alike, and *only* those.
 *
 * The nesting matters. A plural branch body is itself a brace group holding
 * ordinary text (`one {queda #}`), and matching every `{word` in the string
 * reads that text as two more arguments — which fails any translation whose
 * plural forms differ by more than the number, i.e. most of them outside
 * English. Argument names sit at even brace depth (an argument opens at depth
 * 0; its branch bodies open at depth 1; an argument nested inside a body opens
 * at depth 2), so depth is what tells the two apart.
 */
function placeholders(message) {
  const names = [];
  let depth = 0;
  const text = String(message);
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character !== "{") continue;
    if (depth % 2 === 0) {
      const name = /^\s*(\w+)/.exec(text.slice(index + 1));
      if (name) names.push(name[1]);
    }
    depth += 1;
  }
  return names.sort();
}

/**
 * Where a merged bundle key actually lives, so a count and a declaration can
 * name a file rather than a whole directory. The staff bundle is read the way
 * its `index.ts` composes it — filename = first path segment — so splitting
 * that segment back off is exact, not a guess.
 */
export function locateKey(bundle, key) {
  if (bundle.file) return { file: bundle.file, path: key };
  const cut = key.indexOf(".");
  if (cut === -1) return { file: `${bundle.dir}/${key}.json`, path: key };
  return { file: `${bundle.dir}/${key.slice(0, cut)}.json`, path: key.slice(cut + 1) };
}

/**
 * Identical values, per bundle file, and the declarations that no longer hold.
 *
 * `reference` and `bundle` are flattened dotted-path maps for the same bundle
 * in two locales. Only keys present in both with a string on each side are
 * compared; anything else belongs to rule 2, not here.
 */
/**
 * A **simple** ICU argument: `{date}`, `{value}`, `{count, number}` — one that
 * carries no sub-message of its own. `{count, plural, one {# diver} …}` is
 * deliberately not matched: its sub-messages hold real words, and a value that
 * contained one would otherwise be exempted with those words untranslated.
 */
const SIMPLE_ARGUMENT = /\{[^{}]*\}/g;

/**
 * A rich-text tag the renderer consumes — `<diver>…</diver>` in a `t.rich`
 * message. The tag *name* is markup, like an argument name; anything between
 * the tags is not, and still counts.
 */
const RICH_TEXT_TAG = /<\/?[A-Za-z][A-Za-z0-9]*>/;

/**
 * The two together, for one left-to-right pass over a value.
 *
 * **Read between the markup, never strip it out.** The first version of this
 * asked the same question by deleting both patterns and testing what was left,
 * and CodeQL correctly read `value.replace(/<\/?[A-Za-z]\w*>/g, "")` as the
 * shape of an HTML sanitizer — one that `<<diver>diver>` walks straight
 * through, because deleting the inner tag reassembles an outer one. Nothing
 * here is sanitizing anything (the result is thrown away; only "were there
 * letters" survives, and the input is this repository's own message bundles),
 * but a guard whose code is indistinguishable from a broken sanitizer is a
 * guard somebody copies. Scanning the gaps answers the question without ever
 * producing a "cleaned" string for anyone to trust.
 */
const MARKUP = new RegExp(`${SIMPLE_ARGUMENT.source}|${RICH_TEXT_TAG.source}`, "g");

/**
 * Whether a value has nothing in it to translate.
 *
 * **The one structural exemption, and it is not a blanket one** (issue #1797).
 * Roughly a quarter of the identical values are a template and nothing else —
 * `"{date} · {trip}"`, `"{tripTitle}"`, `"“{words}”"`, `"{count, number}"`.
 * There is no Spanish form of those, because there is no word in them: what
 * would be translated is a middle dot. Declaring forty of them by hand is
 * honest and says nothing, and the reason would be the same sentence forty
 * times.
 *
 * What keeps it from being the blanket exemption `DELIBERATELY_IDENTICAL`
 * exists to avoid is that it is **decidable and self-revoking**. A value
 * qualifies only when every letter in it sits inside a simple argument, so
 * `"Re: {subject}"` and `"{value} ft"` do not — and the moment anybody adds a
 * word to one of these templates it stops qualifying and has to be translated
 * or declared by name. It cannot hide an English sentence, because a sentence
 * has letters.
 *
 * Sub-messages are excluded above for the same reason, so a plural whose
 * branches are English is still counted, and rich-text tag *names* are dropped
 * with the arguments while everything between the tags is kept.
 */
export function nothingToTranslate(value) {
  if (/\{[^{}]*\{/.test(value)) return false;
  let readFrom = 0;
  for (const match of value.matchAll(MARKUP)) {
    if (hasALetter(value.slice(readFrom, match.index))) return false;
    readFrom = match.index + match[0].length;
  }
  return !hasALetter(value.slice(readFrom));
}

const hasALetter = (text) => /\p{Letter}/u.test(text);

export function compareValues(bundle, reference, other, declared = DELIBERATELY_IDENTICAL) {
  const identical = new Map();
  const stale = [];
  for (const [key, value] of Object.entries(reference)) {
    if (typeof value !== "string") continue;
    const theirs = other[key];
    if (typeof theirs !== "string") continue;
    const { file, path: inFile } = locateKey(bundle, key);
    const address = `${file} ${inFile}`;
    if (theirs === value) {
      if (declared.has(address)) continue;
      if (nothingToTranslate(value)) continue;
      const hits = identical.get(file) ?? [];
      hits.push(inFile);
      identical.set(file, hits);
      continue;
    }
    if (declared.has(address)) {
      stale.push(
        `${address}: declared identical (${declared.get(address)}) but the two locales differ now — delete the entry`,
      );
    }
  }
  return { identical, stale };
}

/**
 * The ratchet. Exactly `check-architecture.mjs`'s `auditBaseline` shape: a file
 * with no entry fails, a count that rose fails, a count that fell fails until
 * it is banked, and an entry for a file that is clean or gone fails. Both
 * directions, so the baseline always describes what is on disk.
 */
export function auditIdenticalBaseline(counts, baselineCounts, baselineExists = true) {
  if (!baselineExists) return [];
  const failures = [];
  for (const [file, count] of counts) {
    const allowed = baselineCounts[file];
    if (allowed === undefined) {
      failures.push(
        `${file}: ${count} es-ES value${count === 1 ? "" : "s"} identical to the English, in a file with no baseline entry`,
      );
      continue;
    }
    if (count > allowed) {
      failures.push(
        `${file}: ${count} identical values, baseline allows ${allowed}. Translate the string rather than raising the number — or, if it is a brand, an acronym or a course name, add it to DELIBERATELY_IDENTICAL in scripts/check-locale.mjs with its reason.`,
      );
    }
    if (count < allowed) {
      failures.push(
        `${file}: down to ${count} from ${allowed}. Lower the baseline in this change (\`node scripts/check-locale.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baselineCounts)) {
    if (!counts.has(file)) {
      failures.push(
        `${file}: no identical values left, or the file is gone. Remove its baseline entry (\`node scripts/check-locale.mjs --write\`).`,
      );
    }
  }
  return failures;
}

async function main() {
  const violations = [];

  for (const root of guardedRoots) {
    for (const file of await walk(root)) {
      const contents = await readFile(path.join(ROOT, file), "utf8");
      contents.split("\n").forEach((line, index) => {
        if (localeLiteral.test(line)) {
          violations.push(`${file}:${index + 1}: hard-coded locale — ${line.trim()}`);
        }
      });
    }
  }

  const locales = (await readdir(path.join(ROOT, LOCALES_DIR), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // Rule 3's per-file counts, keyed `<locale>/<bundle file>` so a third locale
  // gets its own lines rather than sharing es-ES's.
  const identicalCounts = new Map();
  const identicalKeys = new Map();

  if (!locales.includes(DEFAULT_LOCALE)) {
    violations.push(`${LOCALES_DIR}: no ${DEFAULT_LOCALE} bundle`);
  } else {
    for (const bundle of BUNDLES) {
      const { file, dir, minimumKeys } = bundle;
      const label = file ?? `${dir}/`;
      const namespaceFiles = async (locale) =>
        (await readdir(path.join(ROOT, LOCALES_DIR, locale, dir)))
          .filter((name) => name.endsWith(".json"))
          .sort();
      const read = async (locale) => {
        if (file) {
          return flatten(
            JSON.parse(await readFile(path.join(ROOT, LOCALES_DIR, locale, file), "utf8")),
          );
        }
        const merged = {};
        for (const name of await namespaceFiles(locale)) {
          merged[name.replace(/\.json$/, "")] = JSON.parse(
            await readFile(path.join(ROOT, LOCALES_DIR, locale, dir, name), "utf8"),
          );
        }
        return flatten(merged);
      };

      if (dir) {
        // Directory-bundle integrity: the same namespace files in every locale,
        // and every file actually composed by each locale's index.ts — an
        // orphaned <namespace>.json would otherwise sit unshipped forever while
        // reading as "translated".
        const referenceFiles = await namespaceFiles(DEFAULT_LOCALE);
        for (const locale of locales.filter((name) => name !== DEFAULT_LOCALE)) {
          const files = await namespaceFiles(locale);
          for (const name of referenceFiles.filter((n) => !files.includes(n)))
            violations.push(`${locale}/${dir}: missing namespace file ${name}`);
          for (const name of files.filter((n) => !referenceFiles.includes(n)))
            violations.push(
              `${locale}/${dir}: stray namespace file ${name} not in ${DEFAULT_LOCALE}`,
            );
        }
        for (const locale of locales) {
          // index.ts is part of the contract now, so its absence is a violation
          // to report alongside the rest, not a crash that hides them.
          let index;
          try {
            index = await readFile(path.join(ROOT, LOCALES_DIR, locale, dir, "index.ts"), "utf8");
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
            violations.push(`${locale}/${dir}: missing index.ts — nothing composes the bundle`);
            continue;
          }
          for (const name of await namespaceFiles(locale)) {
            if (!index.includes(`"./${name}"`))
              violations.push(
                `${locale}/${dir}/index.ts: ${name} exists but is never imported — the namespace would silently not ship`,
              );
          }
        }
      }

      const reference = await read(DEFAULT_LOCALE);
      const referenceKeys = Object.keys(reference);
      if (referenceKeys.length < minimumKeys) {
        violations.push(
          `${LOCALES_DIR}/${DEFAULT_LOCALE}/${label}: only ${referenceKeys.length} messages — expected at least ${minimumKeys}`,
        );
      }

      for (const locale of locales.filter((name) => name !== DEFAULT_LOCALE)) {
        const other = await read(locale);
        for (const key of referenceKeys) {
          if (!other[key]?.trim()) {
            violations.push(`${locale}/${label}: missing "${key}"`);
            continue;
          }
          const expected = placeholders(reference[key]).join(",");
          const actual = placeholders(other[key]).join(",");
          if (expected !== actual) {
            violations.push(
              `${locale}/${label}: "${key}" uses [${actual}], expected [${expected}]`,
            );
          }
        }
        for (const key of Object.keys(other)) {
          if (!(key in reference))
            violations.push(`${locale}/${label}: stray "${key}" not in ${DEFAULT_LOCALE}`);
        }

        const { identical, stale } = compareValues(bundle, reference, other);
        violations.push(...stale.map((entry) => `${locale}/${entry}`));
        for (const [bundleFile, keys] of identical) {
          identicalCounts.set(`${locale}/${bundleFile}`, keys.length);
          identicalKeys.set(`${locale}/${bundleFile}`, keys.sort());
        }
      }
    }
  }

  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex !== -1) {
    const prefix = process.argv[reportIndex + 1] ?? "";
    let shown = 0;
    for (const [file, keys] of [...identicalKeys.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (!file.startsWith(prefix)) continue;
      console.log(`\n${file} (${keys.length})`);
      for (const key of keys) console.log(`  ${key}`);
      shown += keys.length;
    }
    console.log(
      `\n${shown} undeclared identical value${shown === 1 ? "" : "s"} under "${prefix || LOCALES_DIR}", plus ${DELIBERATELY_IDENTICAL.size} declared in scripts/check-locale.mjs`,
    );
    process.exit(0);
  }

  const { counts: baselineCounts, exists: baselineExists } = await readCounts(ROOT, "locale");
  const { write, absorb } = ratchetFlags();
  if (write || absorb !== null) {
    process.exit(
      await bankCounts({
        root: ROOT,
        guard: "locale",
        counts: identicalCounts,
        allowed: baselineCounts,
        exists: baselineExists,
        note: "Undeclared es-ES values still byte-identical to their en-US counterpart, per bundle file. Written by `node scripts/check-locale.mjs --write`. This number may only go down, and it will never reach zero — the acronyms, the course-name ladder and the placeholder-only templates are the same string in Spanish on purpose. See scripts/check-locale.mjs and docs/agents/repo-checks.md.",
        refusal:
          "Translate the string, or declare it in DELIBERATELY_IDENTICAL with its reason if it is a brand, an acronym or a course name",
        absorb,
        summary: (files, total) => `${files} files, ${total} identical`,
      }),
    );
  }

  violations.push(...auditIdenticalBaseline(identicalCounts, baselineCounts, baselineExists));

  if (violations.length > 0) {
    console.error(`Localization violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    console.error(
      "Pages format for the negotiated request locale and read copy from src/i18n/locales/<locale>/ (diver.json, staff/<namespace>.json); every message needs every locale, in that locale's own words. `node scripts/check-locale.mjs --report [prefix]` lists every value still identical to the English.",
    );
    process.exit(1);
  }

  const identical = [...identicalCounts.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `locale: no compiled-in locales, ${BUNDLES.map((b) => b.file ?? `${b.dir}/`).join(" + ")} are fully translated, and ${identical} value${identical === 1 ? "" : "s"} still read as English (baseline)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
