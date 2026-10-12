// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { MedicalReviewContact } from "./MedicalReviewContact";

afterEach(cleanup);

const t = diverTranslator("en-US");
const shop = { name: "Blue Mantis", contactEmail: null, contactPhone: null };

describe("MedicalReviewContact", () => {
  it("links both channels when the shop has both", () => {
    render(
      <MedicalReviewContact
        shop={{ ...shop, contactEmail: "hi@example.com", contactPhone: "+1-305-555-0100" }}
        t={t}
      />,
    );
    expect(screen.getByRole("link", { name: "+1-305-555-0100" }).getAttribute("href")).toMatch(
      /^tel:/,
    );
    expect(screen.getByRole("link", { name: "hi@example.com" }).getAttribute("href")).toBe(
      "mailto:hi@example.com",
    );
  });

  it("links the phone alone, and the email alone", () => {
    const { unmount } = render(
      <MedicalReviewContact shop={{ ...shop, contactPhone: "+1-305-555-0100" }} t={t} />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    unmount();
    render(<MedicalReviewContact shop={{ ...shop, contactEmail: "hi@example.com" }} t={t} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("mailto:hi@example.com");
  });

  it("names the shop in plain words when it has no channel", () => {
    const { container } = render(<MedicalReviewContact shop={shop} t={t} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe(t("waiver.medicalContactNone", { shop: "Blue Mantis" }));
  });
});
