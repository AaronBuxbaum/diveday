// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadEntry } from "@/db/inbound-messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { HOUR_MS } from "@/lib/clock";
import { type ConversationAssist, ConversationSection } from "./ConversationSection";

vi.mock("../details-actions", () => ({ replyToDiverAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
const NOW = new Date("2026-07-21T13:30:00.000Z");

const ENTRY = {
  direction: "inbound",
  message: {
    id: "8f000000-1111-4222-8333-444444444444",
    shopId: "9f000000-1111-4222-8333-444444444444",
    personId: "af000000-1111-4222-8333-444444444444",
    channel: "email",
    fromAddress: "lena.vogel@example.org",
    subject: "Samstag",
    body: "Gibt es Platz am Samstag?",
    mediaCount: 0,
    receivedAt: new Date(NOW.getTime() - HOUR_MS),
    answeredAt: null,
    providerMessageId: "ses-1",
    emailMessageId: null,
    inReplyToDeliveryId: null,
    assistLanguage: "de",
    assistTranslation: "Is there room on Saturday?",
    deletedAt: null,
    createdAt: new Date(NOW.getTime() - HOUR_MS),
  },
} as ThreadEntry;

function renderSection(assist?: ConversationAssist) {
  return render(
    <ConversationSection
      entries={[ENTRY]}
      diverName="Lena Vogel"
      shopSlug="blue-mantis"
      personId="af000000-1111-4222-8333-444444444444"
      locale="en-US"
      timezone="America/Cancun"
      now={NOW}
      removed={false}
      t={t}
      assist={assist}
    />,
  );
}

function assist(overrides: Partial<ConversationAssist> = {}): ConversationAssist {
  return {
    draft: vi.fn(async () => "Yes, there is room on the 8:00 boat."),
    translate: vi.fn(async () => "Ja, auf dem Boot um 8:00 ist Platz."),
    diverLanguage: "German",
    requestAction: vi.fn(),
    ...overrides,
  };
}

describe("the conversation with the shop's assists on", () => {
  it("shows Claude's translation under the diver's words, not instead of them", () => {
    renderSection(assist());
    expect(screen.getByText("Gibt es Platz am Samstag?")).toBeInTheDocument();
    expect(screen.getByText("Translated from German")).toBeInTheDocument();
    expect(screen.getByText("Is there room on Saturday?")).toBeInTheDocument();
  });

  it("drafts into the reply box, and sends nothing", async () => {
    const user = userEvent.setup();
    const offered = assist();
    renderSection(offered);
    await user.click(screen.getByRole("button", { name: "Draft a reply" }));
    expect(await screen.findByDisplayValue("Yes, there is room on the 8:00 boat.")).toBeVisible();
    expect(offered.requestAction).not.toHaveBeenCalled();
  });

  it("translates what the staffer wrote and keeps their words in view", async () => {
    const user = userEvent.setup();
    renderSection(assist());
    const box = screen.getByRole("textbox");
    await user.type(box, "Yes, at 8:00.");
    await user.click(screen.getByRole("button", { name: "Translate into German" }));
    expect(await screen.findByDisplayValue("Ja, auf dem Boot um 8:00 ist Platz.")).toBeVisible();
    expect(screen.getByText("What you wrote: Yes, at 8:00.")).toBeInTheDocument();
  });

  it("offers no translation for a diver who writes in the shop's language", () => {
    renderSection(assist({ translate: null, diverLanguage: null }));
    expect(screen.queryByRole("button", { name: /Translate/ })).toBeNull();
    const request = screen.getByRole("button", { name: "Draft a booking request" });
    expect(request.closest("form")?.querySelector('input[name="returnPersonId"]')).toHaveValue(
      "af000000-1111-4222-8333-444444444444",
    );
  });
});

describe("the conversation with the assists dark", () => {
  it("is the section it always was", () => {
    renderSection(undefined);
    expect(screen.queryByText("Translated from German")).toBeNull();
    expect(screen.queryByText("Is there room on Saturday?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Draft a reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Draft a booking request" })).toBeNull();
  });
});
