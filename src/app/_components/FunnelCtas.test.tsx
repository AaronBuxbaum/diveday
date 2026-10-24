// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The demo door is a Server Action; rendering the pair needs only its
// reference, not the session and database behind it.
vi.mock("@/app/actions/demo", () => ({ enterDemoAction: vi.fn() }));

const { ClosingCta, FunnelCtas } = await import("./FunnelCtas");

afterEach(cleanup);

/**
 * **One width for the pair, wherever a page puts it.**
 *
 * Both doors are `w-full sm:w-auto`, and a percentage width resolves against
 * the box it sits in. The pair's own row had no width, so on a phone it took
 * whatever its caller's alignment left it: the pixel probe measured `/product`'s
 * primary at x 24–365 in the hero, 117–272 in the mid-page card
 * (`items-center`) and 24–182 in the closing band (`items-start`), and every
 * switching guide's closing primary at 169px. Below `sm` the pair takes the
 * column's width itself.
 */
describe("the funnel's two doors", () => {
  it("fills the column on a phone and hugs its doors from sm up", () => {
    const { container } = render(<FunnelCtas locale="en-US" source="product" />);
    expect(container.firstElementChild).toHaveClass(
      "flex",
      "w-full",
      "flex-col",
      "sm:w-auto",
      "sm:flex-row",
    );
    for (const door of [
      screen.getByRole("button", { name: "Try the live demo" }),
      screen.getByRole("link", { name: "Get set up" }),
    ]) {
      expect(door).toHaveClass("w-full", "sm:w-auto");
    }
  });

  it("keeps a caller's placement beside its own width", () => {
    const { container } = render(
      <FunnelCtas locale="en-US" source="product" className="mt-8 justify-center" />,
    );
    expect(container.firstElementChild).toHaveClass(
      "w-full",
      "sm:w-auto",
      "mt-8",
      "justify-center",
    );
  });

  /**
   * A switching guide's closing band wraps the pair in an action column of
   * its own, and the band is `items-start` below `sm`: the column shrank to
   * its widest door, so the pair's `w-full` resolved against the shrunk box.
   * The column takes the band's width on a phone, as the pair does.
   */
  it("sits in a guide's closing column as wide as the band on a phone", () => {
    const guide = readFileSync(
      path.join(import.meta.dirname, "..", "switching", "_components", "guide.tsx"),
      "utf8",
    );
    const closing = guide.slice(guide.indexOf("export function ClosingCta"));
    const column = closing.match(/<div className="([^"]*)">\s*<FunnelCtas/)?.[1] ?? "";
    expect(column.split(" ")).toEqual(expect.arrayContaining(["w-full", "sm:w-auto"]));
  });
});

/**
 * A feature page opens the demo on its own screen, as the role it is about
 * (`src/lib/feature-pages.ts`); every other caller opens Today as the owner,
 * which is what an absent field means to `enterDemoAction`.
 */
describe("where the demo opens", () => {
  const hidden = (container: HTMLElement, name: string) =>
    container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;

  it("names the role and the screen a feature page asked for", () => {
    const { container } = render(
      <FunnelCtas
        locale="en-US"
        source="feature-rental-gear"
        demo={{ role: "owner", landing: "gear" }}
      />,
    );
    expect(hidden(container, "role")).toBe("owner");
    expect(hidden(container, "landing")).toBe("gear");
    expect(hidden(container, "source")).toBe("feature-rental-gear");
  });

  it("sends a diver door with no landing, since a diver has no staff page", () => {
    const { container } = render(
      <FunnelCtas
        locale="en-US"
        source="feature-online-booking"
        demo={{ role: "diver", landing: null }}
      />,
    );
    expect(hidden(container, "role")).toBe("diver");
    expect(hidden(container, "landing")).toBeUndefined();
  });

  it("sends neither when the page named nothing", () => {
    const { container } = render(<FunnelCtas locale="en-US" source="pricing" />);
    expect(hidden(container, "role")).toBeUndefined();
    expect(hidden(container, "landing")).toBeUndefined();
  });
});

/**
 * The terms stand under the first pair on a page and nowhere else (visual
 * review 2026-10-24, B09): seven pairs on four pages had carried them.
 */
describe("the footnotes under a pair", () => {
  const DEMO_NOTE = "The demo opens a working sample shop in one click. No sign-up and no card.";
  const offer = { plan: "flat_monthly", monthlyCents: 9_900, basisPoints: 0 } as const;

  it("stand under the hero's pair, with the price line", () => {
    render(<FunnelCtas locale="en-US" source="home-hero" footnotes={{ offer }} />);
    expect(screen.getByText(DEMO_NOTE)).toBeInTheDocument();
    expect(screen.getByText(/^One flat price of \$99/)).toBeInTheDocument();
  });

  it("are absent from every pair that does not ask for them", () => {
    for (const source of ["home-closing", "pricing-close", "product", "about-rules"] as const) {
      render(<FunnelCtas locale="en-US" source={source} />);
      expect(screen.queryByText(DEMO_NOTE)).toBeNull();
      expect(screen.queryByText(/One flat price/)).toBeNull();
      cleanup();
    }
  });
});

/** One close for every marketing page (B15), saying who reads a request once (#2097). */
describe("the closing band", () => {
  it("is a left-aligned heading, the support line and the pair, and no footnotes", () => {
    const { container } = render(
      <ClosingCta
        locale="en-US"
        source="pricing-close"
        title="Every staff login is in the price"
      />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Every staff login is in the price");
    expect(container.firstElementChild?.firstElementChild).not.toHaveClass("text-center");
    expect(screen.getByText(/A person reads every set-up request/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "support@dive.day" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Try the live demo" })).toBeInTheDocument();
    expect(screen.queryByText(/One flat price/)).toBeNull();
  });

  it("speaks Spanish", () => {
    render(<ClosingCta locale="es-ES" source="about-closing" title="Título" />);
    expect(screen.getByText(/Una persona lee cada solicitud/)).toBeInTheDocument();
  });
});
