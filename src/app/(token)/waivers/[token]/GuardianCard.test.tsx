// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { GuardianCard } from "./GuardianCard";
import { WAIVER_FIELD_ERROR } from "./waiver-fields";

afterEach(cleanup);

const t = diverTranslator("en-US");

describe("GuardianCard", () => {
  it("heads the card, names the diver, and ends with the sign block it is handed", () => {
    const { container } = render(
      <GuardianCard diverName="Mia Lopez" draftGuardian={null} namedFieldError={undefined} t={t}>
        <button type="submit">Sign</button>
      </GuardianCard>,
    );
    expect(screen.getByRole("heading", { name: t("waiver.guardianHeading") })).toBeTruthy();
    expect(container.textContent).toContain("Mia Lopez");
    expect(container.lastElementChild?.lastElementChild?.textContent).toBe("Sign");
  });

  it("keeps a saved draft across a refusal", () => {
    render(
      <GuardianCard
        diverName="Mia Lopez"
        draftGuardian={{
          name: "Ana Lopez",
          email: null,
          relationship: "parent",
          acknowledged: true,
        }}
        namedFieldError={undefined}
        t={t}
      >
        {null}
      </GuardianCard>,
    );
    expect((document.getElementById("guardianName") as HTMLInputElement).value).toBe("Ana Lopez");
    expect((document.getElementById("guardianAcknowledged") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("wires the agreement's refusal to the words under it", () => {
    render(
      <GuardianCard
        diverName="Mia Lopez"
        draftGuardian={null}
        namedFieldError={WAIVER_FIELD_ERROR.guardianAcknowledged}
        t={t}
      >
        {null}
      </GuardianCard>,
    );
    const box = document.getElementById("guardianAcknowledged");
    expect(box?.getAttribute("aria-describedby")).toBe("guardianAcknowledged-error");
    expect(document.getElementById("guardianAcknowledged-error")).toBeTruthy();
  });
});
