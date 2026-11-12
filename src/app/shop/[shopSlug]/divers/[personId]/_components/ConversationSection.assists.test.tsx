// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadEntry } from "@/db/inbound-messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { HOUR_MS } from "@/lib/clock";
import { type ConversationAssist, ConversationSection } from "./ConversationSection";

vi.mock("../details-actions", () => ({ replyToDiverAction: vi.fn() }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
    run: vi.fn(async () => ({
      kind: "reply" as const,
      text: "Yes, there is room on the 8:00 boat.",
    })),
    translate: vi.fn(async () => "Ja, auf dem Boot um 8:00 ist Platz."),
    diverLanguage: "German",
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
    await user.click(screen.getByRole("button", { name: "Draft with AI" }));
    expect(await screen.findByDisplayValue("Yes, there is room on the 8:00 boat.")).toBeVisible();
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the call form when the message asks for a booking", async () => {
    const user = userEvent.setup();
    renderSection(
      assist({ run: vi.fn(async () => ({ kind: "request" as const, href: "/shop/x?call=1" })) }),
    );
    await user.click(screen.getByRole("button", { name: "Draft with AI" }));
    expect(push).toHaveBeenCalledWith("/shop/x?call=1");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("says why in a toast when nothing came back, and leaves the box alone", async () => {
    const user = userEvent.setup();
    renderSection(
      assist({
        run: vi.fn(async () => ({ kind: "none" as const, reason: "unavailable" as const })),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Draft with AI" }));
    expect(await screen.findByRole("status")).toHaveTextContent("AI isn’t available right now");
    expect(screen.getByRole("textbox")).toHaveValue("");
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
    expect(screen.getByRole("button", { name: "Draft with AI" })).toBeInTheDocument();
  });
});

describe("the conversation with the assists dark", () => {
  it("is the section it always was", () => {
    renderSection(undefined);
    expect(screen.queryByText("Translated from German")).toBeNull();
    expect(screen.queryByText("Is there room on Saturday?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Draft with AI" })).toBeNull();
  });
});
