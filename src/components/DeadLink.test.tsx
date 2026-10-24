// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { DeadLink } from "./DeadLink";

afterEach(cleanup);

const t = diverTranslator("en-US");
const SHOP = { name: "Blue Mantis Divers", contactEmail: "hello@example.test", contactPhone: null };

/**
 * **One dead-link page** (visual review 2026-10-24, B29): the same heading
 * under DiveDay's wordmark on all nine token pages, then one next step.
 */
describe("DeadLink", () => {
  it("says the one heading and the default next step under the wordmark", () => {
    const { container } = render(<DeadLink t={t} />);
    expect(screen.getByRole("heading", { name: "This link no longer works" })).toBeTruthy();
    expect(screen.getByText("Ask the shop for a fresh link.")).toBeTruthy();
    expect(container.textContent).toContain("DiveDay");
    expect(screen.getByRole("link", { name: "Go to DiveDay" })).toBeTruthy();
  });

  it("keeps a page's own next step, and the wordmark, beside a named shop", () => {
    const { container } = render(
      <DeadLink t={t} next="We can email you a fresh one." shop={SHOP} />,
    );
    expect(screen.getByText("We can email you a fresh one.")).toBeTruthy();
    expect(screen.queryByText("Ask the shop for a fresh link.")).toBeNull();
    expect(container.textContent).toContain("Blue Mantis Divers");
    expect(container.textContent).toContain("DiveDay");
    // The shop's hand, never DiveDay's sales door.
    expect(screen.queryByRole("link", { name: "Go to DiveDay" })).toBeNull();
  });

  it("names nobody and offers no door on an account link", () => {
    const { container } = render(<DeadLink t={t} diveDayDoor={false} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.textContent).not.toContain("Blue Mantis");
  });

  it("takes no token, so none can reach the markup", () => {
    const source = readFileSync(join(__dirname, "DeadLink.tsx"), "utf8");
    expect(source).not.toMatch(/\btoken\??:/);
  });

  it("has the heading and default line in both locales", () => {
    const es = diverTranslator("es-ES");
    render(<DeadLink t={es} />);
    expect(screen.getByRole("heading", { name: "Este enlace ya no funciona" })).toBeTruthy();
    expect(screen.getByText("Pide al centro un enlace nuevo.")).toBeTruthy();
  });
});
