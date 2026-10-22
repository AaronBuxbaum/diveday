// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/shop/[shopSlug]/actions", () => ({ helpRequestAction: vi.fn() }));

import {
  HelpRequestControl,
  type HelpRequestCopy,
  HelpRequestProvider,
} from "./HelpRequestControl";

afterEach(cleanup);

const copy: HelpRequestCopy = {
  arrange: "Arrange help",
  change: "Change helper",
  complete: "Help completed",
  confirm: "Confirm helper",
  cancel: "Cancel",
  selector: "Crew member",
  speakFirst: "Speak to them first, then confirm.",
  meeting: "Departure meeting",
  saving: "Saving…",
  assigned: "Helper saved.",
  completed: "Help marked complete.",
  undone: "Assignment restored.",
  stale: "This request changed. Refresh the page and check it again.",
  invalidHelper: "That crew member is no longer assigned to this departure.",
  failed: "Couldn’t save this change. Try again.",
  undo: "Undo",
  undoPending: "Restoring…",
  dismiss: "Dismiss",
};

function renderControl(status: "requested" | "acknowledged" = "requested", helper = false) {
  return render(
    <HelpRequestProvider copy={copy}>
      <HelpRequestControl
        requestId="request-1"
        revision={7}
        status={status}
        helperPersonId={helper ? "person-1" : null}
        helperPersonName={helper ? "Sam Rivera" : null}
        crew={[{ personId: "person-1", fullName: "Sam Rivera" }]}
        meetingInstructions="North dock · Meet by the blue flag"
      />
    </HelpRequestProvider>,
  );
}

describe("HelpRequestControl", () => {
  it("opens a read-only inline form with the crew choice and departure instructions", () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: "Arrange help" }));
    expect(screen.getByLabelText("Crew member")).toBeTruthy();
    expect(screen.getByText("Speak to them first, then confirm.")).toBeTruthy();
    expect(screen.getByText("Departure meeting: North dock · Meet by the blue flag")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm helper" })).toBeTruthy();
    expect(document.querySelector('input[name="expectedRevision"]')).toHaveValue("7");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Crew member")).toBeNull();
  });

  it("offers completion only for an assigned helper, with a separate change action", () => {
    const { rerender } = renderControl("acknowledged", true);
    expect(screen.getByRole("button", { name: "Change helper" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help completed" })).toBeTruthy();
    expect(document.querySelector('input[name="expectedRevision"]')).toHaveValue("7");
    rerender(
      <HelpRequestProvider copy={copy}>
        <HelpRequestControl
          requestId="request-1"
          revision={7}
          status="acknowledged"
          helperPersonId={null}
          helperPersonName={null}
          crew={[]}
          meetingInstructions={null}
        />
      </HelpRequestProvider>,
    );
    expect(screen.getByRole("button", { name: "Arrange help" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Help completed" })).toBeNull();
  });
});
