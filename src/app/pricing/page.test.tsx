import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonLd } from "@/components/JsonLd";

/**
 * /pricing per pricing arm (ADR 20261022-pricing-ab-test). The page is
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

describe("/pricing with the test off", () => {
  it("is the flat price, word for word, whatever arm a request claims", async () => {
    const { offer, text } = await pricingBody("percent_of_volume");
    expect(offer).toEqual({ plan: "flat_monthly", monthlyCents: 9_900, basisPoints: 0 });
    expect(text).toContain("$99");
    expect(text).toContain("Cut of your bookings");
    expect(text).toContain("DiveDay takes no cut of a booking.");
    expect(text).not.toContain("card money");
  });

  // B10 review: the export promise is written once, in the export band
  // (`#export`); the invoice's leaving row points down to it.
  it("points the leaving row at the export band instead of repeating its sentence", async () => {
    const t = diverTranslator("en-US");
    const { text } = await pricingBody(null);
    expect(text).toContain("Your records go with you. See below.");
    expect(text).not.toContain(t("marketing.export.terms"));
  });

  it("keeps today's metadata", async () => {
    expect((await generateMetadata()).title).toBe("Pricing — one flat price per shop | DiveDay");
  });
});

describe("/pricing with the test on", () => {
  beforeEach(() => {
    vi.stubEnv("PRICING_TEST", "on");
  });

  it("shows the percent arm its own lines, and none of the flat arm's", async () => {
    const { text } = await pricingBody("percent_of_volume");
    expect(text).toContain("3%");
    expect(text).toContain("of the card money taken through DiveDay, each month");
    expect(text).toContain("DiveDay’s fee");
    expect(text).toContain("What counts toward the 3%?");
    expect(text).toContain("DiveDay has no monthly charge.");
    expect(text).not.toContain("Cut of your bookings");
    expect(text).not.toContain("no cut");
    const metadata = await generateMetadata();
    expect(JSON.stringify(metadata)).not.toMatch(/no cut|flat price/);
  });

  it("promises the percent arm no cut anywhere, its FAQ JSON-LD included (issue 2947)", async () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      const t = diverTranslator(locale);
      const offer = { plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 } as const;
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
    vi.stubEnv("PRICING_PERCENT_BASIS_POINTS", "250");
    vi.stubEnv("PRICING_PERCENT_MONTHLY_CENTS", "2900");
    const { text } = await pricingBody("percent_of_volume");
    expect(text).toContain("2.5%");
    expect(text).toContain("plus $29 a month");
  });

  it("shows the percent arm in es-ES", async () => {
    const { text } = await pricingBody("percent_of_volume", "es-ES");
    expect(text).toMatch(/3\s?%/);
    expect(text).toContain("del dinero cobrado con tarjeta a través de DiveDay, cada mes");
    expect(text).toContain("La tarifa de DiveDay");
    expect(text).not.toContain("Comisión por reserva");
  });

  it("shows the flat arm what it shows today", async () => {
    const { text } = await pricingBody("flat_monthly");
    expect(text).toContain("$99");
    expect(text).toContain("Cut of your bookings");
    expect((await generateMetadata()).title).toBe("Pricing — one flat price per shop | DiveDay");
  });
});
