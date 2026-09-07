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
      readAt: null,
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
      body: "You're on the 1pm boat now.",
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

function renderSection(entries: ThreadEntry[], canAnswer = true) {
  return render(
    <ConversationSection
      entries={entries}
      diverName="Priya Sharma"
      shopSlug="blue-mantis"
      personId="af000000-1111-4222-8333-444444444444"
      locale="en-US"
      timezone="America/Cancun"
      now={NOW}
      canAnswer={canAnswer}
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
    expect(screen.getByText("You're on the 1pm boat now.")).toBeInTheDocument();
    expect(screen.getByText(/Marisol Vega replied/)).toBeInTheDocument();
  });

  it("says when a reply never reached them", () => {
    renderSection([inbound(), outbound("failed")]);
    expect(screen.getByText("This one did not reach them.")).toBeInTheDocument();
  });

  it("offers the composer on the channel the diver used", () => {
    renderSection([inbound()]);
    expect(screen.getByLabelText("Reply by email")).toBeInTheDocument();
  });

  it("hides the composer from a staffer who may not answer", () => {
    renderSection([inbound()], false);
    expect(screen.queryByLabelText("Reply by email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
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
    expect(screen.getByLabelText("Reply on WhatsApp")).toBeInTheDocument();
  });

  it("replaces the composer with the reason once it has closed", () => {
    renderSection([whatsApp(30 * HOUR_MS)]);
    expect(screen.queryByLabelText("Reply on WhatsApp")).toBeNull();
    expect(screen.getByText(/WhatsApp takes a typed reply for 24 hours/)).toBeInTheDocument();
  });
});
