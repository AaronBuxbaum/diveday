import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The marketing pages outside `/pricing` for the configured offer (ADR
 * 20261022-pricing-ab-test): `/about`, `/product`, a feature page, the
 * switching hub and a switching guide, and the home page's structured data.
 * Each page is invoked with the request stubbed, and the server components
 * named below are rendered as they are met, so what is asserted is what the
 * page would cache for that locale and offer. Visitor headers never change
 * the configured price.
 */

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const { default: HomePage } = await import("./(marketing)/page");
const { default: AboutPage } = await import("./(marketing)/about/page");
const { default: ProductPage } = await import("./(marketing)/product/page");
const { default: FeaturePage } = await import("./(marketing)/product/[feature]/page");
const { default: SwitchHubPage } = await import("./(marketing)/switching/page");
const { default: GuidePage, generateMetadata: guideMetadata } = await import(
  "./(marketing)/switching/[competitor]/page"
);
const { homeSoftwareJsonLd } = await import("./_components/home-json-ld");
const { requestPricingOffer } = await import("@/features/pricing-offer");
const { earlyAccessPriceAmount } = await import("@/lib/marketing");

/** The server components between a page and its words, rendered when met. */
const RENDERED = new Set([
  "LocalizedHomeBody",
  "HomeBody",
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
  peek: async () => GuidePage({ params: Promise.resolve({ competitor: "peek" }) }),
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

describe("with the original monthly-only pricing", () => {
  beforeEach(() => {
    vi.stubEnv("PRICING_MONTHLY_CENTS", "9900");
    vi.stubEnv("PRICING_BASIS_POINTS", "0");
  });
  it("/about keeps its story and standards without repeated commercial terms", async () => {
    asReader("percent_of_volume");
    const text = await pageText("about");
    expect(text).toContain("That story is why we built DiveDay");
    expect(text).toContain("wet clipboard");
    expect(text).toContain("See pricing");
    expect(text).toContain("/pricing#export");
    expect(text).not.toMatch(/\$99|One price covers|shuts down/);
  });

  it("/product states the price while features link to the plan", async () => {
    asReader("percent_of_volume");
    const line = "One flat price of $99 per location / month, and no cut of your bookings.";
    expect(await pageText("product")).toContain(line);
    const text = await pageText("payments");
    expect(text).not.toContain(line);
    expect(text).toContain("Included in your shop’s plan.");
    expect(text.match(/\/pricing\b/g)).toHaveLength(1);
    expect(text).not.toContain("/pricing#export");
    // The feature page's close is the two doors alone (B09/B15): the price
    // stands once, under its hero.
    expect(text).not.toContain("with every feature in it");
    expect(text).toContain(
      "DiveDay’s software fee is billed monthly, separately from each guest’s payment.",
    );
    expect(text).toContain("No. DiveDay is one flat monthly price.");
    expect(text).not.toContain("card money");
  });

  it("the switching pages state our price without promising savings against a rival", async () => {
    asReader("percent_of_volume");
    expect(await pageText("switching")).toContain("Switching from Peek Pro");
    for (const guide of ["rezdy", "fareharbor", "peek"] as const) {
      const text = await pageText(guide);
      expect(text).toContain(
        "One flat price of $99 per location / month, and no cut of your bookings.",
      );
      expect(text).not.toMatch(/leave the .*fee.*behind|around 6%/i);
      const metadata = await guideMetadata({ params: Promise.resolve({ competitor: guide }) });
      expect(JSON.stringify(metadata)).not.toMatch(FLAT_CLAIMS);
    }
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

describe("with default percentage pricing", () => {
  beforeEach(() => {
    vi.stubEnv("PRICING_MONTHLY_CENTS", "");
    vi.stubEnv("PRICING_BASIS_POINTS", "");
  });

  it("gives the monthly-only offer today's words", async () => {
    vi.stubEnv("PRICING_BASIS_POINTS", "0");
    vi.stubEnv("PRICING_MONTHLY_CENTS", "9900");
    asReader("flat_monthly");
    expect(await pageText("about")).toContain("See pricing");
    expect(await pageText("payments")).toContain("No. DiveDay is one flat monthly price.");
    expect(await pageText("rezdy")).toContain(
      "One flat price of $99 per location / month, and no cut of your bookings.",
    );
  });

  it("keeps the homepage demo note without the percentage price sentence", async () => {
    const text = await textOf(HomePage());
    expect(text).toContain(
      "The demo opens a working sample shop in one click. No sign-up and no card.",
    );
    expect(text).not.toContain("3% when you record a payment, with no monthly fee.");
  });

  it("gives the percentage offer its own terms on /about, /product and a feature page", async () => {
    asReader("percent_of_volume");
    const about = await pageText("about");
    expect(about).toContain("See pricing");
    expect(about).not.toMatch(/3%|\$99|shuts down/);

    const product = await pageText("product");
    expect(product).toContain(
      "3% of money recorded as received in DiveDay, cash included, with no monthly fee.",
    );
    expect(product).not.toMatch(FLAT_CLAIMS);

    const payments = await pageText("payments");
    expect(payments).toContain(
      "3% of money recorded as received in DiveDay, cash included, with no monthly fee.",
    );
    expect(payments).toContain("DiveDay’s 3% is billed to you once a month");
    expect(payments).toContain(
      "Yes. 3% of money recorded as received in DiveDay, cash included, with no monthly fee.",
    );
    expect(payments).not.toMatch(FLAT_CLAIMS);
    expect(payments).not.toContain("$99");
    expect(payments).toContain(
      "Online card payments count automatically; record cash and external payments when received.",
    );
    expect(payments).not.toContain("card money taken through DiveDay");
  });

  it("follows a base fee", async () => {
    vi.stubEnv("PRICING_BASIS_POINTS", "300");
    vi.stubEnv("PRICING_MONTHLY_CENTS", "2900");
    asReader("percent_of_volume");
    expect(await pageText("about")).not.toContain("$29");
    expect(await pageText("payments")).toContain(
      "recorded as received in DiveDay, cash included, plus $29 a month.",
    );
    expect(await pageText("about")).toContain("See pricing");
  });

  it("states the percentage offer beside the same honest switching comparison", async () => {
    asReader("percent_of_volume");
    const hub = await pageText("switching");
    expect(hub).toContain("Switching from Peek Pro");
    expect(hub).not.toMatch(FLAT_CLAIMS);
    for (const guide of ["rezdy", "fareharbor", "peek"] as const) {
      const text = await pageText(guide);
      expect(text).toContain(
        "3% of money recorded as received in DiveDay, cash included, with no monthly fee.",
      );
      expect(text).not.toMatch(FLAT_CLAIMS);
      const metadata = await guideMetadata({ params: Promise.resolve({ competitor: guide }) });
      expect(JSON.stringify(metadata)).not.toMatch(FLAT_CLAIMS);
    }
  });

  it("says the percentage offer’s terms in es-ES", async () => {
    asReader("percent_of_volume", "es-ES");
    const about = await pageText("about");
    expect(about).toContain("Ver precios");
    expect(about).not.toMatch(/3\s?%|\$99/);
    const payments = await pageText("payments");
    expect(payments).toMatch(/Sí\. El 3\s?%/);
    expect(payments).toContain("Los pagos con tarjeta en línea cuentan automáticamente");
    expect(payments).not.toContain("DiveDay es un precio mensual fijo");
    const rezdy = await pageText("rezdy");
    expect(rezdy).toMatch(
      /El 3\s?% del dinero registrado como recibido en DiveDay, incluido el efectivo, sin cuota mensual/,
    );
    expect(rezdy).not.toContain("comisión por reserva y toma");
    expect(rezdy).not.toContain("O deja atrás la cuota mensual");
  });

  it("leaves the percentage offer’s structured data without an Offer", async () => {
    asReader("percent_of_volume");
    expect(homeSoftwareJsonLd(await requestPricingOffer()).offers).toBeUndefined();
  });
});

it.each(["en-US", "es-ES"] as const)(
  "keeps ordinary features focused on the product in %s",
  async (locale) => {
    asReader(null, locale);
    for (const feature of ["website", "certifications", "messages", "schedule", "rental-gear"]) {
      const text = await textOf(await FeaturePage({ params: Promise.resolve({ feature }) }));
      expect(text).toContain(
        locale === "en-US" ? "Included in your shop’s plan." : "Incluido en el plan de tu centro.",
      );
      expect(text.match(/\/pricing\b/g)).toHaveLength(1);
      expect(text).not.toMatch(/#export|3\s?%|\$99|shuts down/);
    }
  },
);
