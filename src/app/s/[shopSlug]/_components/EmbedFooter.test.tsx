// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { EmbedFooter } from "./EmbedFooter";

const t = diverTranslator("en-US");

afterEach(cleanup);

describe("EmbedFooter", () => {
  it("opens the full schedule outside the frame and names the zone", () => {
    render(
      <EmbedFooter
        isEmbed
        shopSlug="blue-mantis"
        zoneNote="Times are Eastern"
        hostCarriesCredit={false}
        t={t}
      />,
    );
    const out = screen.getByRole("link", { name: t("schedule.embedSeeFullSchedule") });
    expect(out.getAttribute("href")).toBe("/s/blue-mantis");
    expect(out.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("Times are Eastern")).toBeTruthy();
    const credit = screen.getByRole("link", { name: t("shopChrome.credit") });
    expect(credit.getAttribute("href")).toContain("utm_campaign=blue-mantis");
  });

  it("draws no credit when the host page carries it", () => {
    render(<EmbedFooter isEmbed shopSlug="blue-mantis" zoneNote={null} hostCarriesCredit t={t} />);
    expect(screen.queryByRole("link", { name: t("shopChrome.credit") })).toBeNull();
  });

  it("renders nothing outside the embed", () => {
    const { container } = render(
      <EmbedFooter
        isEmbed={false}
        shopSlug="blue-mantis"
        zoneNote={null}
        hostCarriesCredit={false}
        t={t}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
