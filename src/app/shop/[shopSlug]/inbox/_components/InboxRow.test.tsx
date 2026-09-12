// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { InboxRow } from "./InboxRow";

afterEach(cleanup);

const t = staffTranslator("en-US");

const MESSAGE: InboxMessageRow["message"] = {
  id: "8f000000-1111-4222-8333-444444444444",
  shopId: "9f000000-1111-4222-8333-444444444444",
  personId: "af000000-1111-4222-8333-444444444444",
  channel: "email",
  fromAddress: "priya.sharma@example.com",
  subject: "Re: Your Saturday departure",
  body: "Could I switch to the afternoon boat on Saturday?",
  mediaCount: 0,
  receivedAt: new Date("2026-07-21T13:30:00.000Z"),
  answeredAt: null,
  providerMessageId: "ses-1",
  emailMessageId: null,
  inReplyToDeliveryId: null,
  keywordIntent: null,
  deletedAt: null,
  createdAt: new Date("2026-07-21T13:30:00.000Z"),
};

function renderRow(
  overrides: Partial<InboxMessageRow["message"]> = {},
  personName: string | null = "Priya Sharma",
) {
  const { container } = render(
    <ul>
      <InboxRow
        row={{ message: { ...MESSAGE, ...overrides }, personName }}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/Cancun"
        t={t}
        deleteAction={vi.fn()}
      />
    </ul>,
  );
  return container;
}

describe("a message on file", () => {
  it("opens the diver's record at the conversation", () => {
    renderRow();
    expect(screen.getByRole("link", { name: "Open the record for Priya Sharma" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/af000000-1111-4222-8333-444444444444#conversation",
    );
  });

  it("says the channel, since that is where the answer goes", () => {
    renderRow();
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("keeps the diver's own address off a row that has a name", () => {
    renderRow();
    expect(screen.queryByText(/priya\.sharma@example\.com/)).toBeNull();
  });
});

describe("a message from a stranger", () => {
  it("shows the address instead of a door, because there is no record to open", () => {
    renderRow({ personId: null, fromAddress: "marta.keller@example.net" }, null);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Unknown sender")).toBeInTheDocument();
    expect(screen.getByText(/marta\.keller@example\.net/)).toBeInTheDocument();
  });

  it("offers a Delete, because nothing else on any surface can finish this row", () => {
    // Issue #1506: no record means no door and no composer, so without this
    // the row could only be read — and it went on counting against Today's
    // unanswered messages for as long as it sat there.
    const container = renderRow({ personId: null, fromAddress: "marta.keller@example.net" }, null);
    expect(
      screen.getByRole("button", { name: "Delete the message from marta.keller@example.net" }),
    ).toBeInTheDocument();
    // The id the action deletes rides in the form, not in the URL.
    expect(container.querySelector('input[name="messageId"]')).toHaveValue(MESSAGE.id);
  });
});

describe("what a row with a record behind it does not offer", () => {
  it("has no Delete: it has a door and a composer, and the way to finish it is to answer it", () => {
    renderRow();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });
});

describe("what arrived with it", () => {
  it("counts attachments and says they stayed with the sender", () => {
    renderRow({ mediaCount: 2 });
    expect(screen.getByText("2 attachments, still with the sender")).toBeInTheDocument();
  });

  it("leads with the diver's words when the channel carries no subject", () => {
    const container = renderRow({
      channel: "whatsapp",
      subject: null,
      body: "Running 15 min late",
    });
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Running 15 min late")).toBeInTheDocument();
    // No empty subject slot, and nothing apologising for one.
    expect(container.textContent).not.toMatch(/subject/i);
  });
});
