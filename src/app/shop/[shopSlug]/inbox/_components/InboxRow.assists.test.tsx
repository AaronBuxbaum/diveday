// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { InboxRow } from "./InboxRow";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** What Claude stored on a German message (the `inbox-sort` and `translate` assists). */
const MESSAGE: InboxMessageRow["message"] = {
  id: "8f000000-1111-4222-8333-444444444445",
  shopId: "9f000000-1111-4222-8333-444444444444",
  personId: "af000000-1111-4222-8333-444444444444",
  channel: "email",
  fromAddress: "lena.vogel@example.org",
  subject: "Samstag",
  body: "Ich muss leider absagen, mein Flug ist gestrichen.",
  mediaCount: 0,
  receivedAt: new Date("2026-07-21T13:30:00.000Z"),
  answeredAt: null,
  providerMessageId: "ses-a1",
  emailMessageId: null,
  inReplyToDeliveryId: null,
  keywordIntent: null,
  bookingId: null,
  senderAuthenticated: true,
  spamFlagged: false,
  assistIntent: "cancel",
  assistUrgent: true,
  assistLanguage: "de",
  assistTranslation: "Unfortunately I have to cancel, my flight is canceled.",
  assistTranslatedTo: "en-US",
  assistedAt: new Date("2026-07-21T13:31:00.000Z"),
  deletedAt: null,
  createdAt: new Date("2026-07-21T13:30:00.000Z"),
};

function renderRow(requestAction?: (formData: FormData) => Promise<void>) {
  render(
    <ul>
      <InboxRow
        row={{ message: MESSAGE, personName: "Lena Vogel" }}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/Cancun"
        now={new Date("2026-07-21T14:00:00.000Z")}
        t={t}
        deleteAction={vi.fn()}
        doneAction={vi.fn()}
        requestAction={requestAction}
      />
    </ul>,
  );
}

describe("a message Claude has read, while the shop's assists are on", () => {
  it("says what it asks and that it is urgent, and keeps the diver's own words", () => {
    renderRow(vi.fn());
    expect(screen.getByText(/Ich muss leider absagen/)).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText(/Wants to cancel/)).toBeInTheDocument();
    expect(
      screen.getByText("In German: Unfortunately I have to cancel, my flight is canceled."),
    ).toBeInTheDocument();
  });

  it("offers to make a request from it, posting the message", async () => {
    renderRow(vi.fn());
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Lena Vogel" }),
    );
    const request = screen.getByRole("button", {
      name: "Draft a booking request from Lena Vogel’s message",
    });
    expect(request.closest("form")?.querySelector('input[name="messageId"]')).toHaveValue(
      MESSAGE.id,
    );
  });
});

describe("the same message while the assists are dark", () => {
  it("shows nothing Claude stored and offers no request", async () => {
    renderRow(undefined);
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Lena Vogel" }),
    );
    expect(screen.queryByText("Urgent")).toBeNull();
    expect(screen.queryByText(/Wants to cancel/)).toBeNull();
    expect(screen.queryByText(/In German/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Draft a booking request/ })).toBeNull();
  });
});
