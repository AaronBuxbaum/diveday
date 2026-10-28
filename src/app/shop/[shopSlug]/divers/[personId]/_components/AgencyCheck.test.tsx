// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agencyCheckCopy } from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-copy";
import { staffTranslator } from "@/i18n/staff-messages";
import { AgencyCheck } from "./AgencyCheck";

vi.mock("@/components/useCertCheckExtension", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/useCertCheckExtension")>()),
  requestAgencyPage: vi.fn(),
}));
vi.mock("@/app/actions/agency-check-report", () => ({
  reportAgencyCheckPageAction: vi.fn(async () => {}),
}));
const { requestAgencyPage } = await import("@/components/useCertCheckExtension");
const { reportAgencyCheckPageAction } = await import("@/app/actions/agency-check-report");

/**
 * A PADI card on the diver record at a shop whose PADI checks are off
 * (H-121): the link stays, and with the extension here a muted line says who
 * can turn the checks on.
 */
const t = staffTranslator("en-US");
const OFF =
  "PADI checks are off for this shop. An owner or manager can turn them on in Settings, Features.";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-diveday-cert-check");
  vi.mocked(requestAgencyPage).mockReset();
  vi.mocked(reportAgencyCheckPageAction).mockClear();
});

const LENA = {
  agency: "ssi" as const,
  firstName: "Lena",
  lastName: "Ortiz",
  birthDate: null,
  cardNumber: "123456",
};

function renderSsiCard(action = vi.fn(async () => null)) {
  render(
    <AgencyCheck
      href="https://my.divessi.com/online_diver_check"
      query={LENA}
      certificationId="c-1"
      awaiting
      action={action}
      copy={agencyCheckCopy(t, "ssi", "Check with SSI")}
    />,
  );
  return action;
}

describe("AgencyCheck and the extension's version", () => {
  it("leaves SSI's manual check to the staffer without judging a page", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.6.0");
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: false, reason: "manual_opened" });
    const action = renderSsiCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check with SSI" }));
    });
    expect(
      screen.getByText(
        "Review SSI’s terms and complete the check, then return to mark the correct card certified.",
      ),
    ).toBeVisible();
    expect(action).not.toHaveBeenCalled();
    expect(reportAgencyCheckPageAction).not.toHaveBeenCalled();
  });
  it("draws the agency's link, not the button, for a copy older than DiveDay needs", () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.4.0");
    renderSsiCard();
    expect(screen.getByRole("link", { name: "Check with SSI" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check with SSI" })).toBeNull();
    cleanup();

    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    renderSsiCard();
    expect(screen.getByRole("button", { name: "Check with SSI" })).toBeVisible();
  });
});

describe("AgencyCheck when the agency's page cannot be read", () => {
  const shape = {
    path: "/online diver check",
    title: "",
    headings: [],
    boxes: [{ tag: "input" as const, type: "text" as const, words: "_" }],
    buttons: ["search"],
    forms: 1,
    frames: 0,
    password: false,
    captcha: true,
  };

  it("says SSI asks for a human, with SSI's link, judges nothing, and logs the page's shape", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    vi.mocked(requestAgencyPage).mockResolvedValue({
      ok: false,
      reason: "captcha",
      pageShape: shape,
    });
    const action = renderSsiCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check with SSI" }));
    });
    expect(
      await screen.findByText("SSI is asking if you’re human. Check on its page."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Check with SSI" })).toBeVisible();
    // Domain review R7 (operational): the link takes the button's place.
    expect(screen.queryByRole("button", { name: "Check with SSI" })).toBeNull();
    expect(action).not.toHaveBeenCalled();
    const [[posted]] = vi.mocked(reportAgencyCheckPageAction).mock.calls as unknown as [[FormData]];
    expect(Object.fromEntries(posted.entries())).toEqual({
      agency: "ssi",
      reason: "captcha",
      version: "1.5.0",
      pageShape: JSON.stringify(shape),
    });
    // The diver's details never ride along.
    expect(JSON.stringify(Object.fromEntries(posted.entries()))).not.toMatch(/Lena|Ortiz|123456/);
  });

  /**
   * Domain review R7 (operational) 1: the report is fire and forget and may
   * never arrive, so the sentence never says DiveDay was told.
   */
  it("says SSI's page changed, claims no report arrived, and sends nothing for a signed-out PADI page", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    vi.mocked(reportAgencyCheckPageAction).mockRejectedValueOnce(new Error("dropped"));
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: false, reason: "page_changed" });
    renderSsiCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check with SSI" }));
    });
    const sentence = await screen.findByText("SSI’s page has changed. Check on its page.");
    expect(sentence).toBeVisible();
    expect(sentence.textContent).not.toMatch(/told|DiveDay/);
    expect(screen.getByRole("link", { name: "Check with SSI" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check with SSI" })).toBeNull();
    expect(reportAgencyCheckPageAction).toHaveBeenCalledTimes(1);
    cleanup();

    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: false, reason: "signed_out" });
    renderSsiCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check with SSI" }));
    });
    expect(reportAgencyCheckPageAction).toHaveBeenCalledTimes(1);
  });
});

describe("AgencyCheck when this copy of the extension does not check the agency", () => {
  /** Domain review R7 (operational), nit: its own sentence, and the link in the button's place. */
  it("says to update the extension, with SSI's link", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: false, reason: "unsupported" });
    renderSsiCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check with SSI" }));
    });
    expect(
      await screen.findByText("This copy of the extension doesn’t check SSI. Update it."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Check with SSI" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check with SSI" })).toBeNull();
  });

  it("keeps the button for another try, beside the link, after a page it could not read", async () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    vi.mocked(requestAgencyPage).mockResolvedValue({ ok: false, reason: "timeout" });
    renderSsiCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check with SSI" }));
    });
    expect(await screen.findByText("Couldn’t read SSI’s page.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Check with SSI" })).toBeEnabled();
    expect(screen.getAllByRole("link", { name: "Check with SSI" })).toHaveLength(1);
  });
});

function renderPadiCard(offNote: string | undefined) {
  render(
    <AgencyCheck
      href="https://pro.padi.com/"
      query={null}
      certificationId="c-1"
      awaiting
      action={vi.fn(async () => null)}
      copy={agencyCheckCopy(t, "padi", "Check with PADI (member sign-in)")}
      offNote={offNote}
    />,
  );
}

describe("AgencyCheck with PADI's checks off", () => {
  /** Domain review R4-5. */
  it("keeps the link, and says who can turn the checks on only when the extension is here", () => {
    renderPadiCard(OFF);
    expect(screen.getByRole("link", { name: "Check with PADI (member sign-in)" })).toBeVisible();
    expect(screen.queryByText(OFF)).toBeNull();
    cleanup();

    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    renderPadiCard(OFF);
    expect(screen.getByRole("link", { name: "Check with PADI (member sign-in)" })).toBeVisible();
    expect(screen.getByText(OFF)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check with PADI" })).toBeNull();
  });

  it("says nothing more for a card whose check is simply not offered", () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    renderPadiCard(undefined);
    expect(screen.queryByText(OFF)).toBeNull();
  });
});
