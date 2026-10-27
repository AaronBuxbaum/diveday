// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { CompletedMedicalState } from "./completed-medical-state";
import { WaiverCompleted } from "./WaiverCompleted";
import { waiverRailProgress } from "./WaiverStepRail";

const t = diverTranslator("en-US");
const shop = {
  name: "Reef",
  contactEmail: "desk@example.test",
  contactPhone: null,
  depthUnit: "meters" as const,
};
afterEach(cleanup);
function receipt(
  medicalState: CompletedMedicalState,
  doctorPath: string | null = "/waivers/private/doctor",
  readyPath: string | null = "/ready/private",
) {
  return (
    <WaiverCompleted
      shop={shop}
      t={t}
      locale="en-US"
      medicalState={medicalState}
      readyPath={readyPath}
      doctorPath={doctorPath}
      signedRail={waiverRailProgress({
        medicalAnswered: 0,
        medicalTotal: 0,
        medicalStillOpen: medicalState !== "complete",
        signed: true,
      })}
      diveSitesList={[]}
    />
  );
}
describe("signed waiver receipt", () => {
  it("puts the legal receipt then the actual referral before general preparation", () => {
    render(receipt("referral"));
    const signed = screen.getByText(t("waiver.signedBody"));
    const next = screen.getByText(t("waiver.medicalReferralNext"));
    const doctor = screen.getByRole("link", { name: t("waiver.doctor.open") });
    const prep = screen.getByRole("link", { name: t("waiver.seeWhatsLeft") });
    expect(signed.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(next.compareDocumentPosition(doctor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(doctor.compareDocumentPosition(prep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(doctor).toHaveAttribute("href", "/waivers/private/doctor");
    expect(screen.getByTestId("waiver-step-rail")).toBeVisible();
  });
  it.each([
    ["shop_review", "medicalShopReviewNext"],
    ["form_sent", "medicalFormWaiting"],
    ["declined", "medicalDeclinedNext"],
  ] as const)("keeps %s honest even when a doctor URL could exist", (state, key) => {
    render(receipt(state));
    expect(screen.getByText(t(`waiver.${key}`))).toBeVisible();
    expect(screen.getByRole("link", { name: /desk@example.test/ })).toHaveAttribute(
      "href",
      "mailto:desk@example.test",
    );
    expect(screen.queryByRole("link", { name: t("waiver.doctor.open") })).toBeNull();
    expect(screen.queryByText(t("waiver.medicalReferralNext"))).toBeNull();
  });
  it("keeps completed receipt/prep truthful without asserting boarding clearance", () => {
    const { container } = render(receipt("complete"));
    expect(screen.getByText(t("waiver.signedBody"))).toBeVisible();
    expect(screen.getByRole("link", { name: t("waiver.seeWhatsLeft") })).toBeVisible();
    expect(container.querySelector("[data-medical-next]")).toBeNull();
    expect(container.textContent).not.toMatch(
      /cleared to dive|all done|off your mind|see you at the dock/i,
    );
  });
  it("retains contact with no booking or doctor door", () => {
    render(receipt("referral", null, null));
    expect(screen.getByText(t("waiver.medicalReferralNext"))).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
