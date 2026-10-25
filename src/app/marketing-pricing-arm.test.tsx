import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The marketing pages outside `/pricing` per pricing arm (ADR
 * 20261022-pricing-ab-test): `/about`, `/product`, a feature page, the
 * switching hub and a switching guide, and the home page's structured data.
 * Each page is invoked with the request stubbed, and the server components
 * named below are rendered as they are met, so what is asserted is what the
 * page would cache for that locale and arm. With the test off, every page says
 * what it says today, whatever arm a request claims.
 */

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const { default: AboutPage } = await import("./about/page");
const { default: ProductPage } = await import("./product/page");
const { default: FeaturePage } = await import("./product/[feature]/page");
const { default: SwitchHubPage } = await import("./switching/page");
const { default: GuidePage, generateMetadata: guideMetadata } = await import(
  "./switching/[competitor]/page"
);
const { homeSoftwareJsonLd } = await import("./_components/home-json-ld");
const { requestPricingOffer } = await import("@/lib/pricing-arm-request");
const { earlyAccessPriceAmount } = await import("@/lib/marketing");

/** The server components between a page and its words, rendered when met. */
const RENDERED = new Set([
  "AboutBody",
  "ProductBody",
  "LocalizedFeatureBody",
  "FeaturePageBody",
  "LocalizedSwitchHubBody",
  "SwitchHubBody",
  "HubGuideRow",
  "GuideRoute",
  "LocalizedGuideBody",
  "GuideBody",
  "GuideHero",
  "MarginNotes",
  "FunnelCtas",
]);

/** Every string in a tree: children and string props, the named components rendered. */
async function textOf(node: unknown): Promise<string> {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return (await Promise.all(node.map(textOf))).join(" ");
  if (!isValidElement(node)) return "";
  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === "function" && RENDERED.has(element.type.name)) {
    const render = element.type as (props: unknown) => unknown;
    return textOf(await render(element.props));
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(element.props ?? {})) {
    if (key === "className") continue;
    if (key === "children" || typeof value === "string" || Array.isArray(value)) {
      parts.push(await textOf(value));
    }
  }
  return parts.join(" ");
}

function asReader(arm: string | null, locale: "en-US" | "es-ES" = "en-US") {
  request.headers = new Headers({
    "accept-language": locale,
    ...(arm ? { "x-diveday-pricing-arm": arm } : {}),
  });
}

const pages = {
  about: () => AboutPage(),
  product: () => ProductPage(),
  payments: () => FeaturePage({ params: Promise.resolve({ feature: "payments" }) }),
  switching: async () => SwitchHubPage(),
  rezdy: async () => GuidePage({ params: Promise.resolve({ competitor: "rezdy" }) }),
  fareharbor: async () => GuidePage({ params: Promise.resolve({ competitor: "fareharbor" }) }),
};

async function pageText(page: keyof typeof pages) {
  return textOf(await pages[page]());
}

/** The claims that hold only against a flat monthly price. */
const FLAT_CLAIMS = /no cut|one flat|takes no percentage|per-booking cut|per-booking fee behind/i;

beforeEach(() => {
  request.headers = new Headers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with the test off", () => {
  it("/about says today's price, whatever arm a request claims", async () => {
    asReader("percent_of_volume");
    const text = await pageText("about");
    expect(text).toContain("One price covers the shop");
    expect(text).toContain(
      "The plan is $99 per location / month, and it covers every part of DiveDay and a login for everyone on your staff. We take no cut of your bookings.",
    );
    expect(text).toContain("One flat $99 per location / month. See the full list");
    expect(text).not.toContain("card money");
  });

  it("/product and a feature page say today's price", async () => {
    asReader("percent_of_volume");
    const line = "One flat price of $99 per location / month, and no cut of your bookings.";
    expect(await pageText("product")).toContain(line);
    const text = await pageText("payments");
    expect(text).toContain(line);
    expect(text).toContain("Every line here is in the one plan, at $99 per location / month.");
    // The feature page's close is the two doors alone (B09/B15): the price
    // stands once, under its hero.
    expect(text).not.toContain("with every feature in it");
    expect(text).toContain(
      "No row carries a DiveDay fee, because DiveDay takes no percentage of an order.",
    );
    expect(text).toContain("No. DiveDay is one flat monthly price.");
    expect(text).not.toContain("card money");
  });

  it("the switching pages keep the fee contrast", async () => {
    asReader("percent_of_volume");
    expect(await pageText("switching")).toContain(
      "or leave the monthly fee and per-booking cut behind.",
    );
    const rezdy = await pageText("rezdy");
    expect(rezdy).toContain("Or leave the monthly fee and the per-booking cut behind");
    expect(rezdy).toContain("leave the monthly fee and the per-booking cut behind and take");
    expect(await pageText("fareharbor")).toContain("Or leave the per-booking fee behind");
    const metadata = await guideMetadata({ params: Promise.resolve({ competitor: "rezdy" }) });
    expect(metadata.description).toContain("per-booking fee behind");
  });

  it("the home page's structured data carries today's offer", async () => {
    asReader("percent_of_volume");
    expect(homeSoftwareJsonLd(await requestPricingOffer()).offers).toEqual({
      "@type": "Offer",
      price: earlyAccessPriceAmount,
      priceCurrency: "USD",
    });
  });
});

describe("with the test on", () => {
  beforeEach(() => {
    vi.stubEnv("PRICING_TEST", "on");
  });

  it("gives the flat arm today's words", async () => {
    asReader("flat_monthly");
    expect(await pageText("about")).toContain("We take no cut of your bookings.");
    expect(await pageText("payments")).toContain("No. DiveDay is one flat monthly price.");
    expect(await pageText("rezdy")).toContain("Or leave the monthly fee and the per-booking cut");
  });

  it("gives the percent arm its own terms on /about, /product and a feature page", async () => {
    asReader("percent_of_volume");
    const about = await pageText("about");
    expect(about).toContain("One plan covers the shop");
    expect(about).toContain(
      "The plan is 3% of the card money taken through DiveDay, with no monthly fee,",
    );
    expect(about).toContain("3% of card money through DiveDay. See the full list");
    expect(about).not.toMatch(FLAT_CLAIMS);

    const product = await pageText("product");
    expect(product).toContain("3% of the card money taken through DiveDay, and no monthly fee.");
    expect(product).not.toMatch(FLAT_CLAIMS);

    const payments = await pageText("payments");
    expect(payments).toContain(
      "Every line here is in the one plan, at 3% of the card money taken through DiveDay.",
    );
    expect(payments).toContain("DiveDay’s 3% is billed to you once a month");
    expect(payments).toContain(
      "Yes. The fee is 3% of the card money taken through DiveDay, billed",
    );
    expect(payments).not.toMatch(FLAT_CLAIMS);
    expect(payments).not.toContain("$99");
  });

  it("follows a base fee", async () => {
    vi.stubEnv("PRICING_PERCENT_MONTHLY_CENTS", "2900");
    asReader("percent_of_volume");
    expect(await pageText("about")).toContain(
      "of the card money taken through DiveDay plus $29 a month, and it covers",
    );
    expect(await pageText("payments")).toContain("taken through DiveDay, plus $29 a month, billed");
    expect(await pageText("about")).toContain(
      "3% of card money and $29 a month. See the full list",
    );
  });

  it("takes the fee contrast off the switching pages for the percent arm", async () => {
    asReader("percent_of_volume");
    const hub = await pageText("switching");
    expect(hub).toContain("Keep it for distribution, or take the booking here too.");
    expect(hub).not.toMatch(FLAT_CLAIMS);
    for (const guide of ["rezdy", "fareharbor"] as const) {
      const text = await pageText(guide);
      expect(text).toContain("or take the booking here too.");
      expect(text).not.toMatch(FLAT_CLAIMS);
      const metadata = await guideMetadata({ params: Promise.resolve({ competitor: guide }) });
      expect(JSON.stringify(metadata)).not.toMatch(FLAT_CLAIMS);
    }
  });

  it("says the percent arm's terms in es-ES", async () => {
    asReader("percent_of_volume", "es-ES");
    const about = await pageText("about");
    expect(about).toContain("Un plan cubre el centro");
    expect(about).toMatch(
      /El plan es el 3\s?% del dinero cobrado con tarjeta a través de DiveDay, sin cuota/,
    );
    expect(about).not.toContain("No nos quedamos con nada de tus reservas");
    const payments = await pageText("payments");
    expect(payments).toMatch(/Sí\. La tarifa es el 3\s?%/);
    expect(payments).not.toContain("DiveDay es un precio mensual fijo");
    const rezdy = await pageText("rezdy");
    expect(rezdy).toContain("o toma también la reserva aquí.");
    expect(rezdy).not.toContain("comisión por reserva y toma");
    expect(rezdy).not.toContain("O deja atrás la cuota mensual");
  });

  it("leaves the percent arm's structured data without an Offer", async () => {
    asReader("percent_of_volume");
    expect(homeSoftwareJsonLd(await requestPricingOffer()).offers).toBeUndefined();
  });
});
