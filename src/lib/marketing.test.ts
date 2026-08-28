import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { earlyAccessPrice, earlyAccessPriceAmount, midSeasonCutover } from "./marketing";

describe("earlyAccessPriceAmount", () => {
  // JSON-LD offers need a bare number; it must stay a derivation of the one
  // price source, never drift into a second hand-written figure.
  it("derives a bare numeric amount from the single price source", () => {
    expect(earlyAccessPriceAmount).toMatch(/^\d+(\.\d+)?$/);
    expect(earlyAccessPrice.price).toContain(earlyAccessPriceAmount);
  });
});

/** Every `marketing.*` leaf in one locale, as `dotted.path` → message. */
function marketingMessages(locale: (typeof DIVER_LOCALES)[number]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
    } else {
      out[path] = String(node);
    }
  };
  walk(DIVER_MESSAGES[locale].marketing, "marketing");
  return out;
}

/**
 * H-12's single-source rule, enforced where it is easiest to break it: the
 * message bundles. `earlyAccessPrice.price` is the one place the figure exists
 * (docs/product/marketing.md, "The price renders only from src/lib/marketing.ts"),
 * so a sentence that shows it must interpolate it — a bundle that spells the
 * number out reads correctly the day it is written and is a stale claim the day
 * the price moves, in a file no pricing change would think to open.
 *
 * The rule got its test when the flat price reached the homepage hero
 * (docs/product/marketing-review-20260827.md, "The price reaches the first
 * screen"): the number now renders on two bands of `/` rather than one, and
 * both render it the same way.
 */
describe("the price is interpolated, never spelled out in a bundle", () => {
  /**
   * The sentences that carry the figure: the hero and the closing band of `/`,
   * and — since 2026-08-28 — `/product`'s money band, whose link stopped
   * parking the number behind itself and now states it in its own words
   * (docs/product/marketing-review-20260827.md, "the dare gets a door").
   * Each addition here is the point: a fourth surface that shows the price
   * must interpolate it or this list is where it fails.
   */
  const priceSentenceKeys = [
    "marketing.home.heroPriceLine",
    "marketing.home.priceLine",
    "marketing.product.pricingLink",
  ] as const;

  for (const locale of DIVER_LOCALES) {
    it(`keeps every marketing message in ${locale} free of a currency figure`, () => {
      const offenders = Object.entries(marketingMessages(locale))
        .filter(
          ([, message]) =>
            message.includes(earlyAccessPrice.price) ||
            message.includes(earlyAccessPriceAmount) ||
            /\p{Sc}\s?\d/u.test(message),
        )
        .map(([key]) => key);
      expect(offenders).toEqual([]);
    });

    it(`renders the price through {price} and {cadence} in ${locale}`, () => {
      const messages = marketingMessages(locale);
      for (const key of priceSentenceKeys) {
        expect(messages[key]).toBeDefined();
        expect(messages[key]).toContain("{price}");
        expect(messages[key]).toContain("{cadence}");
      }
    });
  }
});

/**
 * One claim at two lengths: the switching guides walk the mid-season move as
 * the four phases of `guides.shared.cutover.*`, and the homepage's records
 * band compresses the same promise into one sentence. That sentence is a key
 * in the guides' namespace rather than a homepage wording of the same thing
 * (docs/product/marketing.md, "A claim used on more than one page belongs in
 * src/lib/marketing.ts as a shared *key*"). These pin both halves: where the
 * key lives, and that no `marketing.home.*` message duplicates it.
 */
describe("the mid-season answer is one shared key", () => {
  it("lives in the guides' cutover namespace, beside the steps it compresses", () => {
    expect(midSeasonCutover.claimKey).toMatch(/^marketing\.guides\.shared\.cutover\./);
  });

  for (const locale of DIVER_LOCALES) {
    it(`resolves to a sentence in ${locale}`, () => {
      const message = marketingMessages(locale)[midSeasonCutover.claimKey];
      expect(message).toBeDefined();
      expect(message.length).toBeGreaterThan(40);
    });
  }

  /**
   * The silence this claim depends on: no `marketing.home.*` message may
   * restate it. A homepage wording of the same promise is exactly what the
   * shared key exists to stop, and it would drift the first time the cutover
   * steps were edited — the failure mode marketing.md names one namespace
   * over for the export claim ("Never let a surface restate the export claim
   * in its own words").
   */
  for (const locale of DIVER_LOCALES) {
    it(`is not restated by a homepage message in ${locale}`, () => {
      const messages = marketingMessages(locale);
      const shared = messages[midSeasonCutover.claimKey];
      const restatements = Object.entries(messages)
        .filter(([key]) => key.startsWith("marketing.home."))
        .filter(([, message]) => message === shared)
        .map(([key]) => key);
      expect(restatements).toEqual([]);
    });
  }
});

/**
 * The pricing page's terms, pinned as rules rather than sentences
 * (docs/product/marketing-review-20260827.md, "the terms never stand at the
 * doors" — roadmap slice 12c). Every assertion here is a claims-policy
 * obligation: the trial note has to say the four things a burned buyer is
 * actually asking, and it has to say nothing beyond them, because billing
 * cadence, taxes and the contract flow are still undecided (H-12).
 */
describe("the trial's terms stand at the pricing doors", () => {
  /** What the note must name, in each locale's own words. */
  const trialTerms = {
    "en-US": [/free/i, /3 weeks/, /no card/i, /nothing switches off/i],
    "es-ES": [/gratis/i, /3 semanas/, /sin tarjeta/i, /nada se apaga/i],
  } as const;

  /**
   * Billing vocabulary the page may not grow on its own. The rule is not "never
   * say these words" — `faq.trialMeaning` is allowed to, and does — it is that
   * the note at the door may not introduce a billing term the FAQ row has not
   * already committed to. Publishing billing terms through a new channel needs
   * the decision H-12 leaves open.
   */
  const billingVocabulary = {
    "en-US": [
      "renew",
      "invoice",
      "bill",
      "charge",
      "card",
      "subscription",
      "contract",
      "refund",
      "prorat",
      "tax",
      "cancel",
      "per seat",
    ],
    "es-ES": [
      "renov",
      "factura",
      "cobr",
      "tarjeta",
      "suscripción",
      "contrato",
      "reembolso",
      "prorrate",
      "impuesto",
      "cancel",
      "por plaza",
    ],
  } as const;

  for (const locale of DIVER_LOCALES) {
    it(`names free, three weeks, no card and the soft expiry in ${locale}`, () => {
      const note = marketingMessages(locale)["marketing.pricing.trialNote"];
      expect(note).toBeDefined();
      for (const pattern of trialTerms[locale]) expect(note).toMatch(pattern);
    });

    it(`invents no billing term the trial FAQ row has not already made in ${locale}`, () => {
      const messages = marketingMessages(locale);
      const note = messages["marketing.pricing.trialNote"].toLowerCase();
      const answer = messages["marketing.pricing.faq.trialMeaning.answer"].toLowerCase();
      const invented = billingVocabulary[locale].filter(
        (term) => note.includes(term) && !answer.includes(term),
      );
      expect(invented).toEqual([]);
    });

    it(`states the soft expiry the code actually implements in ${locale}`, () => {
      // src/lib/trial.ts: expiry blocks no route and no mutation, so "nothing
      // switches off" is a description of behaviour, not a reassurance.
      const answer = marketingMessages(locale)["marketing.pricing.faq.trialMeaning.answer"];
      expect(answer).toMatch(locale === "en-US" ? /keeps working/i : /sigue funcionando/i);
    });

    /**
     * The lock moved under the figure, so the included list stops inventorying
     * it — the silence is the point. `item5` carried "locked for two years"
     * while `lockNote` and `faq.whyFounding` said it too; three renderings of
     * one binding commercial commitment is three places to drift. The stub
     * `item5` was left behind ("no surprise increases…") went entirely on
     * 2026-08-28, so this now sweeps the whole rendered list rather than the
     * one key that used to carry the claim.
     */
    it(`states the two-year lock under the figure and not in the included list in ${locale}`, () => {
      const messages = marketingMessages(locale);
      const lock = locale === "en-US" ? /two years/i : /dos años/i;
      expect(messages["marketing.pricing.lockNote"]).toMatch(lock);
      for (const key of earlyAccessPrice.includedKeys) {
        expect(messages[key], key).not.toMatch(lock);
      }
    });

    /**
     * And the stub itself is gone rather than reworded — an absence check,
     * because the failure it guards is a future editor filling `item5` back in
     * with the founding-cohort rationale `faq.whyFounding` already carries.
     */
    it(`carries no retired sixth included item in ${locale}`, () => {
      expect(marketingMessages(locale)["marketing.price.item5"]).toBeUndefined();
    });

    /**
     * The lock's subject. Fine print under a figure is where a burned buyer
     * looks for the catch, and a subjectless "Locked for two years" lets them
     * read themselves as the thing locked — on the page whose next band argues
     * they can leave any day. The sentence must name what is locked.
     */
    it(`names the price as the thing that is locked in ${locale}`, () => {
      const note = marketingMessages(locale)["marketing.pricing.lockNote"];
      expect(note).toMatch(locale === "en-US" ? /price/i : /precio/i);
    });
  }
});

/**
 * The importer's preview is said once. `faq.setupTime` and `faq.switching` are
 * index 4 and index 6 of a row-major two-column grid — vertically adjacent in
 * the left column, about 200px apart — and both used to close on the same
 * promise that the importer shows you what will happen before anything is
 * saved. The time question gives ground, because its strongest content is the
 * six fields and the shop existing on submit; the switching question keeps the
 * preview, which is the objection it exists to answer. Both rows still stand
 * alone, which the `FAQPage` structured data requires.
 */
describe("the pricing FAQ promises the import preview once", () => {
  const preview = {
    "en-US": /before anything is saved/i,
    "es-ES": /antes de guardar nada/i,
  } as const;

  for (const locale of DIVER_LOCALES) {
    it(`keeps the preview clause in the switching row in ${locale}`, () => {
      const answer = marketingMessages(locale)["marketing.pricing.faq.switching.answer"];
      expect(answer).toMatch(preview[locale]);
    });

    it(`leaves it out of the setup-time row stacked above it in ${locale}`, () => {
      const answer = marketingMessages(locale)["marketing.pricing.faq.setupTime.answer"];
      expect(answer).toBeDefined();
      expect(answer).not.toMatch(preview[locale]);
    });
  }
});

/**
 * `feesNote` names the one cost the flat price does not cover — processing fees,
 * which stay with the shop's own provider — and stops there. Its second
 * sentence ("if an integration ever costs extra, we'll say so before you turn
 * it on") went on 2026-08-28: a promise about a charge that does not exist,
 * printed under "What the price covers" directly beneath four negations, which
 * manufactures the doubt it then answers. The silence is the assertion.
 */
describe("the fee footnote raises no charge that does not exist", () => {
  const futureCharge = {
    "en-US": /costs? extra|charge you extra|additional (?:cost|charge|fee)/i,
    "es-ES": /coste adicional|cargo adicional|cobro adicional/i,
  } as const;

  for (const locale of DIVER_LOCALES) {
    it(`names processing fees and nothing further in ${locale}`, () => {
      const note = marketingMessages(locale)["marketing.pricing.feesNote"];
      expect(note).toBeDefined();
      expect(note).toMatch(locale === "en-US" ? /processing fees/i : /procesamiento de pagos/i);
      expect(note).not.toMatch(futureCharge[locale]);
    });
  }
});

/**
 * The offline row left `/pricing` on 2026-08-28 — a product question wearing
 * pricing clothes. A cut copy is only honest if the claim still has a home, so
 * this pins both halves: the pricing key is gone, and `/product`'s dock note
 * still carries the sentence the row was made of.
 */
describe("the manifest's offline answer lives on /product alone", () => {
  for (const locale of DIVER_LOCALES) {
    it(`carries no offline FAQ row on the pricing page in ${locale}`, () => {
      const messages = marketingMessages(locale);
      const orphans = Object.keys(messages).filter((key) =>
        key.startsWith("marketing.pricing.faq.offline"),
      );
      expect(orphans).toEqual([]);
    });

    it(`still answers it beside the screen it is about in ${locale}`, () => {
      const note = marketingMessages(locale)["marketing.product.dockNote"];
      expect(note).toBeDefined();
      expect(note).toMatch(locale === "en-US" ? /saves the manifest/i : /guarda el listado/i);
    });
  }
});

/**
 * The fee anchor is the one place marketing.md lets a rival be named, and it is
 * bounded hard: FareHarbor publishes no rate, so the figure must stay reported
 * and attributed rather than presented as their price. The 2026-08-28 rewrite
 * broke the row's semicolon run into breath units; these pin the two things
 * that rewrite was not allowed to lose. The attribution matches
 * case-insensitively because the row now *opens* its last unit on it — the
 * second "the size of it is unpublished" announcement went, since the row's
 * first four words already say so — and where a clause falls in a sentence is
 * not what this is pinning.
 */
describe("the fee anchor reports an unpublished rate as unpublished", () => {
  for (const locale of DIVER_LOCALES) {
    it(`says FareHarbor publishes nothing in ${locale}`, () => {
      const row = marketingMessages(locale)["marketing.pricing.feeAnchor.fareharbor"];
      expect(row).toMatch(locale === "en-US" ? /publishes no rate at all/ : /no publica ninguna/);
    });

    it(`attributes the figure to third parties in ${locale}`, () => {
      const row = marketingMessages(locale)["marketing.pricing.feeAnchor.fareharbor"];
      expect(row).toMatch(
        locale === "en-US"
          ? /third parties report that fee at around 6%/i
          : /terceros sitúan esa comisión en torno al 6%/i,
      );
    });
  }
});

/**
 * The credentials claim, and the reason it is scoped. The 2026-08-27 review
 * proposed "the only things held back are credentials" for the pricing page —
 * true of what a shop would *carry somewhere else*, and not true of the export
 * bundle, which also withholds retry queues, provider linkage, DiveDay's own
 * reconciliation ledgers and the close-out and buddy-team trails (the
 * `EXCLUDED_TABLES` list pinned by src/db/export.test.ts, and the real Settings
 * screen's own "Not included, on purpose:" line, which names all of it).
 *
 * So the sentence ships scoped to the shop's *records*, and the mockup — which
 * mirrors that Settings screen element for element — lists without claiming to
 * be the whole list. An unscoped absolute here would be the fabricated-proof
 * failure wearing a security badge, so the scope is the rule these pin.
 */
describe("the export's credentials claim never overstates what is held back", () => {
  const scoped = { "en-US": /records/i, "es-ES": /registros/i } as const;
  const credentials = { "en-US": /credentials/i, "es-ES": /credenciales/i } as const;
  /** Exclusivity words: "the only thing not included is…" is the claim we may not make. */
  const absolute = { "en-US": /\bonly\b/i, "es-ES": /\búnic|\bsolo\b/i } as const;

  for (const locale of DIVER_LOCALES) {
    it(`scopes the pricing page's sentence to the shop's records in ${locale}`, () => {
      const note = marketingMessages(locale)["marketing.pricing.dataExit.securityNote"];
      expect(note).toBeDefined();
      expect(note).toMatch(credentials[locale]);
      expect(note).toMatch(scoped[locale]);
    });

    it(`keeps the export mockup a list rather than a claim of completeness in ${locale}`, () => {
      const mockup = DIVER_MESSAGES[locale].fallback.export.notIncludedText;
      expect(mockup).toMatch(credentials[locale]);
      expect(mockup).not.toMatch(absolute[locale]);
    });
  }
});
