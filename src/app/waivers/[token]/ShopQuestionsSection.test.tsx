// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { ShopQuestion } from "@/lib/waiver-questions";
import {
  SHOP_QUESTIONS_ANCHOR,
  ShopQuestionsSection,
  shopQuestionAnchor,
} from "./ShopQuestionsSection";

afterEach(cleanup);

const t = diverTranslator("en-US");

const QUESTIONS: ShopQuestion[] = [
  { id: "insured0001", kind: "yes_no", prompt: "Do you carry dive insurance?", required: true },
  {
    id: "heard000001",
    kind: "choice",
    prompt: "How did you hear about us?",
    required: false,
    options: ["A friend", "Online search"],
  },
  { id: "dives000001", kind: "number", prompt: "Dives logged so far", required: false },
  { id: "hotel000001", kind: "text", prompt: "Where are you staying?", required: true },
];

function renderSection(
  overrides: Partial<Parameters<typeof ShopQuestionsSection>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <ShopQuestionsSection
      questions={QUESTIONS}
      draft={{}}
      shopName="Blue Mantis Divers"
      minorName={null}
      refused={undefined}
      t={t}
      {...overrides}
    />,
  );
}

/** Glossary *Shop question*; dive-domain review C4 (kept apart from the medical form). */
describe("ShopQuestionsSection", () => {
  it("names the shop in its own heading, apart from the medical questionnaire", () => {
    const { container } = renderSection();
    expect(screen.getByText("Questions from Blue Mantis Divers")).toBeTruthy();
    expect(container.querySelector(`#${SHOP_QUESTIONS_ANCHOR}`)).not.toBeNull();
    // Its own field names, never the questionnaire's `q_` ones.
    for (const input of container.querySelectorAll("input[name]")) {
      expect(input.getAttribute("name")).toMatch(/^sq_/);
    }
  });

  // Dive-domain review 1, S4: a health answer typed here is never read as a
  // disclosure, so the diver is told where health belongs. Never a gate.
  it("sends health back to the medical questionnaire in one line", () => {
    renderSection();
    expect(screen.getByText(t("waiver.shopQuestionsHealthNote"))).toBeTruthy();
  });

  // Review 2, S6: a number typed in a form the draft could not read as one
  // comes back as typed, so the refusal under it makes sense.
  it("shows a number answer the draft kept as typed", () => {
    renderSection({ draft: { dives000001: "40ish" } });
    expect(
      (screen.getByRole("textbox", { name: /Dives logged so far/ }) as HTMLInputElement).value,
    ).toBe("40ish");
  });

  it("pre-selects no answer for any kind", () => {
    const { container } = renderSection();
    expect(container.querySelectorAll("input:checked")).toHaveLength(0);
    for (const input of container.querySelectorAll<HTMLInputElement>("input:not([type=radio])")) {
      expect(input.value).toBe("");
    }
  });

  it("restores only what the draft holds", () => {
    const { container } = renderSection({ draft: { insured0001: false, dives000001: 12 } });
    const checked = container.querySelectorAll<HTMLInputElement>("input:checked");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.value).toBe("no");
    expect(
      (document.getElementById(shopQuestionAnchor("dives000001")) as HTMLInputElement).value,
    ).toBe("12");
  });

  it("marks a required question for the rail and says which ones are optional", () => {
    const { container } = renderSection();
    expect(
      container.querySelectorAll('[name="sq_insured0001"][data-shop-question-required]'),
    ).toHaveLength(2);
    expect(
      container.querySelector('[name="sq_hotel000001"][data-shop-question-required]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[name="sq_dives000001"][data-shop-question-required]'),
    ).toBeNull();
    expect(screen.getAllByText(t("common.optional"))).toHaveLength(2);
  });

  it("asks a guardian about the minor by name", () => {
    renderSection({ minorName: "Maya" });
    expect(
      screen.getByText(
        "Answer these about Maya. Blue Mantis Divers keeps the answers with this waiver.",
      ),
    ).toBeTruthy();
  });

  it("puts a refusal under the question it names, and nowhere else", () => {
    const text = t("waiver.errorShopQuestionRequired");
    const { container } = renderSection({ refused: { questionId: "insured0001", text } });
    expect(screen.getAllByText(text)).toHaveLength(1);
    expect(
      container
        .querySelector(`#${shopQuestionAnchor("insured0001")}`)
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
  });
});
