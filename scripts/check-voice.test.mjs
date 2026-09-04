import { describe, expect, it } from "vitest";

import { findTells, metadataStrings, proseDashes, RULES } from "./check-voice.mjs";

const rules = (value, locale = "en-US") => findTells(value, locale).map((hit) => hit.rule);

describe("the prose em-dash", () => {
  it("catches a dash between two clauses", () => {
    expect(
      rules("Who's booked, who's cleared, who's on the boat — one answer, all day."),
    ).toContain("em-dash");
    expect(rules("No email on file — add one from the roster, then resend.")).toContain("em-dash");
  });

  it("catches a dash in a sentence even when one side is short", () => {
    // "Not a block" is two words, but the string carries a full stop, so it is
    // prose and the dash replaced a colon.
    expect(
      rules("Not a block — plan shallower, or confirm the guide keeps them within limits."),
    ).toContain("em-dash");
  });

  it("catches a double hyphen standing in for one", () => {
    expect(rules("The importer shows every column -- and every row it skipped.")).toContain(
      "em-dash",
    );
  });

  it("reports each dash in a string once", () => {
    expect(proseDashes("A file — not a project — the importer shows what lands.")).toHaveLength(2);
  });

  it("leaves a short label separator alone", () => {
    // Not sentences: a status and its count, a state and its undo hint.
    expect(rules("Boarded — tap again to undo")).toEqual([]);
    expect(rules("Checked in — 2")).toEqual([]);
    expect(rules("Blocked — certification")).toEqual([]);
    expect(rules("Two-Tank Reef — Molasses & French")).toEqual([]);
  });

  it("leaves an en-dash range alone", () => {
    expect(rules("Dive 1 — Molasses Reef, 18 m, 8:05 – 8:47".replace("—", ":"))).toEqual([]);
    expect(rules("Today · 7:30–11:00 AM")).toEqual([]);
  });

  it("leaves a bare dash placeholder alone", () => {
    expect(rules("—")).toEqual([]);
  });
});

describe("the word rules", () => {
  it("catches an intensifier", () => {
    expect(rules("You can see the confirmation actually arrived.")).toContain("filler");
    expect(rules("Some of this is genuinely unsettled.")).toContain("filler");
    expect(rules("It simply works.")).toContain("filler");
  });

  it("does not catch the water lock's literal unlock", () => {
    expect(rules("Hold to unlock")).toEqual([]);
  });

  it("catches a lead-in", () => {
    expect(rules("Here's how to get your file out of EVE yourself.")).toContain("leadIn");
    expect(rules("Rest assured, nothing is lost.")).toContain("leadIn");
  });

  it("does not catch a price locked in today's number", () => {
    expect(rules("Founding shops lock in today's price for two years.")).toEqual([]);
  });

  it("catches the not-just contrast", () => {
    expect(rules("DiveDay isn't just a booking tool.")).toContain("notJust");
    expect(rules("It's more than just a list.")).toContain("notJust");
  });

  it("catches a bare not-just with no article after it", () => {
    // The shape is the tell, whatever follows it: "not just at the base",
    // "not just this one" read the same as "not just a list".
    expect(rules("Scan holes at chest height, not just at the base.")).toContain("notJust");
    expect(rules("That's true at every shop, not just this one.")).toContain("notJust");
  });

  it("leaves a factual scope refusal alone", () => {
    expect(rules("No retail register and no agency sync.")).toEqual([]);
  });

  it("catches the staccato run", () => {
    expect(rules("No setup fee. No per-seat math. No feature tiers.")).toContain("staccato");
  });

  it("leaves two full sentences that happen to start with No alone", () => {
    expect(
      rules(
        "No agency lets software verify a certification automatically. Nothing on this page pretends otherwise.",
      ),
    ).toEqual([]);
  });
});

describe("locales", () => {
  it("names a word list for every locale the bundles carry", () => {
    expect(Object.keys(RULES).sort()).toEqual(["en-US", "es-ES"]);
  });

  it("holds Spanish to its own list", () => {
    expect(rules("Puedes ver que la confirmación llegó realmente.", "es-ES")).toContain("filler");
    expect(rules("Sin cuota de alta. Sin cálculos por plaza.", "es-ES")).toContain("staccato");
    expect(rules("Un precio único — {price} {cadence}. Sin comisión.", "es-ES")).toContain(
      "em-dash",
    );
  });

  it("refuses a locale with no rules", () => {
    expect(() => findTells("Bonjour", "fr-FR")).toThrow(/no voice rules/);
  });
});

/**
 * A route's `metadata` block is English literals by design — one canonical
 * URL, one `<head>`, no locale in the path — so it never reaches a message
 * bundle and never reached this guard until issue #1317. Those literals are
 * the search snippet and the link-preview card: where a reader meets the voice
 * before they meet the page.
 *
 * What these tests are really about is the *extraction*, because the rules
 * themselves are already covered above. A scan that quietly stopped finding
 * strings would report a clean tree forever, and one that found `description:`
 * anywhere in a 900-line route file would report hits in props and schemas
 * that nobody can remove.
 */
describe("route metadata", () => {
  const found = (source) => metadataStrings(source).map((hit) => hit.value);

  it("takes title and description out of an exported metadata object", () => {
    expect(
      found(`export const metadata: Metadata = {
        title: "Pricing — DiveDay",
        description: "One flat price for the dive shop.",
        alternates: { canonical: "/pricing" },
      };`),
    ).toEqual(["Pricing — DiveDay", "One flat price for the dive shop."]);
  });

  it("reaches the nested openGraph and twitter cards, which are separate literals", () => {
    // The page restates both rather than letting them inherit, so a shared
    // link never unfurls with the site-level words — which means a tell has to
    // be fixed in each of them and the count has to say so.
    expect(
      found(`export const metadata: Metadata = {
        title: "A — DiveDay",
        openGraph: { title: "B — DiveDay", description: "Second." },
        twitter: { title: "C — DiveDay", description: "Third." },
      };`),
    ).toEqual(["A — DiveDay", "B — DiveDay", "Second.", "C — DiveDay", "Third."]);
  });

  it("reads a generateMetadata function too", () => {
    expect(
      found(`export async function generateMetadata(): Promise<Metadata> {
        return { title: "Check-in — DiveDay" };
      }`),
    ).toEqual(["Check-in — DiveDay"]);
  });

  it("ignores a description that is not in a metadata block", () => {
    // The reason this walks braces rather than grepping the file: a route
    // renders components and declares schemas, and both use these words.
    expect(
      found(`export const metadata = { title: "Real — DiveDay" };
        const schema = z.object({ description: z.string() });
        export default function Page() {
          return <Chart title="Not metadata" description="Nor is this one, obviously." />;
        }`),
    ).toEqual(["Real — DiveDay"]);
  });

  it("skips a template literal built from data", () => {
    // `${shop.name} — DiveDay` is a shop's own name beside a label, not
    // DiveDay's prose, and a translated half is already covered in the bundle
    // it lives in.
    expect(
      found("export const metadata = { title: `${shop.name} — DiveDay`, description: `Static.` };"),
    ).toEqual(["Static."]);
  });

  it("unescapes a quote so the value measures the same either way", () => {
    expect(found(`export const metadata = { description: "A shop\\'s day." };`)).toEqual([
      "A shop's day.",
    ]);
  });

  it("leaves the page-name title separator alone", () => {
    // The shape every marketing route uses. One side is the site name, so it
    // is a label rather than the two-clause pivot the rule is for — the same
    // reason "Boarded — tap again to undo" passes above. No special case in
    // the guard; the clause-length rule already gets this right.
    for (const title of [
      "Who we are — DiveDay",
      "Pricing — one flat price per shop | DiveDay",
      "DiveDay — a calmer way to run a dive day",
      "Dive shop software for the whole dive day — DiveDay",
    ]) {
      expect(rules(title)).toEqual([]);
    }
  });

  it("catches a prose em-dash in a description, which is the thing it is for", () => {
    expect(
      rules("Bookings, waivers and manifests — everything the day needs, in one place."),
    ).toContain("em-dash");
  });
});
