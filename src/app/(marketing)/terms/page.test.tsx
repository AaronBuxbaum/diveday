import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /terms's percent-plan clause (#2947, ADR 20261022-pricing-ab-test). The
 * page is invoked directly with the request stubbed; the cached body is found
 * in its tree and rendered with the props the page handed it.
 */

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const { default: TermsPage } = await import("./page");
const { default: PrivacyPage } = await import("../privacy/page");

/** Every string in a rendered tree, props named `items` and `children` included. */
async function textOf(node: unknown): Promise<string> {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return (await Promise.all(node.map(textOf))).join(" ");
  if (!isValidElement(node)) return "";
  const element = node as ReactElement<Record<string, unknown>>;
  const props = element.props;
  const items = Array.isArray(props.items)
    ? (props.items as { term: string; body: string }[]).map((item) => `${item.term} ${item.body}`)
    : [];
  const heading = typeof props.heading === "string" ? props.heading : "";
  return [heading, ...items, await textOf(props.children)].join(" ");
}

async function legalText(locale: "en-US" | "es-ES" = "en-US", pageComponent = TermsPage) {
  request.headers = new Headers({ "accept-language": locale });
  const page = (await pageComponent()) as ReactElement<{ children: unknown[] }>;
  const children = page.props.children as ReactElement<Record<string, unknown>>[];
  const body = children.find((child) => isValidElement(child) && "locale" in (child.props ?? {}));
  if (!body) throw new Error("no legal body in the page");
  const render = body.type as (props: unknown) => Promise<unknown>;
  return textOf(await render(body.props));
}

beforeEach(() => {
  request.headers = new Headers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/terms percent-plan clause", () => {
  it("states the fee, what counts, refunds, the statement, who pays and the notice", async () => {
    const text = await legalText();
    expect(text).toContain("Plans priced as a percentage of recorded collections");
    expect(text).toContain("3% of the money your shop records as received in DiveDay");
    expect(text).toContain("Your subscription keeps the rate and monthly fee you agreed to.");
    for (const excluded of ["tips", "tax", "pass-through charges", "cash", "imported"]) {
      expect(text).toContain(excluded);
    }
    expect(text).toContain("Refunds");
    // Issue 3024: a refund recorded after a statement closed is credited, not lost.
    expect(text).toContain("at the rate and rounding of its original statement");
    expect(text).not.toContain("not credited");
    expect(text).toContain("only the later balance counts when it arrives");
    expect(text).toContain("Packages count once at sale");
    expect(text).toContain("Without a separate tax breakdown, the recorded amount counts in full");
    expect(text).toContain("Unused fee credit carries forward in the same currency");
    expect(text).toContain("Automatic billing currently supports USD only");
    expect(text).not.toContain("percentage of card payments");
    expect(text).toContain("statement");
    expect(text).toContain("never the diver");
    expect(text).toContain("30 days");
  });

  it("keeps agreed percentage terms when the public offer is monthly-only", async () => {
    vi.stubEnv("PRICING_MONTHLY_CENTS", "9900");
    vi.stubEnv("PRICING_BASIS_POINTS", "0");
    expect(await legalText()).toContain(
      "The percentage and any monthly base fee agreed for your shop",
    );
  });

  it("follows the configured rate and base fee, independently of visitor state", async () => {
    vi.stubEnv("PRICING_BASIS_POINTS", "250");
    vi.stubEnv("PRICING_MONTHLY_CENTS", "2900");
    const text = await legalText();
    expect(text).toContain("2.5% of the money your shop records as received in DiveDay");
    expect(text).toContain("with a base fee of $29 each month");
  });

  it("says the same in es-ES", async () => {
    const text = await legalText("es-ES");
    expect(text).toContain("Planes con precio en un porcentaje de los cobros registrados");
    expect(text).toMatch(/el 3\s?% del dinero que tu centro registra como recibido/);
    expect(text).toContain("nunca el buceador");
    expect(text).toContain("incluidos el efectivo y los pagos externos");
    expect(text).toContain("El cobro automático admite solo USD por ahora");
    expect(text).toContain("30 días");
  });
});

describe.each([
  ["terms", TermsPage],
  ["privacy", PrivacyPage],
] as const)("/%s confirmed governing law", (_name, pageComponent) => {
  it.each(["en-US", "es-ES"] as const)(
    "renders Massachusetts law with the operator and address in %s",
    async (locale) => {
      const text = await legalText(locale, pageComponent);
      expect(text).toContain("Pseudorandom LLC");
      expect(text).toContain("12851 Capital St, Suite 100, Oak Park, MI 48237");
      expect(text).toContain(
        locale === "en-US" ? "Massachusetts law governs" : "leyes de Massachusetts",
      );
    },
  );
});
