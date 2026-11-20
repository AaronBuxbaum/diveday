import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonLd } from "@/components/JsonLd";

/**
 * /pricing for the configured offer (ADR 20261022-pricing-ab-test). The page is
 * invoked directly with the request stubbed; the cached body is found in its
 * tree and rendered with the props the page handed it, so what is asserted is
 * what the page would cache for that locale and offer.
 */

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const { default: PricingPage, generateMetadata } = await import("./page");
const { pricingFaq } = await import("./faq");
const { diverTranslator } = await import("@/i18n/messages");

/** Every string in a rendered tree, async components rendered as they are met. */
async function textOf(node: unknown): Promise<string> {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return (await Promise.all(node.map(textOf))).join(" ");
  if (!isValidElement(node)) return "";
  const element = node as ReactElement<Record<string, unknown>>;
  return textOf(element.props.children);
}

async function pricingBody(arm: string | null, locale: "en-US" | "es-ES" = "en-US") {
  request.headers = new Headers({
    "accept-language": locale,
    ...(arm ? { "x-diveday-pricing-arm": arm } : {}),
  });
  const page = (await PricingPage()) as ReactElement<{ children: unknown[] }>;
  const children = page.props.children as ReactElement<Record<string, unknown>>[];
  const body = children.find((child) => isValidElement(child) && "offer" in (child.props ?? {}));
  if (!body) throw new Error("no pricing body in the page");
  const render = body.type as (props: unknown) => Promise<unknown>;
  const tree = await render(body.props);
  const bodyTree = tree as ReactElement<{ children: unknown }>;
  const bodyChildren = Array.isArray(bodyTree.props.children)
    ? bodyTree.props.children
    : [bodyTree.props.children];
  const structuredDataElement = bodyChildren.find(
    (child) => isValidElement(child) && child.type === JsonLd,
  );
  if (!isValidElement(structuredDataElement)) throw new Error("no pricing JSON-LD component");
  const jsonLdProps = structuredDataElement.props as Parameters<typeof JsonLd>[0];
  const script = JsonLd(jsonLdProps);
  const jsonLd = script?.props.dangerouslySetInnerHTML?.__html as string;
  return { offer: body.props.offer, text: await textOf(tree), jsonLd, data: jsonLdProps.data };
}

beforeEach(() => {
  request.headers = new Headers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/pricing with the original monthly-only pricing", () => {
  beforeEach(() => {
    vi.stubEnv("PRICING_MONTHLY_CENTS", "9900");
    vi.stubEnv("PRICING_BASIS_POINTS", "0");
  });
  it("is the flat price, word for word, whatever arm a request claims", async () => {
    const { offer, text } = await pricingBody("percent_of_volume");
    expect(offer).toEqual({ plan: "flat_monthly", monthlyCents: 9_900, basisPoints: 0 });
    expect(text).toContain("$99");
    expect(text).not.toContain("card money");
  });

  // The export promise is written once, in the export band (`#export`).
  it("writes the export promise once", async () => {
    const t = diverTranslator("en-US");
    const { text } = await pricingBody(null);
    expect(text.split(t("marketing.export.terms")).length - 1).toBeLessThanOrEqual(1);
  });

  it("keeps today's metadata", async () => {
    expect((await generateMetadata()).title).toBe("Pricing — one flat price per shop | DiveDay");
  });
});

describe("/pricing with default percentage pricing", () => {
  beforeEach(() => {
    vi.stubEnv("PRICING_MONTHLY_CENTS", "");
    vi.stubEnv("PRICING_BASIS_POINTS", "");
  });

  it("hands the comparison the configured offer", async () => {
    const { offer, text } = await pricingBody(null);
    expect(offer).toEqual({ plan: "percent_of_volume", monthlyCents: 0, basisPoints: 100 });
    expect(text).toContain("What a month could cost");
    expect(text).not.toContain("The same month on FareHarbor and on DiveDay");
    expect(text).toContain("estimates, not quotes");
    // The DiveDay column's words come from the offer, so a changed rate is a changed column.
    expect(text).toContain("1% of money recorded as received in DiveDay");
    vi.stubEnv("PRICING_BASIS_POINTS", "250");
    vi.stubEnv("PRICING_MONTHLY_CENTS", "2900");
    const changed = await pricingBody(null);
    expect(changed.offer).toEqual({
      plan: "percent_of_volume",
      monthlyCents: 2_900,
      basisPoints: 250,
    });
    expect(changed.text).toContain("2.5% of money recorded as received in DiveDay");
    expect(changed.text).not.toContain("1% of money recorded as received in DiveDay");
  });

  it("shows the percentage offer its own lines, and none of the monthly-only offer’s", async () => {
    const { text } = await pricingBody("percent_of_volume");
    expect(text).toContain("1%");
    expect(text).toContain("of money recorded as received in DiveDay, with no monthly fee");
    expect(text).toContain("What counts toward the 1%?");
    expect(text).toContain(
      "whether paid online, in cash, by bank transfer, on your own card machine or another method",
    );
    expect(text).toContain("Packages count when sold, never again when redeemed");
    expect(text).toContain("Refunds receive a credit at the original rate");
    expect(text).not.toContain("card money taken through DiveDay");
    expect(text).not.toContain("no cut");
    const metadata = await generateMetadata();
    expect(JSON.stringify(metadata)).not.toMatch(/no cut|flat price/);
  });

  it("promises the percentage offer no cut anywhere, its FAQ JSON-LD included (issue 2947)", async () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      const t = diverTranslator(locale);
      const offer = { plan: "percent_of_volume", monthlyCents: 0, basisPoints: 100 } as const;
      const faq = JSON.stringify(pricingFaq(t, "Rezdy and FareHarbor", offer, locale));
      expect(faq).not.toMatch(/no cut|sin comisión|ninguna comisión/i);
      const { text } = await pricingBody("percent_of_volume", locale);
      expect(text).not.toMatch(/no cut|sin comisión|ninguna comisión/i);
    }
  });

  it("preserves pricing FAQ JSON-LD bytes for both plans and locales", async () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      for (const arm of ["flat_monthly", "percent_of_volume"] as const) {
        const { jsonLd, data } = await pricingBody(arm, locale);
        const legacyOutput = JSON.stringify(data).replace(/</g, "\\u003c");
        expect(jsonLd).toBe(legacyOutput);
      }
    }
  });

  it("keeps markup in JSON-LD strings escaped from the script element", () => {
    const script = JsonLd({ data: { "@type": "Thing", name: "</script><script>" } });
    expect(script?.props.dangerouslySetInnerHTML?.__html).toBe(
      '{"@type":"Thing","name":"\\u003c/script>\\u003cscript>"}',
    );
  });

  it("follows the configured numbers, a base fee included", async () => {
    vi.stubEnv("PRICING_BASIS_POINTS", "250");
    vi.stubEnv("PRICING_MONTHLY_CENTS", "2900");
    const { text } = await pricingBody("percent_of_volume");
    expect(text).toContain("2.5%");
    expect(text).toContain("plus $29 a month");
  });

  it("shows the percentage offer in es-ES", async () => {
    const { text } = await pricingBody("percent_of_volume", "es-ES");
    expect(text).toMatch(/1\s?%/);
    expect(text).toContain("del dinero registrado como recibido en DiveDay, sin cuota mensual");
    expect(text).not.toContain("Comisión por reserva");
  });

  it("shows the monthly-only offer what it shows today", async () => {
    vi.stubEnv("PRICING_BASIS_POINTS", "0");
    vi.stubEnv("PRICING_MONTHLY_CENTS", "9900");
    const { text } = await pricingBody("flat_monthly");
    expect(text).toContain("$99");
    expect((await generateMetadata()).title).toBe("Pricing — one flat price per shop | DiveDay");
  });
});

describe("configured offer components", () => {
  it("renders a monthly-only amount without a percentage", async () => {
    vi.stubEnv("PRICING_MONTHLY_CENTS", "2900");
    const { offer, text } = await pricingBody("percent_of_volume");
    expect(offer).toEqual({ plan: "flat_monthly", monthlyCents: 2900, basisPoints: 0 });
    expect(text).toContain("$29");
    expect(text).not.toContain("What counts toward");
  });

  it("renders explicit zero fees without a percentage charge", async () => {
    vi.stubEnv("PRICING_MONTHLY_CENTS", "0");
    for (const locale of ["en-US", "es-ES"] as const) {
      const { offer, text } = await pricingBody("percent_of_volume", locale);
      expect(offer).toEqual({ plan: "flat_monthly", monthlyCents: 0, basisPoints: 0 });
      expect(text).toContain(locale === "en-US" ? "$0" : "0\u00a0US$");
      expect(text).not.toMatch(/(?<![\d.])0\s?%/);
    }
  });
});

it.each(["en-US", "es-ES"] as const)(
  "keeps the exact continuity answer accessible in %s",
  async (locale) => {
    const t = diverTranslator(locale);
    const { text, jsonLd } = await pricingBody(null, locale);
    const promise = t("marketing.export.continuity");
    expect(text).toContain(promise);
    expect(jsonLd).toContain(promise);
  },
);
