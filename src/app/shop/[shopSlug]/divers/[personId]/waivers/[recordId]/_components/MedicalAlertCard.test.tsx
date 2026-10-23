// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetRevealedMedicalAlerts } from "@/components/MedicalAlertReveal";
import { staffTranslator } from "@/i18n/staff-messages";
import { MedicalAlertCard } from "./MedicalAlertCard";

afterEach(() => {
  cleanup();
  forgetRevealedMedicalAlerts();
});

const t = staffTranslator("en-US");
const ALERT = "Stent placed in June, on blood thinners.";

/** Issue #2960: the signed record says what the words are and are not, beside them. */
describe("MedicalAlertCard", () => {
  it("shows the owner the words with the line that nobody reviewed them", async () => {
    const show = vi.fn(async () => ({ ok: true, text: ALERT }) as const);
    render(
      <MedicalAlertCard
        onFile
        show={show}
        identityHeld={false}
        erasedAt={null}
        signatureMethod="typed_consent"
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );
    expect(screen.queryByText(ALERT)).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: t("waiversStaff.record.medicalAlertShow") }),
      );
    });
    expect(await screen.findByText(ALERT)).toBeInTheDocument();
    expect(screen.getByText(t("waiversStaff.record.medicalAlertNotReviewed"))).toBeInTheDocument();
  });
});
