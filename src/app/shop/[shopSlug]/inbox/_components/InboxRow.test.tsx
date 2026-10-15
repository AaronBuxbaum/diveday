// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import type { InboxSeat } from "@/db/inbox-seats";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
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
  senderAuthenticated: true,
  spamFlagged: false,
  deletedAt: null,
  createdAt: new Date("2026-07-21T13:30:00.000Z"),
};

function renderRow(
  overrides: Partial<InboxMessageRow["message"]> = {},
  personName: string | null = "Priya Sharma",
  seat: InboxSeat | null = null,
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
        doneAction={vi.fn()}
        seat={seat}
        lateAction={vi.fn()}
      />
    </ul>,
  );
  return container;
}

describe("a message on file", () => {
  it("opens the diver's record on this very message", () => {
    renderRow();
    expect(screen.getByRole("link", { name: "Open the record for Priya Sharma" })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/divers/af000000-1111-4222-8333-444444444444#message-${MESSAGE.id}`,
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

  it("offers a Delete behind its ⋯, since a stranger's message has no record to live on", async () => {
    // Issue #1506: no record means no door and no composer, so a stranger's
    // message could only be read, and nothing else on any surface clears it.
    const container = renderRow({ personId: null, fromAddress: "marta.keller@example.net" }, null);
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Unknown sender" }),
    );
    const remove = screen.getByRole("button", {
      name: "Delete the message from marta.keller@example.net",
    });
    // The id the action deletes rides in the form, not in the URL.
    expect(remove.closest("form")?.querySelector('input[name="messageId"]')).toHaveValue(
      MESSAGE.id,
    );
    expect(container.querySelector("[data-row-menu]")).toContainElement(remove);
  });
});

/** The row's own child holding `node`: its kind, its body, its trailing slot or its door's glyph. */
function slotOf(container: HTMLElement, node: Element): Element {
  const row = container.querySelector("li");
  const slot = row ? [...row.children].find((child) => child.contains(node)) : undefined;
  if (!slot) throw new Error("that node is not in the row");
  return slot;
}

/**
 * **One column of dates, door or not** (pixel-craft class 3, K-459). Every row
 * ends on the same date, ⋯ and door's slot, whatever the row offers, so the
 * dates down the column end on one edge and no row's first line sits lower
 * than its neighbours' (K-465).
 */
describe("where the row sets its date and its acts", () => {
  const RECEIVED = formatDateTimeTz(MESSAGE.receivedAt, "en-US", "America/Cancun");
  // By exact text: the formatted date keeps its no-break spaces, which
  // `getByText`'s normalizer would collapse on the node's side only.
  const received = () =>
    screen.getByText((_, node) => node?.children.length === 0 && node.textContent === RECEIVED);

  it("holds the date and the ⋯ in a door row's trailing slot, with the door's glyph after it", () => {
    const container = renderRow();
    const trailing = slotOf(container, received());
    expect(trailing).toContainElement(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
    const glyph = trailing.nextElementSibling;
    expect(glyph?.querySelector("svg")).not.toBeNull();
    expect(glyph).not.toHaveClass("invisible");
  });

  it("holds the same in a stranger's trailing slot, and keeps the door's slot after it", () => {
    const container = renderRow({ personId: null, fromAddress: "marta.keller@example.net" }, null);
    const trailing = slotOf(container, received());
    expect(trailing).toContainElement(
      screen.getByRole("button", { name: "More for the message from Unknown sender" }),
    );
    // The door's glyph, unseen: the date ends where a door row's date ends.
    const glyph = trailing.nextElementSibling;
    expect(glyph?.querySelector("svg")).not.toBeNull();
    expect(glyph).toHaveClass("invisible");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("marking a message done", () => {
  it("offers Mark done on a waiting message, posting done=true", async () => {
    renderRow();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
    const done = screen.getByRole("button", { name: "Mark done" });
    expect(done.closest("form")?.querySelector('input[name="done"]')).toHaveValue("true");
  });

  it("offers the way back on a done message, posting done=false", async () => {
    renderRow({ answeredAt: new Date("2026-07-21T15:00:00.000Z") });
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
    const back = screen.getByRole("button", { name: "Move back to waiting" });
    expect(back.closest("form")?.querySelector('input[name="done"]')).toHaveValue("false");
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });
});

/**
 * **A stranger's words are read here or nowhere** (pixel-craft class 8,
 * K-460). A door row's excerpt is one line because the whole message is on
 * the record one tap away; a stranger's row has no record, so its one line cut
 * "Hello, do you run night dives in October? Two of us, b…" at 328px of a
 * 534px line and nothing could open the rest. It wraps, and it is not cut at
 * any line count: three lines held the seeded message only where the message
 * column was wide, and at the `sm` seam that column was ~122px — three lines
 * held 46 of its characters. The excerpt's own 140-character cap is what
 * bounds the row's height.
 */
describe("a stranger's message, which has no record to be read on", () => {
  const WORDS = "Hello, do you run night dives in October? Two of us, both AOW.";

  it("wraps the stranger's words whole instead of cutting them at a line", () => {
    renderRow({ personId: null, fromAddress: "marta.keller@example.net", body: WORDS }, null);
    const words = screen.getByText(WORDS);
    expect(words).toHaveClass("wrap-anywhere");
    expect(words).not.toHaveClass("truncate");
    expect(words.className).not.toMatch(/line-clamp/);
  });

  /**
   * **The name sits beside the message only from `md`** (the ledger's note on
   * K-461). Beside the kind column, the date and the door's slot, the name's
   * 176px column left the message ~122px at 640 — a door row's one line held
   * about 16 characters and a stranger's words ran to nine lines. Below `md`
   * the name sits over the message, which takes the body's whole width.
   */
  it("sets the name beside the message only from md, where the message has room", () => {
    renderRow({ personId: null, fromAddress: "marta.keller@example.net", body: WORDS }, null);
    const name = screen.getByText("Unknown sender");
    expect(name).toHaveClass("md:w-44", "md:shrink-0");
    expect(name.parentElement).toHaveClass("md:flex-row", "md:items-baseline", "md:gap-4");
    for (const element of [name, name.parentElement as HTMLElement]) {
      expect(element.className).not.toMatch(/(^|\s)sm:/);
    }
  });

  it("wraps them on a channel with no subject too", () => {
    renderRow(
      {
        personId: null,
        channel: "whatsapp",
        subject: null,
        fromAddress: "+13055550142",
        body: WORDS,
      },
      null,
    );
    expect(screen.getByText(WORDS)).toHaveClass("wrap-anywhere");
    expect(screen.getByText(WORDS).className).not.toMatch(/line-clamp|truncate/);
  });

  /**
   * **The address breaks inside its column rather than out of it** (pixel-craft
   * class 9, K-461). At 640 the name's 176px column and the date left the
   * message 72px, and "marta.keller@example.net" has no break in it: it ran
   * 96px past the column's edge, under the date. Cut with an ellipsis it would
   * lose half of what the row is for, so it wraps anywhere instead.
   */
  it("breaks a long address inside its column", () => {
    const address = "marta.keller.bookings.team@a-very-long-dive-club-domain.example.net";
    renderRow({ personId: null, fromAddress: address }, null);
    const facts = screen.getByText(address);
    expect(facts).toHaveClass("wrap-anywhere");
    expect(facts).not.toHaveClass("truncate");
  });

  it("keeps a door row's excerpt to one line, since the record holds the rest", () => {
    renderRow({ body: WORDS });
    expect(screen.getByText(WORDS)).toHaveClass("truncate");
  });
});

describe("what a row with a record behind it does not offer", () => {
  it("has no Delete: what a diver wrote belongs to their conversation", async () => {
    renderRow();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
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

/**
 * UX review 2026-10-13, item 19: "Running about 15 min late, traffic on the
 * causeway" sat in the Inbox with no boat named while the manifest said
 * nothing. The row names the seat, and its "⋯" puts the mark on it.
 */
describe("a message from somebody with a boat to catch", () => {
  const SEAT: InboxSeat = {
    bookingId: "bf000000-1111-4222-8333-444444444444",
    tripId: "cf000000-1111-4222-8333-444444444444",
    title: "Night Dive",
    // 11:30 PM Tuesday in Cancún.
    startsAt: new Date("2026-07-22T04:30:00.000Z"),
    runningLateAt: null,
    lateWindow: true,
  };
  const LATE = { channel: "whatsapp" as const, subject: null, body: "Running about 15 min late" };

  it("names the departure, and offers to mark the sender running late on it", async () => {
    renderRow(LATE, "Diego Alvarez", SEAT);
    expect(screen.getByText(/Booked on Night Dive, Tuesday 11:30\sPM/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Diego Alvarez" }),
    );
    const mark = screen.getByRole("button", {
      name: "Mark Diego Alvarez running late for Night Dive",
    });
    expect(mark).toHaveTextContent("Mark running late");
    // Only the message is posted: the server finds the person and the seat.
    const fields = [...(mark.closest("form")?.querySelectorAll("input") ?? [])].map(
      (input) => input.name,
    );
    expect(fields).toEqual(["messageId"]);
  });

  it("says the mark is on the manifest once it is, and offers it no more", async () => {
    renderRow({ ...LATE, keywordIntent: "late" }, "Diego Alvarez", {
      ...SEAT,
      runningLateAt: new Date("2026-07-22T02:30:00.000Z"),
    });
    expect(screen.getByText(/On the manifest: running late, said 9:30\sPM/)).toBeInTheDocument();
    // The keyword's own "Running late" would say the same thing twice.
    expect(screen.queryByText(/^Running late ·|· Running late$/)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Diego Alvarez" }),
    );
    expect(screen.queryByRole("button", { name: /running late/i })).toBeNull();
  });

  it("names nothing when there is no seat the message could be about", () => {
    const container = renderRow(LATE, "Diego Alvarez", null);
    expect(container.textContent).not.toMatch(/Booked on/);
  });
});

/**
 * Fourth UX review, item 32: Priya asks to switch boats three days out. The
 * row names the seat she holds, opens it on its roster, and its "⋯" offers the
 * roster's move; the late mark stays with the window.
 */
describe("a message asking to move a seat", () => {
  const SEAT: InboxSeat = {
    bookingId: "bf000000-1111-4222-8333-555555555555",
    tripId: "cf000000-1111-4222-8333-555555555555",
    title: "Two-Tank Reef",
    // 8:00 AM Saturday in Cancún.
    startsAt: new Date("2026-07-25T13:00:00.000Z"),
    runningLateAt: null,
    lateWindow: false,
  };

  it("names the seat as a link that opens it on its roster", () => {
    renderRow({}, "Priya Sharma", SEAT);
    expect(
      screen.getByRole("link", { name: /Booked on Two-Tank Reef, Saturday\s8:00\sAM/ }),
    ).toHaveAttribute("href", `/shop/blue-mantis/trips/${SEAT.tripId}#booking-${SEAT.bookingId}`);
  });

  it("offers the move in the row menu, landing on the seat's move, and no late mark", async () => {
    renderRow({}, "Priya Sharma", SEAT);
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
    const move = screen.getByRole("link", {
      name: "Move Priya Sharma’s seat on Two-Tank Reef to another departure",
    });
    expect(move).toHaveTextContent("Move to another departure");
    expect(move).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${SEAT.tripId}#move-booking-${SEAT.bookingId}`,
    );
    expect(screen.queryByRole("button", { name: /running late/i })).toBeNull();
  });

  it("offers no move without a seat", async () => {
    renderRow({}, "Priya Sharma", null);
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
    expect(screen.queryByRole("link", { name: /another departure/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
  });
});
