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

async function termsText(locale: "en-US" | "es-ES" = "en-US") {
  request.headers = new Headers({ "accept-language": locale });
  const page = (await TermsPage()) as ReactElement<{ children: unknown[] }>;
  const children = page.props.children as ReactElement<Record<string, unknown>>[];
  const body = children.find((child) => isValidElement(child) && "locale" in (child.props ?? {}));
  if (!body) throw new Error("no terms body in the page");
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
    const text = await termsText();
    expect(text).toContain("Plans priced as a percentage of card payments");
    expect(text).toContain("3% of the card money your shop takes through DiveDay");
    expect(text).toContain("Shops already on DiveDay stay on the flat monthly price.");
    for (const excluded of ["Tips", "tax", "pass-through fees", "counter", "imported"]) {
      expect(text).toContain(excluded);
    }
    expect(text).toContain("Refunds");
    expect(text).toContain("statement");
    expect(text).toContain("never the diver");
    expect(text).toContain("30 days");
  });

  it("follows the configured rate and base fee, test on or off", async () => {
    vi.stubEnv("PRICING_PERCENT_BASIS_POINTS", "250");
    vi.stubEnv("PRICING_PERCENT_MONTHLY_CENTS", "2900");
    const text = await termsText();
    expect(text).toContain("2.5% of the card money your shop takes through DiveDay");
    expect(text).toContain("with a base fee of $29 each month");
  });

  it("says the same in es-ES", async () => {
    const text = await termsText("es-ES");
    expect(text).toContain("Planes con precio en un porcentaje de los pagos con tarjeta");
    expect(text).toMatch(
      /3\s?% del dinero que tu centro recibe en pagos con tarjeta a través de DiveDay/,
    );
    expect(text).toContain("nunca el buceador");
    expect(text).toContain("30 días");
  });
});
