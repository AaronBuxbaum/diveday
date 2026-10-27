// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import type { InboxSeat } from "@/db/inbox-seats";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime } from "@/lib/format";
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
  bookingId: null,
  senderAuthenticated: true,
  spamFlagged: false,
  assistIntent: null,
  assistUrgent: null,
  assistLanguage: null,
  assistTranslation: null,
  assistTranslatedTo: null,
  assistedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-07-21T13:30:00.000Z"),
};

function renderRow(
  overrides: Partial<InboxMessageRow["message"]> = {},
  personName: string | null = "Priya Sharma",
  seats: readonly InboxSeat[] = [],
  now: Date = new Date("2026-07-01T12:00:00.000Z"),
) {
  const { container } = render(
    <ul>
      <InboxRow
        row={{ message: { ...MESSAGE, ...overrides }, personName }}
        shopSlug="blue-mantis"
        locale="en-US"
        timezone="America/Cancun"
        now={now}
        t={t}
        deleteAction={vi.fn()}
        doneAction={vi.fn()}
        seats={seats}
        lateAction={vi.fn()}
      />
    </ul>,
  );
  return container;
}

describe("a message on file", () => {
  it("opens the diver's record on this very message, from the row's open view", async () => {
    renderRow();
    expect(screen.queryByRole("link", { name: "Open the record for Priya Sharma" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
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
  it.each([
    "marta@example.net?bcc=attacker@example.net",
    "marta@example.net%3Fbcc=attacker@example.net",
    "marta@example.net,attacker@example.net",
    "marta@example.net\r\nBcc: attacker@example.net",
    "marta@example.net&subject=private",
  ])("does not offer an email reply to an unsafe sender: %s", async (address) => {
    renderRow({ personId: null, fromAddress: address }, null);
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Unknown sender" }),
    );
    expect(screen.queryByRole("link", { name: "Reply by email" })).toBeNull();
  });

  it("shows the address as muted words, and offers the reply in its open view", async () => {
    renderRow({ personId: null, fromAddress: "marta.keller@example.net" }, null);
    expect(screen.getByText("Unknown sender")).toBeInTheDocument();
    // Words, not a second blue link beside the seat's (visual review A15).
    expect(screen.getByText(/marta\.keller@example\.net/).closest("a")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Unknown sender" }),
    );
    // The one link starts a reply in the staffer's own mail app.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Reply by email" })).toHaveAttribute(
      "href",
      "mailto:marta.keller@example.net",
    );
  });

  it("encodes the local part of a valid address in the reply link", async () => {
    renderRow({ personId: null, fromAddress: "marta+boats@example.net" }, null);
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Unknown sender" }),
    );
    expect(screen.getByRole("link", { name: "Reply by email" })).toHaveAttribute(
      "href",
      "mailto:marta%2Bboats@example.net",
    );
  });

  it("leaves a phone number as words, since a link would dial it", () => {
    renderRow({ personId: null, channel: "sms", subject: null, fromAddress: "+13055550142" }, null);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/\+13055550142/)).toBeInTheDocument();
  });

  it("offers a Delete in its open view, since a stranger's message has no record to live on", async () => {
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
    expect(container.querySelector("[data-inbox-open-view]")).toContainElement(remove);
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
 * **One column of dates, one control** (pixel-craft class 3, K-459; visual
 * review A15). Every row ends on the same bare time and the same chevron,
 * whatever the row offers, so the dates down the column end on one edge. The
 * zone is the list header's, said once.
 */
describe("where the row sets its date and its one control", () => {
  const RECEIVED = `${formatShortDate(MESSAGE.receivedAt, "en-US", "America/Cancun")}, ${formatTime(
    MESSAGE.receivedAt,
    "en-US",
    "America/Cancun",
  )}`;
  const received = () =>
    screen.getByText((_, node) => node?.children.length === 0 && node.textContent === RECEIVED);

  it.each([
    ["a door row", {}, "Priya Sharma"],
    ["a stranger's row", { personId: null, fromAddress: "marta.keller@example.net" }, null],
  ] as const)("ends %s on its bare time and one chevron, nothing after", (_, overrides, name) => {
    const container = renderRow(overrides, name);
    const trailing = slotOf(container, received());
    expect(trailing).toContainElement(
      screen.getByRole("button", { name: `More for the message from ${name ?? "Unknown sender"}` }),
    );
    expect(trailing.querySelectorAll("button, a")).toHaveLength(1);
    expect(trailing.nextElementSibling).toBeNull();
    expect(trailing.textContent).not.toMatch(/EDT|EST|CDT|CST/);
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
    expect(done.closest("form")?.querySelector('input[name="receivedAt"]')).toHaveValue(
      MESSAGE.receivedAt.toISOString(),
    );
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

  // Fourth review, item 45: "Oct 14, 7:00 AM" and "Wednesday 1:30 PM" on
  // that same Wednesday left the desk to work out whether the boat was this
  // afternoon or next week.
  it("says today on the stamp and the seat when both are today at the shop", () => {
    renderRow(LATE, "Diego Alvarez", [SEAT], new Date("2026-07-21T15:00:00.000Z"));
    expect(screen.getByText(/^Today, 8:30\sAM/)).toBeInTheDocument();
    expect(screen.getByText(/Booked on Night Dive, today 11:30\sPM/)).toBeInTheDocument();
  });

  it("names the departure, and offers to mark the sender running late on it", async () => {
    renderRow(LATE, "Diego Alvarez", [SEAT]);
    expect(screen.getByText(/Booked on Night Dive, Tuesday 11:30\sPM/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Diego Alvarez" }),
    );
    const mark = screen.getByRole("button", {
      name: "Mark Diego Alvarez running late for Night Dive",
    });
    expect(mark).toHaveTextContent("Mark running late");
    // The message and the chosen seat are posted: the server finds the person
    // and refuses any seat the message was not about (issue #2551).
    const fields = [...(mark.closest("form")?.querySelectorAll("input") ?? [])].map((input) => [
      input.name,
      input.value,
    ]);
    expect(fields).toEqual([
      ["messageId", MESSAGE.id],
      ["bookingId", SEAT.bookingId],
    ]);
  });

  it("says the mark is on the manifest once it is, and offers it no more", async () => {
    renderRow({ ...LATE, keywordIntent: "late" }, "Diego Alvarez", [
      { ...SEAT, runningLateAt: new Date("2026-07-22T02:30:00.000Z") },
    ]);
    expect(screen.getByText(/On the manifest: running late, said 9:30\sPM/)).toBeInTheDocument();
    // The keyword's own "Running late" would say the same thing twice.
    expect(screen.queryByText(/^Running late ·|· Running late$/)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Diego Alvarez" }),
    );
    expect(screen.queryByRole("button", { name: /running late/i })).toBeNull();
  });

  it("names nothing when there is no seat the message could be about", () => {
    const container = renderRow(LATE, "Diego Alvarez", []);
    expect(container.textContent).not.toMatch(/Booked on/);
  });
});

/**
 * Issue #2551: a sender holding two seats inside the window gets one act per
 * seat, and the desk chooses. A 6:00 PM message about the 7:00 AM boat, with
 * the 11:30 PM boat sailing first, no longer marks the wrong one.
 */
describe("a message from somebody with two boats to catch", () => {
  const NIGHT: InboxSeat = {
    bookingId: "bf000000-1111-4222-8333-444444444444",
    tripId: "cf000000-1111-4222-8333-444444444444",
    title: "Night Dive",
    startsAt: new Date("2026-07-22T04:30:00.000Z"),
    runningLateAt: null,
    lateWindow: true,
  };
  const DAWN: InboxSeat = {
    bookingId: "bf000000-1111-4222-8333-555555555555",
    tripId: "cf000000-1111-4222-8333-555555555555",
    title: "Dawn Reef",
    startsAt: new Date("2026-07-22T12:00:00.000Z"),
    runningLateAt: null,
    lateWindow: true,
  };
  const LATE = { channel: "whatsapp" as const, subject: null, body: "Running about 15 min late" };

  it("names both departures", () => {
    renderRow(LATE, "Diego Alvarez", [NIGHT, DAWN]);
    expect(screen.getByText(/Booked on Night Dive/)).toBeInTheDocument();
    expect(screen.getByText(/Booked on Dawn Reef/)).toBeInTheDocument();
  });

  it("offers one act per seat, each posting its own booking id", async () => {
    renderRow(LATE, "Diego Alvarez", [NIGHT, DAWN]);
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Diego Alvarez" }),
    );
    expect(screen.queryByRole("button", { name: "Mark running late" })).toBeNull();
    for (const seat of [NIGHT, DAWN]) {
      const mark = screen.getByRole("button", {
        name: new RegExp(`^Mark Diego Alvarez running late for ${seat.title}, `),
      });
      expect(mark).toHaveTextContent(`Mark running late for ${seat.title}`);
      const fields = Object.fromEntries(
        [...(mark.closest("form")?.querySelectorAll("input") ?? [])].map((input) => [
          input.name,
          input.value,
        ]),
      );
      expect(fields).toEqual({ messageId: MESSAGE.id, bookingId: seat.bookingId });
    }
  });

  it("offers only the seat that is not marked yet, and says which one is", async () => {
    renderRow(LATE, "Diego Alvarez", [
      { ...NIGHT, runningLateAt: new Date("2026-07-22T02:30:00.000Z") },
      DAWN,
    ]);
    expect(
      screen.getByText(/On the manifest for Night Dive: running late, said 9:30\sPM/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Diego Alvarez" }),
    );
    expect(screen.queryByRole("button", { name: /Night Dive/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Dawn Reef/ })).toBeInTheDocument();
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
    renderRow({}, "Priya Sharma", [SEAT]);
    expect(
      screen.getByRole("link", { name: /Booked on Two-Tank Reef, Saturday\s8:00\sAM/ }),
    ).toHaveAttribute("href", `/shop/blue-mantis/trips/${SEAT.tripId}#booking-${SEAT.bookingId}`);
  });

  it("offers the move in the row menu, landing on the seat's move, and no late mark", async () => {
    renderRow({}, "Priya Sharma", [SEAT]);
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

  /**
   * dive-domain review r4-4, F1: Priya also holds Wednesday's wreck boat. The
   * row cannot know which seat "switch Saturday" means, so it names both and
   * each gets its own move, rather than Wednesday's alone.
   */
  it("names every seat she holds, each with its own move", async () => {
    const WEDNESDAY: InboxSeat = {
      ...SEAT,
      bookingId: "bf000000-1111-4222-8333-666666666666",
      tripId: "cf000000-1111-4222-8333-666666666666",
      title: "Wreck Dive",
      // 8:00 AM Wednesday in Cancún.
      startsAt: new Date("2026-07-22T13:00:00.000Z"),
    };
    renderRow({}, "Priya Sharma", [WEDNESDAY, SEAT]);
    expect(screen.getByRole("link", { name: /Booked on Wreck Dive, Wednesday/ })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${WEDNESDAY.tripId}#booking-${WEDNESDAY.bookingId}`,
    );
    expect(screen.getByRole("link", { name: /Booked on Two-Tank Reef, Saturday/ })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${SEAT.tripId}#booking-${SEAT.bookingId}`,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
    const wednesday = screen.getByRole("link", {
      name: /^Move Priya Sharma’s seat on Wreck Dive, Wednesday\s8:00\sAM, to another departure$/,
    });
    expect(wednesday).toHaveTextContent(/^Move Wreck Dive, Wednesday\s8:00\sAM$/);
    expect(wednesday).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${WEDNESDAY.tripId}#move-booking-${WEDNESDAY.bookingId}`,
    );
    expect(
      screen.getByRole("link", { name: /^Move Priya Sharma’s seat on Two-Tank Reef, Saturday/ }),
    ).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${SEAT.tripId}#move-booking-${SEAT.bookingId}`,
    );
    expect(screen.queryByRole("link", { name: /^Move to another departure$/ })).toBeNull();
  });

  it("offers no move without a seat", async () => {
    renderRow({}, "Priya Sharma", []);
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Priya Sharma" }),
    );
    expect(screen.queryByRole("link", { name: /another departure/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
  });
});

describe("an Ask to move from the booking page (H-126)", () => {
  const SEAT: InboxSeat = {
    bookingId: "bf000000-1111-4222-8333-444444444444",
    tripId: "cf000000-1111-4222-8333-444444444444",
    title: "Night Dive",
    startsAt: new Date("2026-07-22T04:30:00.000Z"),
    runningLateAt: null,
    lateWindow: false,
  };
  const ASK = {
    channel: "page" as const,
    subject: null,
    body: "",
    keywordIntent: "move" as const,
    bookingId: SEAT.bookingId,
  };

  it("says where it came from, what it asks and which seat", () => {
    renderRow(ASK, "Diego Alvarez", [SEAT]);
    expect(screen.getByText("Booking page")).toBeInTheDocument();
    expect(screen.getByText(/Asked to move/)).toBeInTheDocument();
    expect(screen.getByText(/Booked on Night Dive/)).toBeInTheDocument();
  });

  it("carries the diver's note when there is one", () => {
    renderRow({ ...ASK, body: "Any Saturday in August" }, "Diego Alvarez", [SEAT]);
    expect(screen.getByText("Any Saturday in August")).toBeInTheDocument();
  });

  it("offers no running-late mark: the ask is about another date", async () => {
    renderRow(ASK, "Diego Alvarez", [SEAT]);
    await userEvent.click(
      screen.getByRole("button", { name: "More for the message from Diego Alvarez" }),
    );
    expect(screen.queryByRole("button", { name: /running late/ })).toBeNull();
  });

  /**
   * **What the roster's Move will refuse, said first** (issue #2668): a party
   * lead's seat and a buddy-teamed seat are refused by Move, so the row says so
   * before the desk opens the roster.
   */
  it("says the seat leads a party, and that Move is per seat", () => {
    renderRow(ASK, "Diego Alvarez", [
      { ...SEAT, moveRefusal: { kind: "leads_party", partySize: 3 } },
    ]);
    expect(screen.getByText(/Party of 3; Move is per seat/)).toBeInTheDocument();
  });

  it("says the seat is on a buddy team", () => {
    renderRow(ASK, "Diego Alvarez", [{ ...SEAT, moveRefusal: { kind: "on_buddy_team" } }]);
    expect(screen.getByText(/On a buddy team/)).toBeInTheDocument();
  });

  it("says neither on a seat Move takes as it stands", () => {
    renderRow(ASK, "Diego Alvarez", [SEAT]);
    expect(screen.queryByText(/Party of/)).toBeNull();
    expect(screen.queryByText(/buddy team/)).toBeNull();
  });

  it("has both lines in Spanish", () => {
    const es = staffTranslator("es-ES");
    expect(es("inbox.moveRefusal.leadsParty", { count: 3 })).toBe(
      "Grupo de 3; se mueve plaza a plaza",
    );
    expect(es("inbox.moveRefusal.onBuddyTeam")).toBe("En una pareja de buceo");
  });
});
