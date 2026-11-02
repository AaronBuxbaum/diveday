// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimilarDiver } from "@/db/divers";
import { staffTranslator } from "@/i18n/staff-messages";
import { NameMatchPrompt } from "./NameMatchPrompt";

afterEach(cleanup);

const match: SimilarDiver = {
  id: "person-1",
  fullName: "Nadia Ruiz",
  email: null,
  phone: null,
  dateOfBirth: null,
  lastDiveDayAt: null,
};

function renderPrompt(matches: SimilarDiver[], hiddenFields?: Record<string, string>) {
  return render(
    <NameMatchPrompt
      matches={matches}
      tripId="trip-1"
      confirmName="Nadia Ruis"
      confirmEmail="nadia@example.test"
      seatKnownAction={vi.fn()}
      seatNewAction={vi.fn()}
      hiddenFields={hiddenFields}
      t={staffTranslator("en-US")}
      locale="en-US"
      timeZone="America/New_York"
    />,
  );
}

describe("NameMatchPrompt", () => {
  it("renders nothing when no name sounds alike", () => {
    const { container } = renderPrompt([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("carries the request on both the pick and the create-anyway form, and the guess on the pick only", () => {
    const { container } = renderPrompt([match], { request: "req-9" });

    expect(container.querySelectorAll('input[name="request"][value="req-9"]')).toHaveLength(2);
    expect(container.querySelectorAll('input[name="fromNameMatch"]')).toHaveLength(1);
    const create = screen.getByRole("button", { name: "Create new diver anyway" }).closest("form");
    expect(create?.querySelector('input[name="force"]')).toHaveValue("true");
    expect(create?.querySelector('input[name="fromNameMatch"]')).toBeNull();
  });

  it("carries no request when the shell has none", () => {
    const { container } = renderPrompt([match]);
    expect(container.querySelector('input[name="request"]')).toBeNull();
  });
});
