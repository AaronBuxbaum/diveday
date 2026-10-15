// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agencyCheckCopy } from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-copy";
import { staffTranslator } from "@/i18n/staff-messages";
import { AgencyCheck } from "./AgencyCheck";

/**
 * A PADI card on the diver record at a shop whose PADI checks are off
 * (H-121): the link stays, and with the extension here a muted line says who
 * can turn the checks on.
 */
const t = staffTranslator("en-US");
const OFF =
  "PADI checks are off for this shop. An owner or manager can turn them on in Settings, Bookings & waivers.";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-diveday-cert-check");
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

    document.documentElement.setAttribute("data-diveday-cert-check", "1.4.0");
    renderPadiCard(OFF);
    expect(screen.getByRole("link", { name: "Check with PADI (member sign-in)" })).toBeVisible();
    expect(screen.getByText(OFF)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check with PADI" })).toBeNull();
  });

  it("says nothing more for a card whose check is simply not offered", () => {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.4.0");
    renderPadiCard(undefined);
    expect(screen.queryByText(OFF)).toBeNull();
  });
});
