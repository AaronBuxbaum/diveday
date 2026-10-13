// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { WaiverHelpLine } from "./WaiverHelpLine";

afterEach(cleanup);

const t = diverTranslator("en-US");
const shop = { name: "Blue Mantis", contactEmail: null, contactPhone: null };

describe("WaiverHelpLine", () => {
  it("prefers the shop's email", () => {
    render(
      <WaiverHelpLine
        shop={{ ...shop, contactEmail: "hi@example.com", contactPhone: "+1-305-555-0100" }}
        t={t}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("mailto:hi@example.com");
  });

  it("falls back to the phone", () => {
    render(<WaiverHelpLine shop={{ ...shop, contactPhone: "+1-305-555-0100" }} t={t} />);
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/^tel:/);
  });

  it("says plain words when the shop has no channel", () => {
    const { container } = render(<WaiverHelpLine shop={shop} t={t} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe(t("common.needHelpPlain", { shop: "Blue Mantis" }));
  });
});
