// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The demo door is a Server Action; rendering the pair needs only its
// reference, not the session and database behind it.
vi.mock("@/app/actions/demo", () => ({ enterDemoAction: vi.fn() }));

const { SourcesFootnote } = await import("./guide");

afterEach(cleanup);

/**
 * **The external-link arrow travels with the last word** (K-232).
 *
 * The footnote rendered `{label} ↗` with an ordinary space, so on a phone a
 * label that filled its first line put the 8px arrow alone on a second: the
 * pixel probe found six such lines across the EVE, FareHarbor and Rezdy
 * guides at 390.
 */
describe("the sources footnote", () => {
  it("glues the arrow to the label with a no-break space", () => {
    render(
      <SourcesFootnote
        locale="en-US"
        sources={[
          { label: "FareHarbor Help — downloading a manifest", url: "https://example.com" },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /downloading a manifest/ });
    expect(link.textContent).toBe("FareHarbor Help — downloading a manifest\u00A0↗");
  });
});
