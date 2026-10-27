// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { CompletedMedicalState } from "./completed-medical-state";
import { completedWaiverRail, WaiverCompleted } from "./WaiverCompleted";

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
  showPrepHelp = true,
) {
  return (
    <WaiverCompleted
      shop={shop}
      t={t}
      locale="en-US"
      medicalState={medicalState}
      showPrepHelp={showPrepHelp}
      doctorPath={doctorPath}
      signedRail={completedWaiverRail(medicalState !== "complete", false)}
      diveSitesList={[]}
    />
  );
}
describe("signed waiver receipt", () => {
  it.each([false, true])(
    "keeps Medical open on a held signed receipt, shop questions=%s",
    (hasShopQuestions) => {
      const heldRail = completedWaiverRail(true, hasShopQuestions);
      const clearRail = completedWaiverRail(false, hasShopQuestions);
      expect(heldRail.medical).toBe(false);
      expect(heldRail.sign).toBe(true);
      expect(heldRail.done).toBe(heldRail.total - 1);
      expect(clearRail.medical).toBe(true);
      expect(clearRail.done).toBe(clearRail.total);
    },
  );
  it("puts the legal receipt then the actual referral before general preparation", () => {
    render(receipt("referral"));
    const signed = screen.getByText(t("waiver.signedBody"));
    const next = screen.getByText(t("waiver.medicalReferralNext"));
    const doctor = screen.getByRole("link", { name: t("waiver.doctor.open") });
    const prep = screen.getByText(t("waiver.prepLinkHelp"));
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
    expect(screen.getByText(t("waiver.prepLinkHelp"))).toBeVisible();
    expect(screen.queryByRole("link", { name: t("waiver.seeWhatsLeft") })).toBeNull();
    expect(container.querySelector("[data-medical-next]")).toBeNull();
    expect(container.textContent).not.toMatch(
      /cleared to dive|all done|off your mind|see you at the dock/i,
    );
  });
  it("calls only the waiver signed for a counter handoff", () => {
    render(
      <WaiverCompleted
        shop={shop}
        t={t}
        locale="en-US"
        medicalState="complete"
        showPrepHelp={false}
        doctorPath={null}
        signedRail={completedWaiverRail(false, false)}
        diveSitesList={[]}
        waiverOnly
      />,
    );
    expect(screen.getByRole("heading", { name: "Waiver signed" })).toBeVisible();
    expect(screen.queryByText(t("capability.waiverDone"))).toBeNull();
    expect(screen.queryByRole("link", { name: t("waiver.seeWhatsLeft") })).toBeNull();
  });
  it("retains contact with no booking or doctor door", () => {
    render(receipt("referral", null, false));
    expect(screen.getByText(t("waiver.medicalReferralNext"))).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
