import { describe, expect, it } from "vitest";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { INTERNAL_VOCABULARY } from "@/test/copy";
import { getMigrationGuide, MIGRATION_GUIDE_SLUGS, MIGRATION_GUIDES } from "./migration-guides";

const t = diverTranslator("en-US");

it.each(DIVER_LOCALES)("keeps FareHarbor cutover timing conditional in %s", (locale) => {
  const guide = getMigrationGuide("fareharbor");
  if (!guide) throw new Error("FareHarbor guide is missing");
  const translate = diverTranslator(locale);
  const copy = [
    guide.cutover.heading,
    guide.cutover.intro,
    ...guide.cutover.steps.flatMap((step) => [step.title, step.detail]),
  ]
    .map((key) => translate(key))
    .join(" ");
  expect(copy).toContain(locale === "en-US" ? "reconcile" : "reconcilia");
  expect(copy).toContain(locale === "en-US" ? "trial" : "prueba");
  expect(copy).not.toContain(translate("marketing.guides.shared.cutover.step4.title"));
  expect(copy).not.toContain(translate("marketing.guides.shared.cutover.step3.title"));
});

/**
 * Resolve a guide's message key to its English text, and prove the key really
 * exists in the bundle: `diverTranslator`'s fallback returns the key itself
 * for a key the bundle doesn't hold, which would otherwise let a typo'd key
 * pass every length assertion below.
 */
function en(key: DiverMessageKey, values?: Record<string, string>): string {
  const resolved = t(key, values);
  expect(resolved, `bundle is missing ${key}`).not.toBe(key);
  return resolved;
}

/**
 * "Help arrives before the homework" — the third diagnosis of the 2026-08-27
 * conversion review, made mechanical. Everything in this block is about *where*
 * on a guide a fact stands, which is the one property a page-by-page copy
 * review cannot see and the one a regression will quietly undo.
 */
describe("help arrives before the homework", () => {
  /**
   * The concierge — free, personal, authorized (docs/product/marketing.md's
   * claims policy) — is the strongest de-risking claim on a switching guide,
   * and it used to appear only in the `SwitchingConcierge` block about 80% down
   * the page, below the four-phase rail that makes switching look like a
   * project. It now opens that rail as well, in the second sentence of
   * `moveIntro`. This pins the offer to that sentence rather than to the rail's
   * existence: a rewrite that keeps the words and drops the alternative is
   * exactly the regression, and it reads as an improvement while it happens.
   */
  for (const locale of DIVER_LOCALES) {
    it(`opens the move rail with the alternative to running it yourself in ${locale}`, () => {
      const intro = diverTranslator(locale)("switching.common.moveIntro");
      const sentences = intro.split(/(?<=[.?])\s+/).filter(Boolean);
      // Two beats: you run it, and you don't have to.
      expect(sentences.length).toBeGreaterThanOrEqual(2);
      // Free, and a person — never an automated capability, never a turnaround.
      expect(intro).toMatch(locale === "es-ES" ? /gratis/i : /free/i);
      expect(intro).toMatch(locale === "es-ES" ? /una persona/i : /a person/i);
      expect(intro).not.toMatch(/\b(hours?|days?|horas?|días?)\b/i);
    });
  }

  /**
   * The fifth step this section grew, and the one that reads first: a shop
   * owner's question before any of the mechanics is what their crew has to
   * learn. Its own words place it — "before you move a single record" — so
   * rendering it last would have it contradict the four steps above it. The
   * rail renders `steps` in array order, so this is the assertion that keeps
   * the placement from drifting back.
   */
  it("leads the shared cutover rail with the crew walking their screens", () => {
    const sharedGuide = MIGRATION_GUIDES.find((guide) => guide.slug !== "fareharbor");
    if (!sharedGuide) throw new Error("Shared cutover guide is missing");
    const sharedSteps = sharedGuide.cutover.steps;
    const [first, ...rest] = sharedSteps;
    expect(first.title).toBe("marketing.guides.shared.cutover.crewFirst.title");
    expect(rest).toHaveLength(4);
    for (const locale of DIVER_LOCALES) {
      const t = diverTranslator(locale);
      expect(t(first.title)).not.toBe(first.title);
      expect(t(first.detail)).not.toBe(first.detail);
      // It sends the reader to the demo, which is the one thing a crew can walk
      // before a single record moves — not to a trial, which needs an account.
      expect(t(first.detail)).toMatch(locale === "es-ES" ? /demostración/i : /demo/i);
    }
    // FareHarbor has source-specific handover work; every guide still starts
    // with the crew's walkthrough before records move.
    for (const guide of MIGRATION_GUIDES) {
      expect(guide.cutover.steps[0]).toEqual(first);
      if (guide.slug === "fareharbor") continue;
      expect(guide.cutover.steps).toBe(sharedSteps);
    }
  });

  /**
   * The leave-it guides' ledes lead with the wedge their own page documents,
   * rather than with a neutral description of where the data sits. Both
   * sentences are checked against the *sourced* claim they compress, because a
   * hero that sharpens past its citation is the claims-policy failure this
   * surface is likeliest to make (marketing.md: competitor statements must be
   * documented fact, phrased factually).
   */
  it("makes the crew workflow the reason to compare, without unsupported competitor limits", () => {
    expect(en("marketing.guides.diveshop360.heroLede")).toMatch(/crew|certification|boat/);
    expect(en("marketing.guides.diveshop360.context.item1")).toMatch(
      /not a retail POS replacement/,
    );
    expect(en("marketing.guides.eve.context.item1")).toMatch(/PADI/);
    for (const guide of MIGRATION_GUIDES) {
      const lede = en(guide.heroLede);
      expect(lede).not.toMatch(/no API|no bulk export|one back-office PC|shops report/);
    }
  });

  it("keeps leave-it guides free of a coexist block", () => {
    for (const slug of ["eve", "diveshop360", "smartwaiver"]) {
      expect(getMigrationGuide(slug)?.coexist, slug).toBeUndefined();
    }
  });

  /**
   * The spreadsheet guide is not a registry entry — a spreadsheet is not a
   * vendor to leave — but it renders the same composition and shares this
   * file's `IMPORT_SCOPE_ROW_KEYS`, so its copy rules are pinned beside the
   * incumbents' rather than in a file of their own.
   *
   * Its three phases stop before the cutover rail, and with them the
   * parallel-run answer that rail's first step gives. A shop still keeping a
   * sheet is the reader most likely to want it, so the import phase carries it
   * — and carries it as the sheet staying, not as a second copy of a step
   * written about leaving an incumbent.
   */
  for (const locale of DIVER_LOCALES) {
    it(`answers the parallel run on the spreadsheet guide's import phase in ${locale}`, () => {
      const t = diverTranslator(locale);
      const note = t("switching.spreadsheet.parallelRunNote");
      expect(note).not.toBe("switching.spreadsheet.parallelRunNote");
      // The mechanism, not a reassurance: `findOrCreatePerson` matches on email
      // and updates in place, which is the whole reason the sheet can stay.
      expect(note).toMatch(locale === "es-ES" ? /correo/i : /email/i);
      // And it is its own sentence, never the cutover step's words moved.
      expect(note).not.toBe(t("marketing.guides.shared.cutover.step3.detail"));
      expect(note).not.toBe(t("marketing.guides.shared.cutover.step1.detail"));
    });
  }

  /**
   * The tone ratchet, in the shape the marketing spec's apologetics list uses:
   * the retired phrasing is pinned out by name, because it shipped as a
   * sentence its author thought was charming. "A spreadsheet is a good memory
   * and a bad teammate" judged the tool a shop had been running its season on,
   * in the first line of body copy that shop reads — the replacement says what
   * the sheet does and does not do and leaves the character out of it.
   */
  const retiredWedgeFramings = [/bad teammate/i, /mal compañero/i];
  for (const locale of DIVER_LOCALES) {
    it(`opens the spreadsheet wedge without judging the tool in ${locale}`, () => {
      const intro = diverTranslator(locale)("switching.spreadsheet.wedgeIntro1");
      for (const pattern of retiredWedgeFramings) {
        expect(intro, `${pattern} in ${locale}`).not.toMatch(pattern);
      }
      // What it says instead: the sheet holds, and the checking is the reader's
      // hands. Both halves, so a rewrite cannot drop the second one.
      expect(intro).toMatch(locale === "es-ES" ? /revisar/i : /checks? nothing|checking/i);
      expect(intro).toMatch(locale === "es-ES" ? /a mano/i : /by hand/i);
    });
  }
});

describe("migration guides", () => {
  it("exposes every guide's slug, with FareHarbor first and the named incumbents present", () => {
    expect(MIGRATION_GUIDE_SLUGS).toEqual(MIGRATION_GUIDES.map((g) => g.slug));
    // FareHarbor leads the list — the incumbent a dive shop is likeliest to
    // already be on, and the one the hub pairs with its spreadsheet card at the
    // top of the page. The named incumbents from the strategy are all present.
    expect(MIGRATION_GUIDE_SLUGS[0]).toBe("fareharbor");
    for (const slug of ["eve", "diveshop360", "smartwaiver", "fareharbor", "rezdy", "peek"]) {
      expect(MIGRATION_GUIDE_SLUGS).toContain(slug);
    }
  });

  it("resolves a guide by slug and refuses an unknown one", () => {
    expect(getMigrationGuide("eve")?.competitor).toBe("EVE");
    expect(getMigrationGuide("smartwaiver")?.competitor).toBe("Smartwaiver");
    expect(getMigrationGuide("fareharbor")?.competitor).toBe("FareHarbor");
    expect(getMigrationGuide("rezdy")?.competitor).toBe("Rezdy");
    // No coming-soon / roadmap entries — an unlisted incumbent (e.g. Checkfront) has no page.
    expect(getMigrationGuide("checkfront")).toBeNull();
    expect(getMigrationGuide("nope")).toBeNull();
  });

  it("carries the coexist framing only on the booking-channel guides, not the leave-it ones", () => {
    // FareHarbor and Rezdy are booking/distribution channels, so they earn the
    // coexist block; the records-system guides stay straight leave-it migrations.
    for (const slug of ["fareharbor", "rezdy", "peek"]) {
      const guide = getMigrationGuide(slug);
      expect(guide?.coexist, `${slug} coexist`).toBeDefined();
      const coexist = guide?.coexist;
      if (!coexist) throw new Error("unreachable");
      expect(en(coexist.bridgeNote).trim().length).toBeGreaterThan(0);
      if (!coexist.replace) throw new Error(`${slug} has no replace box`);
      expect(en(coexist.replace.body).trim().length).toBeGreaterThan(0);
    }
    for (const slug of ["eve", "diveshop360", "smartwaiver"]) {
      expect(getMigrationGuide(slug)?.coexist).toBeUndefined();
    }
  });

  it("describes manual booking work on every channel guide", () => {
    for (const slug of ["fareharbor", "rezdy", "peek"]) {
      const bridge = getMigrationGuide(slug)?.coexist?.bridgeNote;
      if (!bridge) throw new Error(slug);
      for (const locale of DIVER_LOCALES) {
        const copy = diverTranslator(locale)(bridge);
        expect(copy).toMatch(locale === "en-US" ? /no automatic/i : /no hay conexión automática/i);
        expect(copy).toMatch(locale === "en-US" ? /cancellations/ : /cancelaciones/);
      }
    }
  });

  it("qualifies Peek export uncertainty rather than inventing a dashboard path", () => {
    const guide = getMigrationGuide("peek");
    expect(guide?.competitor).toBe("Peek Pro");
    expect(en("marketing.guides.peek.context.item3")).toContain("Ask Peek support");
    expect(en("marketing.guides.peek.exportIntro")).toContain("depend on your Peek account");
    expect(en("marketing.guides.peek.importerNote")).toContain("not what Peek exports");
    expect(guide?.sources.every(({ url }) => /peekpro.com|peek.com/.test(url))).toBe(true);
  });

  it("replaces fixed migration times with a sample and trip trial", () => {
    for (const guide of MIGRATION_GUIDES) {
      const copy = [
        guide.heroLede,
        guide.cutover.intro,
        ...guide.cutover.steps.flatMap((s) => [s.title, s.detail]),
      ]
        .map((key) => en(key))
        .join(" ");
      expect(copy).not.toMatch(/an afternoon|one sitting|without downtime/);
      expect(copy).toMatch(/trial/i);
    }
  });

  it("keeps Smartwaiver participant data distinct from signed originals", () => {
    expect(en("marketing.guides.smartwaiver.exportSteps.step1.title")).toContain("Participant CSV");
    expect(en("marketing.guides.smartwaiver.exportNotes.note3")).toContain(
      "not the original signed document",
    );
    expect(en("marketing.guides.smartwaiver.context.item3")).toContain(
      "does not establish legal validity",
    );
  });

  it("every guide carries the full three-part promise — no empty shell can ship", () => {
    for (const guide of MIGRATION_GUIDES) {
      expect(en(guide.heroLede).trim().length, `${guide.slug} lede`).toBeGreaterThan(0);
      expect(guide.context.length, `${guide.slug} context`).toBeGreaterThan(0);
      for (const paragraph of guide.context) {
        expect(en(paragraph).trim().length).toBeGreaterThan(0);
      }
      expect(en(guide.exportHeading).trim().length, `${guide.slug} export heading`).toBeGreaterThan(
        0,
      );
      expect(guide.exportSteps.length, `${guide.slug} export steps`).toBeGreaterThan(0);
      for (const step of guide.exportSteps) {
        expect(en(step.title).trim().length).toBeGreaterThan(0);
        expect(en(step.detail).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every guide cites at least one source with an absolute URL (claims policy)", () => {
    for (const guide of MIGRATION_GUIDES) {
      expect(guide.sources.length, `${guide.slug} sources`).toBeGreaterThan(0);
      for (const source of guide.sources) {
        expect(source.label.trim().length).toBeGreaterThan(0);
        expect(source.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("has unique slugs", () => {
    const slugs = MIGRATION_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("never instructs a shop to hand DiveDay a competitor login (legal guardrail)", () => {
    // We migrate from files the shop exports itself; the copy must not describe
    // logging DiveDay into the incumbent or handing over its credentials.
    for (const guide of MIGRATION_GUIDES) {
      const coexist = guide.coexist
        ? [
            en(guide.coexist.heading),
            en(guide.coexist.intro),
            en(guide.coexist.bridgeNote),
            ...(guide.coexist.replace
              ? [en(guide.coexist.replace.heading), en(guide.coexist.replace.body)]
              : []),
          ]
        : [];
      const website = guide.website
        ? [
            en(guide.website.heading),
            en(guide.website.intro),
            ...guide.website.ledger.flatMap((row) => [en(row.theirs), en(row.ours)]),
            en(guide.website.sitesNote),
            en(guide.website.offer.heading),
            en(guide.website.offer.body),
          ]
        : [];
      const prose = [
        en(guide.heroLede),
        ...guide.context.map((p) => en(p)),
        ...coexist,
        ...website,
        en(guide.exportIntro),
        ...guide.exportSteps.flatMap((s) => [en(s.title), en(s.detail)]),
        ...guide.exportNotes.map((n) => en(n)),
      ]
        .join(" ")
        .toLowerCase();
      expect(prose).not.toMatch(/your (eve )?(password|credentials|login)/);
    }
  });

  it("never leaks internal vocabulary into copy a shop owner reads", () => {
    // These pages are rendered verbatim from the bundle. An ADR id, a
    // decision-register id, a reviewer-agent name, or a source path is how *we*
    // talk to each other about a decision — a shop owner reading "see the
    // imported-waiver ADR" has been handed a dead end. Say the thing the copy
    // is pointing at instead.
    for (const guide of MIGRATION_GUIDES) {
      const copy = [
        en(guide.cardSummary),
        en(guide.metaTitle),
        en(guide.metaDescription),
        en(guide.heroEyebrow),
        en(guide.heroTitle),
        en(guide.heroLede),
        ...guide.context.map((p) => en(p)),
        en(guide.exportHeading),
        en(guide.exportIntro),
        ...guide.exportSteps.flatMap((s) => [en(s.title), en(s.detail)]),
        ...guide.exportNotes.map((n) => en(n)),
        guide.importerNote ? en(guide.importerNote) : "",
        ...guide.sources.map((s) => s.label),
        ...(guide.website
          ? [
              en(guide.website.heading),
              en(guide.website.intro),
              ...guide.website.ledger.flatMap((row) => [en(row.theirs), en(row.ours)]),
              en(guide.website.sitesNote),
              en(guide.website.offer.heading),
              en(guide.website.offer.body),
            ]
          : []),
      ].join(" ");
      expect(copy).not.toMatch(INTERNAL_VOCABULARY);
    }
  });
});

/**
 * The website ledger (ADR 20260901-diveday-reimagined, decisions 2 and 3):
 * FareHarbor's real footprint is on the shop's own site, so its guide maps
 * every pasted thing to the DiveDay embed that replaces it, states the
 * hosted-website figure the way the claims policy allows, and carries the
 * built-to-order website as a person's offer.
 */
describe("the website ledger", () => {
  const guide = getMigrationGuide("fareharbor");
  if (!guide?.website) throw new Error("the FareHarbor guide carries the website ledger");
  const website = guide.website;

  it("is FareHarbor's alone — the leave-it guides and Rezdy have no site footprint to map", () => {
    for (const other of MIGRATION_GUIDES) {
      if (other.slug === "fareharbor") continue;
      expect(other.website, other.slug).toBeUndefined();
    }
  });

  it("maps every embed a shop pastes, with a twin on both sides in both locales", () => {
    expect(website.ledger.length).toBeGreaterThanOrEqual(8);
    for (const locale of DIVER_LOCALES) {
      const t = diverTranslator(locale);
      for (const row of website.ledger) {
        expect(t(row.theirs).trim().length, row.theirs).toBeGreaterThan(0);
        expect(t(row.ours).trim().length, row.ours).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Claims policy (docs/product/marketing.md): a competitor's figure is stated
   * as what its own pages or a named third party report, never as what a shop
   * pays, and no message bundle carries a currency figure — the number has one
   * source, the guide, where the citation sits beside it.
   */
  it("asks shops to confirm hosting terms instead of quoting an unverified price", () => {
    for (const locale of DIVER_LOCALES) {
      const copy = diverTranslator(locale)(website.sitesNote);
      expect(copy).not.toMatch(/\p{Sc}\s?\d/u);
      expect(copy).toMatch(
        locale === "en-US" ? /ownership, hosting and cancellation/ : /propiedad, el alojamiento/,
      );
    }
  });

  /**
   * Aaron, 2026-11-09: website work starts with a discussion, without a price,
   * turnaround time, page count or promise to build it.
   */
  it("invites a website discussion without a price or delivery commitment", () => {
    for (const locale of DIVER_LOCALES) {
      const t = diverTranslator(locale);
      const body = t(website.offer.body);
      expect(body).not.toMatch(/\d+\s*(days?|weeks?|pages?|días?|semanas?|páginas?)/i);
      expect(body).not.toMatch(
        /free website|web gratis|sitio gratis|in the price|va en el precio/i,
      );
      expect(body).toMatch(locale === "en-US" ? /discuss/ : /conversar/);
      expect(body).toMatch(locale === "en-US" ? /a person at DiveDay/ : /una persona de DiveDay/);
    }
  });
});
