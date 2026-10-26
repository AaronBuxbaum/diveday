// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HelpRequestActionResult } from "@/app/shop/[shopSlug]/actions";

const { helpRequestAction } = vi.hoisted(() => ({ helpRequestAction: vi.fn() }));
vi.mock("@/app/shop/[shopSlug]/actions", () => ({ helpRequestAction }));

import {
  HandledHelpRequests,
  HelpRequestControl,
  type HelpRequestCopy,
  HelpRequestProvider,
} from "./HelpRequestControl";

afterEach(cleanup);

const copy: HelpRequestCopy = {
  complete: "Help completed",
  confirm: "Confirm helper",
  cancel: "Cancel",
  selector: "Crew member",
  speakFirst: "Speak to them first, then confirm.",
  saving: "Saving…",
  assigned: "Helper saved.",
  completed: "Help marked complete.",
  undone: "Assignment restored.",
  reopened: "The helper is off this departure, so the request is back on the list.",
  stale: "This request changed. Refresh the page and check it again.",
  invalidHelper: "That crew member is no longer assigned to this departure.",
  failed: "Couldn’t save this change. Try again.",
  undoRefused:
    "Undo didn’t go through: the request, its booking or its departure changed. It stays complete.",
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
        label={helper ? "Change helper" : "Arrange help"}
        crew={[{ personId: "person-1", fullName: "Sam Rivera" }]}
        meetingLine="Departure meeting: North dock · Meet by the blue flag"
      />
    </HelpRequestProvider>,
  );
}

describe("HelpRequestControl", () => {
  it("closes the editor with Escape and returns focus to its action", () => {
    renderControl();
    const action = screen.getByRole("button", { name: "Arrange help" });
    fireEvent.click(action);
    const selector = screen.getByLabelText("Crew member");
    selector.focus();
    fireEvent.keyDown(selector, { key: "Escape" });
    expect(screen.queryByLabelText("Crew member")).toBeNull();
    expect(screen.getByRole("button", { name: "Arrange help" })).toHaveFocus();
  });
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
          label="Arrange help"
          crew={[]}
          meetingLine={null}
        />
      </HelpRequestProvider>,
    );
    expect(screen.getByRole("button", { name: "Arrange help" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Help completed" })).toBeNull();
  });

  it("does not preselect another crew member when the saved helper is gone", () => {
    render(
      <HelpRequestProvider copy={copy}>
        <HelpRequestControl
          requestId="request-1"
          revision={7}
          status="acknowledged"
          helperPersonId="person-gone"
          helperPersonName={null}
          label="Arrange help"
          crew={[
            { personId: "person-1", fullName: "Sam Rivera" },
            { personId: "person-2", fullName: "Ana Lopez" },
          ]}
          meetingLine={null}
        />
      </HelpRequestProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Arrange help" }));
    expect(screen.getByLabelText("Crew member")).toHaveValue("");
  });

  it("keeps the saved helper selected while they are still on the crew", () => {
    renderControl("acknowledged", true);
    fireEvent.click(screen.getByRole("button", { name: "Change helper" }));
    expect(screen.getByLabelText("Crew member")).toHaveValue("person-1");
  });
});

describe("HelpRequestProvider", () => {
  async function submitUndo(result: HelpRequestActionResult) {
    helpRequestAction.mockResolvedValueOnce({
      ok: true,
      requestId: "request-9",
      effect: "completed",
      helperPersonId: "person-1",
      revision: 8,
    } satisfies HelpRequestActionResult);
    helpRequestAction.mockResolvedValueOnce(result);
    render(
      <HelpRequestProvider copy={copy}>
        <HelpRequestControl
          requestId="request-9"
          revision={7}
          status="acknowledged"
          helperPersonId="person-1"
          helperPersonName="Sam Rivera"
          label="Change helper"
          crew={[{ personId: "person-1", fullName: "Sam Rivera" }]}
          meetingLine={null}
        />
      </HelpRequestProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Help completed" }));
    });
    expect(await screen.findByText("Help marked complete.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
  }

  it("shows why an undo was refused, though the handled request has no row", async () => {
    await submitUndo({ ok: false, requestId: "request-9", intent: "undo", reason: "stale" });
    expect((await screen.findByRole("alert")).textContent).toBe(copy.undoRefused);
    expect(screen.queryByText("Help marked complete.")).toBeNull();
  });

  it("shows a failed undo that was not a refusal as a plain failure", async () => {
    await submitUndo({ ok: false, requestId: "request-9", intent: "undo", reason: "error" });
    expect((await screen.findByRole("alert")).textContent).toBe(copy.failed);
  });

  it("says the request went back to the desk when undo reopened it", async () => {
    await submitUndo({
      ok: true,
      requestId: "request-9",
      effect: "reopened",
      helperPersonId: "person-1",
      revision: 9,
    });
    expect((await screen.findByRole("status")).textContent).toBe(copy.reopened);
  });
});

describe("HandledHelpRequests", () => {
  const rows = [
    {
      requestId: "request-4",
      revision: 12,
      helperPersonId: "person-1",
      line: "Ana Lopez: first-timer orientation (Reef · 8:00 AM), with Sam Rivera",
      reopenLabel: "Reopen",
      reopenAriaLabel: "Reopen help for Ana Lopez",
    },
  ];

  it("renders nothing when no request is handled", () => {
    const { container } = render(
      <HelpRequestProvider copy={copy}>
        <HandledHelpRequests summary="0 handled help requests" rows={[]} />
      </HelpRequestProvider>,
    );
    expect(container.querySelector("details")).toBeNull();
  });

  it("collapses the handled requests and reopens one through the undo transition", async () => {
    render(
      <HelpRequestProvider copy={copy}>
        <HandledHelpRequests summary="1 handled help request" rows={rows} />
      </HelpRequestProvider>,
    );
    expect(document.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByText("1 handled help request")).toBeTruthy();
    helpRequestAction.mockResolvedValueOnce({
      ok: true,
      requestId: "request-4",
      effect: "undone",
      helperPersonId: "person-1",
      revision: 13,
    } satisfies HelpRequestActionResult);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reopen help for Ana Lopez" }));
    });
    const form = helpRequestAction.mock.calls.at(-1)?.[1] as FormData;
    expect(Object.fromEntries(form)).toEqual({
      requestId: "request-4",
      expectedRevision: "12",
      helperPersonId: "person-1",
      intent: "undo",
    });
  });

  it("says why a reopen was refused when the request changed", async () => {
    render(
      <HelpRequestProvider copy={copy}>
        <HandledHelpRequests summary="1 handled help request" rows={rows} />
      </HelpRequestProvider>,
    );
    helpRequestAction.mockResolvedValueOnce({
      ok: false,
      requestId: "request-4",
      intent: "undo",
      reason: "stale",
    } satisfies HelpRequestActionResult);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reopen help for Ana Lopez" }));
    });
    expect((await screen.findByRole("alert")).textContent).toBe(copy.undoRefused);
  });
});
