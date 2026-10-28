// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SMS_CONSENT_ONCE_FILLED } from "@/components/SmsConsentNote";
import { SEGMENT_CORNER, segmentedTrackClass } from "@/components/ui/segmented";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { nowDate } from "@/lib/clock";
import { RETURNING_DIVER_MEMORY_MS, saveReturningDiver } from "@/lib/returning-diver";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { renderDiver } from "@/test/intl";
import { BookingPartyFields } from "./BookingPartyFields";

afterEach(() => {
  cleanup();
});

describe("BookingPartyFields", () => {
  it("scopes name/email autofill per diver rather than turning it off (task 22)", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} />);

    fireEvent.click(screen.getByRole("radio", { name: "2 people" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /use the main contact’s email/i }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("autocomplete", "name");
    expect(screen.getByRole("textbox", { name: "Diver 2 name" })).toHaveAttribute(
      "autocomplete",
      "section-diver1 name",
    );
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("autocomplete", "email");
    expect(screen.getByRole("textbox", { name: "Diver 2 email" })).toHaveAttribute(
      "autocomplete",
      "section-diver1 email",
    );
  });

  it("uses the main contact's email for a non-lead diver until it is unticked (task 21)", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} />);
    fireEvent.click(screen.getByRole("radio", { name: "2 people" }));

    const box = screen.getByRole("checkbox", { name: /use the main contact’s email/i });
    expect(box).toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Diver 2 email" })).not.toBeInTheDocument();

    fireEvent.click(box);
    expect(screen.getByRole("textbox", { name: "Diver 2 email" })).toBeRequired();

    fireEvent.click(box);
    expect(screen.queryByRole("textbox", { name: "Diver 2 email" })).not.toBeInTheDocument();
  });

  it("asks each member 'Under 18', posts it per seat and says what it means once ticked", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} />);
    fireEvent.click(screen.getByRole("radio", { name: "2 people" }));
    const boxes = screen.getAllByRole("checkbox", { name: /^Under 18/ });
    expect(boxes.map((box) => box.getAttribute("name"))).toEqual(["minor-0", "minor-1"]);
    expect(screen.queryByText("A parent or guardian signs the waiver too.")).toBeNull();

    fireEvent.click(boxes[1] as HTMLElement);
    expect(boxes[1]).toBeChecked();
    expect(boxes[0]).not.toBeChecked();
    expect(screen.getByText("A parent or guardian signs the waiver too.")).toBeInTheDocument();
  });

  it("asks 'Under 18' last in each diver's block, after the email box", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} />);
    fireEvent.click(screen.getByRole("radio", { name: "2 people" }));
    const under18 = screen.getAllByRole("checkbox", { name: /^Under 18/ })[1] as HTMLElement;
    const leadEmail = screen.getByRole("checkbox", { name: /use the main contact’s email/i });
    expect(
      leadEmail.compareDocumentPosition(under18) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("asks nothing about anybody's diving", () => {
    // The per-diver certification question lived here between 2026-08-20 and
    // 2026-08-27; `/ready/<token>` asks the diver whose booking it is instead
    // (ADR 20260820-attested-at-booking-verified-at-boarding, amended). The
    // party editor collects names, addresses and one phone number.
    renderDiver(<BookingPartyFields maxPartySize={3} />);
    fireEvent.click(screen.getByRole("radio", { name: "3 people" }));
    expect(document.querySelector('select[name^="certificationLevel"]')).toBeNull();
    expect(document.querySelector('[name^="certificationAgency"]')).toBeNull();
    expect(document.querySelector('[name^="certificationNumber"]')).toBeNull();
  });

  it("shows the big-group escape hatch once the party cap is below the maximum (task 24)", () => {
    renderDiver(<BookingPartyFields maxPartySize={3} />);
    expect(screen.getByText("Bringing more than 3? Contact the shop.")).toBeInTheDocument();
    // The address and number stand once in the page's "Questions?" line and
    // once in the footer, not a third time here (visual review 2026-10-24, B23).
    expect(screen.queryByRole("link", { name: /contact the shop/i })).toBeNull();
  });

  it("hides the big-group escape hatch when the full party size is still selectable", () => {
    // Against the constant, not a literal: the cap moved from 6 to 20 once
    // `createBookingParty`'s cost was measured (issue #725), and a test that
    // hard-codes it stops testing the thing it names the moment it moves again.
    renderDiver(<BookingPartyFields maxPartySize={MAX_PUBLIC_PARTY_SIZE} />);
    expect(screen.queryByText(/bringing more than/i)).not.toBeInTheDocument();
  });

  it("renders a name and email box for every seat the diver picked", async () => {
    // The regression this exists for: `diverSlots` was a six-name tuple, so
    // raising MAX_PUBLIC_PARTY_SIZE silently left the *form* capped at six
    // while the select offered twenty. A party of nine rendered six fieldsets
    // and submitted three blank names for boxes nobody was shown — and the
    // validator, which loops the submitted size, would point at fields that do
    // not exist. Asserted at the cap, since that is where a fixed-length list
    // would fail.
    renderDiver(<BookingPartyFields maxPartySize={MAX_PUBLIC_PARTY_SIZE} />);
    fireEvent.change(screen.getByRole("combobox", { name: /people/i }), {
      target: { value: String(MAX_PUBLIC_PARTY_SIZE) },
    });
    expect(document.querySelectorAll('input[name^="fullName-"]')).toHaveLength(
      MAX_PUBLIC_PARTY_SIZE,
    );
    expect(
      document.querySelector(`input[name="fullName-${MAX_PUBLIC_PARTY_SIZE - 1}"]`),
    ).not.toBeNull();
  });

  it("offers every seat up to the measured cap when the boat has room", () => {
    renderDiver(<BookingPartyFields maxPartySize={MAX_PUBLIC_PARTY_SIZE} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(MAX_PUBLIC_PARTY_SIZE);
    // A dive club of nine and a family of eight are the cases the old cap of
    // six turned into two unrelated parties.
    expect(options.at(-1)).toHaveTextContent(String(MAX_PUBLIC_PARTY_SIZE));
  });
});

/**
 * **One caption, one gap** (docs/design/pixel-craft.md, class 12). The
 * booking card's group captions were drawn three ways, and "Your details" was
 * the muted one, with nothing between it and the "Name" label under it: its
 * line box ended on the label's (site-briefing at 1280). It takes the party
 * count's caption as it is, in foreground ink, and the same 8px to what it
 * captions that the count's track keeps (`mt-2`) — whatever comes first under
 * it, the "Name" label or a remembered diver's "Booking as …" line.
 */
describe("BookingPartyFields — the group captions", () => {
  it("captions the lead's details exactly as it captions the party count, 8px above the fields", () => {
    renderDiver(<BookingPartyFields maxPartySize={4} />);
    const countCaption = screen.getByText("People");
    const detailsCaption = screen.getByText("Your details");
    expect(detailsCaption.tagName).toBe("LEGEND");
    expect(detailsCaption.className.split(" ").sort()).toEqual(
      countCaption.className.split(" ").sort(),
    );
    // The 8px lives on the body after the legend, as ChoiceFieldset's does: a
    // legend carries no margin of its own (form.test.tsx's sweep, K-72).
    expect(detailsCaption.nextElementSibling).toHaveClass("mt-2");
    expect(detailsCaption).not.toHaveClass("text-muted");
    expect(countCaption).toHaveClass("text-sm", "font-semibold");
  });

  /**
   * The line kept a `-mt-1` from before the caption had a gap, which then
   * cancelled half of it: 8 − 4 left 4px. The caption's gap is the one gap.
   */
  it("keeps a remembered diver's line the caption's 8px under it, with no margin pulling it up", () => {
    saveReturningDiver(
      "blue-mantis",
      { fullName: "Marco Rossi", email: "marco@example.com" },
      nowDate().getTime() + RETURNING_DIVER_MEMORY_MS,
    );
    try {
      renderDiver(<BookingPartyFields maxPartySize={4} rememberForShop="blue-mantis" />);
      const line = screen.getByRole("button", { name: "Not you?" }).closest("p");
      expect(line).toHaveTextContent("Booking as Marco Rossi");
      expect(screen.getByText("Your details").nextElementSibling).toHaveClass("mt-2");
      expect(line?.parentElement).toBe(screen.getByText("Your details").nextElementSibling);
      expect(line?.className.split(" ").filter((name) => /^-?m[ty]-/.test(name))).toEqual([]);
    } finally {
      localStorage.clear();
    }
  });
});

/**
 * **An address is read whole** (docs/design/pixel-craft.md, class 8). Name
 * and Email stood side by side in a 478px card body, so the Email box was
 * 231px and a prefilled 35-character address was cut at its right padding
 * (booking-known-diver at 1280). Each diver's boxes take the card's width, one
 * under the other, as Phone already did.
 */
describe("BookingPartyFields — a diver's boxes", () => {
  it("gives every box its own row, so a long address is never cut", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} leadPhone />);
    fireEvent.click(screen.getByRole("radio", { name: "2 people" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /use the main contact’s email/i }));
    for (const name of ["Email", "Diver 2 email"]) {
      const grid = screen.getByRole("textbox", { name }).closest(".grid-cols-1");
      expect(grid).not.toBeNull();
      expect(grid?.className).not.toMatch(/grid-cols-[2-9]/);
    }
    // Nothing is left spanning columns that no longer exist.
    expect(document.querySelector('[class*="col-span-2"]')).toBeNull();
  });
});

/**
 * The party count is a **segmented row up to six, a `<select>` above it** (ADR
 * 20260827-the-divers-thread, decision 2). `MAX_PUBLIC_PARTY_SIZE` is 20 and a
 * twenty-segment track fits no phone, so the fallback is not a nicety — it is
 * the reason the rule has a number in it at all.
 *
 * Both shapes answer to one accessible name and carry one hydration flag,
 * which is what lets anything reading this form — a spec included — ask for
 * "People" without first working out how many seats are left.
 */
describe("BookingPartyFields — the party-count control", () => {
  it("renders a segmented row of radios, and no select, for a party of six or fewer", () => {
    renderDiver(<BookingPartyFields maxPartySize={6} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: "1 person" })).toBeChecked();
  });

  it("submits the chosen count under the name the booking action parses", () => {
    renderDiver(<BookingPartyFields maxPartySize={4} />);
    const three = screen.getByRole("radio", { name: "3 people" });
    expect(three).toHaveAttribute("name", "partySize");
    fireEvent.click(three);
    expect(three).toBeChecked();
    expect(document.querySelectorAll('input[name^="fullName-"]')).toHaveLength(3);
  });

  it("falls back to the select once the boat has room for more than six", () => {
    renderDiver(<BookingPartyFields maxPartySize={7} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("combobox", { name: /people/i })).toBeInTheDocument();
  });

  it("names itself and reports hydration in both shapes", () => {
    const { unmount } = renderDiver(<BookingPartyFields maxPartySize={5} />);
    expect(screen.getByLabelText("People")).toHaveAttribute("data-hydrated");
    unmount();
    renderDiver(<BookingPartyFields maxPartySize={MAX_PUBLIC_PARTY_SIZE} />);
    expect(screen.getByLabelText("People")).toHaveAttribute("data-hydrated");
  });

  /**
   * The segmented grammar's track and corner, taken from the one recipe rather
   * than copied from it. The copy had kept `rounded-lg` segments 5px inside a
   * 12px track, where they nest at 7px — the probe's `nested-corners` flag on
   * the selected count, on the booking, profile and site-briefing captures.
   */
  it("draws its track and segments from the segmented recipe, nested in its corner", () => {
    renderDiver(<BookingPartyFields maxPartySize={4} />);
    const group = screen.getByRole("radiogroup", { name: "People" });
    for (const token of segmentedTrackClass.split(" ")) expect(group).toHaveClass(token);
    for (const radio of screen.getAllByRole("radio")) {
      const segment = radio.closest("label");
      expect(segment).toHaveClass(SEGMENT_CORNER);
      expect(segment).not.toHaveClass("rounded-lg");
    }
  });

  /**
   * The radio is `sr-only`, so keyboard focus is invisible unless its label
   * draws it. The label takes the global ring's utility on `:focus-visible`
   * within it, never a hand-drawn outline.
   */
  it("draws keyboard focus on each segment with the global ring", () => {
    renderDiver(<BookingPartyFields maxPartySize={4} />);
    for (const radio of screen.getAllByRole("radio")) {
      const segment = radio.closest("label");
      expect(segment).toHaveClass("has-[:focus-visible]:focus-ring");
      expect(segment?.className).not.toMatch(/outline-/);
    }
  });
});

/**
 * **The SMS consent arrives with the number** (visual review 2026-10-24, B22).
 * The paragraph's words never change (H-09) and are always in the server
 * HTML, so a form posted before hydration, or with scripts off, carried them;
 * CSS hides them while the box is empty (`:placeholder-shown`), so they show
 * the moment a number is in the box, however it got there.
 */
describe("BookingPartyFields — SMS consent", () => {
  const consent = /you agree to texts from DiveDay/i;
  const markup = (ui: ReactElement) =>
    renderToStaticMarkup(
      <DiverIntlProvider
        locale="en-US"
        timeZone="America/New_York"
        namespaces={["party", "common"]}
      >
        {ui}
      </DiverIntlProvider>,
    );

  it("puts the consent's words in the server HTML with no number typed", () => {
    expect(markup(<BookingPartyFields maxPartySize={2} leadPhone />)).toMatch(consent);
  });

  it("hides them by CSS while the phone box is empty, never by leaving them out", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} leadPhone />);
    const phone = screen.getByRole("textbox", { name: /phone/i });
    expect(phone).toHaveAttribute("placeholder", " ");
    const note = screen.getByText(consent).closest("[id$='-description']");
    // A sibling of the input inside the Field that carries the CSS reveal.
    expect(note?.previousElementSibling).toBe(phone);
    expect(note?.parentElement?.parentElement).toHaveClass(SMS_CONSENT_ONCE_FILLED);
    expect(phone.getAttribute("aria-describedby")).toContain(note?.id);
    fireEvent.change(phone, { target: { value: "+1 305 555 0142" } });
    expect(screen.getByText(consent)).toBeInTheDocument();
  });
});
