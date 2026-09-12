// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadEntry } from "@/db/inbound-messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { HOUR_MS } from "@/lib/clock";
import { ConversationSection } from "./ConversationSection";

vi.mock("../actions", () => ({ replyToDiverAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
const NOW = new Date("2026-07-21T13:30:00.000Z");

function inbound(overrides: Partial<ThreadEntry & { direction: "inbound" }> = {}): ThreadEntry {
  return {
    direction: "inbound",
    message: {
      id: "8f000000-1111-4222-8333-444444444444",
      shopId: "9f000000-1111-4222-8333-444444444444",
      personId: "af000000-1111-4222-8333-444444444444",
      channel: "email",
      fromAddress: "priya.sharma@example.com",
      subject: "Re: Your Saturday departure",
      body: "Could I switch to the afternoon boat?",
      mediaCount: 0,
      receivedAt: new Date(NOW.getTime() - HOUR_MS),
      answeredAt: null,
      providerMessageId: "ses-1",
      emailMessageId: null,
      inReplyToDeliveryId: null,
      deletedAt: null,
      createdAt: new Date(NOW.getTime() - HOUR_MS),
      ...("message" in overrides ? overrides.message : {}),
    },
  } as ThreadEntry;
}

function outbound(status: "sent" | "failed" = "sent"): ThreadEntry {
  return {
    direction: "outbound",
    sentByName: "Marisol Vega",
    reply: {
      id: "bf000000-1111-4222-8333-444444444444",
      shopId: "9f000000-1111-4222-8333-444444444444",
      personId: "af000000-1111-4222-8333-444444444444",
      inboundMessageId: "8f000000-1111-4222-8333-444444444444",
      channel: "email",
      toAddress: "priya.sharma@example.com",
      body: "You’re on the 1pm boat now.",
      locale: "en-US",
      sentByPersonId: "cf000000-1111-4222-8333-444444444444",
      status,
      providerMessageId: status === "sent" ? "ses-2" : null,
      sendErrorCode: null,
      sendError: null,
      sentAt: NOW,
      deletedAt: null,
      createdAt: NOW,
    },
  } as ThreadEntry;
}

function renderSection(entries: ThreadEntry[], removed = false) {
  return render(
    <ConversationSection
      entries={entries}
      diverName="Priya Sharma"
      shopSlug="blue-mantis"
      personId="af000000-1111-4222-8333-444444444444"
      locale="en-US"
      timezone="America/Cancun"
      now={NOW}
      removed={removed}
      t={t}
    />,
  );
}

describe("a diver who never wrote", () => {
  it("renders nothing at all", () => {
    const { container } = renderSection([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a conversation", () => {
  it("shows both directions and who wrote each", () => {
    renderSection([inbound(), outbound()]);
    expect(screen.getByText("Could I switch to the afternoon boat?")).toBeInTheDocument();
    expect(screen.getByText("You’re on the 1pm boat now.")).toBeInTheDocument();
    expect(screen.getByText(/Marisol Vega replied/)).toBeInTheDocument();
  });

  it("says when a reply never reached them", () => {
    renderSection([inbound(), outbound("failed")]);
    expect(screen.getByText("This one did not reach them.")).toBeInTheDocument();
  });

  it("offers the composer on the channel the diver used", () => {
    renderSection([inbound()]);
    expect(screen.getByLabelText("Reply by email to priya.sharma@example.com")).toBeInTheDocument();
  });

  /**
   * The composer used to name only the channel, so a staffer answering a diver
   * whose message came from an address that is *not* the one on their record —
   * a work account, a partner's phone, a stranger who wrote about somebody
   * else's booking — could not see where the answer was going until after they
   * sent it. The label carries the destination now, in the sentence the
   * textarea is already announced by rather than as a caption beside it.
   */
  it("names the address it will write to, not only the channel", () => {
    renderSection([
      inbound({
        message: { fromAddress: "p.sharma@bigcorp.example" },
      } as Partial<ThreadEntry & { direction: "inbound" }>),
    ]);
    expect(screen.getByLabelText("Reply by email to p.sharma@bigcorp.example")).toBeInTheDocument();
  });

  /**
   * SMS is recorded and cannot be answered yet. The answerable test used to
   * read "not WhatsApp, or WhatsApp with an open window", so SMS passed it and
   * then fell to the `else` of the label ternary — offering a composer that
   * announced itself as **email** and would have written to a phone number.
   */
  it("offers no composer for a channel that cannot be answered", () => {
    renderSection([
      inbound({
        message: { channel: "sms", fromAddress: "13055550110", subject: null },
      } as Partial<ThreadEntry & { direction: "inbound" }>),
    ]);
    expect(screen.queryByLabelText(/^Reply by/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });
});

/**
 * Deleting a diver is soft, so their record and their thread stay readable —
 * the history is the point. What goes is the composer: `sendStaffReply` refuses
 * to write to a removed record, so offering the box would take a staffer's
 * words and refuse them afterwards.
 */
describe("a removed diver", () => {
  it("keeps the conversation readable but offers no composer", () => {
    renderSection([inbound()], true);
    expect(screen.getByText("Could I switch to the afternoon boat?")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Reply by/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("says why the box is gone rather than letting it vanish", () => {
    renderSection([inbound()], true);
    expect(
      screen.getByText("This diver’s record was removed, so replies are switched off."),
    ).toBeInTheDocument();
  });

  /**
   * The removal sentence wins over the WhatsApp one. Both are true of a removed
   * diver on a stale thread, and the removal is the durable reason: waiting for
   * a new message would not reopen this composer.
   */
  it("gives the removal reason, not the closed-window one, when both apply", () => {
    renderSection(
      [
        inbound({
          message: {
            channel: "whatsapp",
            subject: null,
            fromAddress: "13055550110",
            receivedAt: new Date(NOW.getTime() - 30 * HOUR_MS),
          },
        } as Partial<ThreadEntry & { direction: "inbound" }>),
      ],
      true,
    );
    expect(
      screen.getByText("This diver’s record was removed, so replies are switched off."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp takes a typed reply for 24 hours/)).toBeNull();
  });
});

describe("Meta's 24-hour window", () => {
  const whatsApp = (agoMs: number) =>
    inbound({
      message: {
        channel: "whatsapp",
        subject: null,
        fromAddress: "13055550110",
        body: "Running 15 min late",
        receivedAt: new Date(NOW.getTime() - agoMs),
      },
    } as Partial<ThreadEntry & { direction: "inbound" }>);

  it("takes a typed reply while it is open", () => {
    renderSection([whatsApp(2 * HOUR_MS)]);
    expect(screen.getByLabelText("Reply on WhatsApp to +13055550110")).toBeInTheDocument();
  });

  it("replaces the composer with the reason once it has closed", () => {
    renderSection([whatsApp(30 * HOUR_MS)]);
    expect(screen.queryByLabelText(/^Reply on WhatsApp/)).toBeNull();
    expect(screen.getByText(/WhatsApp takes a typed reply for 24 hours/)).toBeInTheDocument();
  });
});
