// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { DeckCountNote, DeckCountPanel } from "./DeckCount";

afterEach(cleanup);
const t = staffTranslator("en-US");

/**
 * **The deck count's words** (issue #4248): a calm line when the deck and the
 * roll call differ, silence otherwise, and no danger ink either way.
 */
describe("DeckCountNote", () => {
  it("names both numbers in warning ink when they differ", () => {
    render(<DeckCountNote comparison={{ kind: "differs", counted: 11, aboard: 12 }} t={t} />);
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent(t("manifest.deckCount.differs", { counted: 11, aboard: 12 }));
    expect(note.className).toContain("text-warning-strong");
    expect(note.className).not.toContain("danger");
  });

  it("says nothing when they match or nobody counted", () => {
    const { container, rerender } = render(
      <DeckCountNote comparison={{ kind: "matches", counted: 12 }} t={t} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<DeckCountNote comparison={null} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DeckCountPanel", () => {
  const action = async () => ({ ok: true }) as const;

  it("prefills the newest count and says when it agrees", () => {
    render(
      <DeckCountPanel
        action={action}
        counted={12}
        comparison={{ kind: "matches", counted: 12 }}
        t={t}
      />,
    );
    expect(screen.getByLabelText(t("manifest.deckCount.label"))).toHaveValue(12);
    expect(screen.getByText(t("manifest.deckCount.matches", { counted: 12 }))).toBeInTheDocument();
  });

  it("starts empty with no count, never at zero", () => {
    render(<DeckCountPanel action={action} counted={null} comparison={null} t={t} />);
    expect(screen.getByLabelText(t("manifest.deckCount.label"))).toHaveValue(null);
  });
});
