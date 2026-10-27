// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { TemplateValueComparison } from "./TemplateValueComparison";

afterEach(cleanup);
const t = staffTranslator("en-US");
const diverT = diverTranslator("en-US");

describe("template values before replacement", () => {
  it("shows complete current and template text, with explicit empty values and converted depth", () => {
    render(
      <TemplateValueComparison
        changes={[
          {
            field: "description",
            current: "Our reef briefing",
            latest: "Revised reef briefing",
            shopChanged: true,
          },
          { field: "currentNote", current: null, latest: "Use the mooring", shopChanged: false },
          { field: "maxDepthMeters", current: 18.288, latest: 24.384, shopChanged: false },
        ]}
        fieldGuideOn
        depthUnit="feet"
        locale="en-US"
        t={t}
        diverT={diverT}
      />,
    );
    expect(screen.getByText("Our reef briefing")).toBeVisible();
    expect(screen.getByText("Revised reef briefing")).toBeVisible();
    expect(screen.getByText(t("diveSites.edit.templateUpdates.empty"))).toBeVisible();
    expect(screen.getByText("60 ft")).toBeVisible();
    expect(screen.getByText("80 ft")).toBeVisible();
  });

  it("marks conservation text and guide-off fields as kept by the actual writer", () => {
    render(
      <TemplateValueComparison
        changes={[
          {
            field: "conservationNote",
            current: "Our conservation note",
            latest: "Catalog conservation note",
            shopChanged: true,
          },
          {
            field: "fieldGuideTipsHeading",
            current: "Our heading",
            latest: "Catalog heading",
            shopChanged: true,
          },
        ]}
        fieldGuideOn={false}
        depthUnit="meters"
        locale="en-US"
        t={t}
        diverT={diverT}
      />,
    );
    for (const title of ["Conservation note", "Field-guide heading"]) {
      const row = screen.getByRole("heading", { name: title }).closest("li");
      expect(row).not.toBeNull();
      expect(
        within(row as HTMLElement).getByText(t("diveSites.edit.templateUpdates.kept")),
      ).toBeVisible();
    }
  });
});
