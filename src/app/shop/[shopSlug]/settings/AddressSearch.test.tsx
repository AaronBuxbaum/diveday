// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressLookupResult, ShopAddressFields } from "@/lib/address-lookup";
import { AddressSearch } from "./AddressSearch";

// The actions drag better-auth (and the whole Next server runtime) in behind them.
const suggest = vi.fn<(query: string) => Promise<AddressLookupResult>>();
const save = vi.fn<(form: FormData) => Promise<void>>();
vi.mock("./actions", () => ({
  suggestAddressAction: (query: string) => suggest(query),
  saveAddressAction: (form: FormData) => save(form),
}));

const copy = {
  searchLabel: "Find your shop",
  searchPlaceholder: "Your shop's name or address…",
  searching: "Looking…",
  saving: "Saving…",
  noMatches: "No matches",
  lookupFailed: "Address lookup isn't available right now.",
  lookupResting: "That's a lot of lookups for one hour, so searching pauses for a bit.",
  notConfigured: "Address lookup isn't set up on this DiveDay instance.",
  suggestionsLabel: "Address suggestions",
  currentLabel: "Saved address",
  noneSet: "No address saved yet.",
  removeLabel: "Remove address",
  removing: "Removing…",
};

const EMPTY: ShopAddressFields = {
  addressStreet: "",
  addressLocality: "",
  addressRegion: "",
  addressPostalCode: "",
  addressCountry: "",
};

/**
 * What the hidden form sends for a place the geocoder gave no coordinates for.
 *
 * `toFormData` used to omit the keys entirely; the form carries a fixed field
 * list, so they arrive empty instead. `addressSchema` accepts `""` for both and
 * `saveAddressAction` stores `null` either way, so the row that lands is
 * identical — this is the shape of the submission, not a change to the address.
 */
const NO_COORDINATES = { latitude: "", longitude: "" };

const KEY_LARGO_ADDRESS: ShopAddressFields = {
  addressStreet: "102 Ocean Drive",
  addressLocality: "Key Largo",
  addressRegion: "FL",
  addressPostalCode: "33037",
  addressCountry: "US",
};

/** A business row: the name is the label, the street is the detail beneath it. */
const RAINBOW_REEF = {
  id: "poi-1",
  label: "Rainbow Reef Dive Center",
  detail: "102 Ocean Drive, Key Largo, FL 33037",
  address: KEY_LARGO_ADDRESS,
};

function renderCard(props: { enabled?: boolean; initial?: ShopAddressFields } = {}) {
  return render(
    <AddressSearch initial={props.initial ?? EMPTY} enabled={props.enabled ?? true} copy={copy} />,
  );
}

beforeEach(() => {
  suggest.mockReset();
  save.mockReset();
  save.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("the address card with no geocoder configured", () => {
  it("says so, rather than offering a box that answers nothing", () => {
    renderCard({ enabled: false });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(copy.notConfigured)).toBeInTheDocument();
  });

  it("still reads back the address the shop already has", () => {
    // Being unable to *change* an address is no reason to hide it.
    renderCard({ enabled: false, initial: KEY_LARGO_ADDRESS });
    expect(screen.getByText("102 Ocean Drive")).toBeInTheDocument();
    expect(screen.getByText(/Key Largo, FL/)).toBeInTheDocument();
  });

  it("offers no way to type an address by hand", () => {
    // The five free-text boxes are gone, not hidden: they were the source of
    // every mangled address the lookup exists to prevent.
    renderCard({ enabled: false, initial: KEY_LARGO_ADDRESS });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("the address card with a geocoder", () => {
  it("has one box and no hand-typed address fields", () => {
    renderCard({ initial: KEY_LARGO_ADDRESS });
    // The combobox is the only text input on the card.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByLabelText(/street/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/postal code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/country/i)).not.toBeInTheDocument();
  });

  it("has no Save button — there is nothing left to confirm", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("does not spend a request on a query too short to mean anything", () => {
    // On the component's own clock, not a wall-clock sleep tuned to beat the
    // debounce — a lengthened debounce must fail this test, not outrun it.
    vi.useFakeTimers();
    try {
      renderCard();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "10" } });
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(suggest).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a business by name with its street underneath", async () => {
    // The whole point of the operation swap: a shop recognizes its own name,
    // and the street is what tells one franchise location from the next.
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [RAINBOW_REEF] });
    renderCard();

    await user.type(screen.getByRole("combobox"), "Rainbow Reef");
    // The row is a real `option` inside the combobox's `listbox`, so a screen
    // reader can count it — the `aria-controls`/`aria-activedescendant` pair on
    // the input promises exactly that.
    const option = await screen.findByRole("option", { name: /Rainbow Reef Dive Center/ });
    expect(option).toHaveTextContent("102 Ocean Drive, Key Largo, FL 33037");
  });

  it("saves the picked place without a second confirmation", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [RAINBOW_REEF] });
    renderCard();

    await user.type(screen.getByRole("combobox"), "Rainbow Reef");
    await user.click(await screen.findByText("Rainbow Reef Dive Center"));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const form = save.mock.calls[0][0];
    expect(Object.fromEntries(form)).toEqual({ ...KEY_LARGO_ADDRESS, ...NO_COORDINATES });
    // And the shop sees the address it just chose, not the one it replaced.
    expect(screen.getByText("102 Ocean Drive")).toBeInTheDocument();
  });

  it("replaces the whole address rather than merging into what was there", async () => {
    // Half of one address and half of another is worse than either: a picked
    // place with no postcode has to clear the stored postcode.
    const user = userEvent.setup();
    suggest.mockResolvedValue({
      status: "ok",
      suggestions: [{ ...RAINBOW_REEF, address: { ...EMPTY, addressLocality: "Cozumel" } }],
    });
    renderCard({ initial: { ...EMPTY, addressPostalCode: "33037", addressCountry: "US" } });

    await user.type(screen.getByRole("combobox"), "Cozumel");
    await user.click(await screen.findByText(RAINBOW_REEF.label));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(save.mock.calls[0][0])).toEqual({
      ...EMPTY,
      ...NO_COORDINATES,
      addressLocality: "Cozumel",
    });
  });

  it("picks with the keyboard, not only the mouse", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [RAINBOW_REEF] });
    renderCard();

    const combobox = screen.getByRole("combobox");
    await user.type(combobox, "Rainbow Reef");
    await screen.findByText(RAINBOW_REEF.label);
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(save.mock.calls[0][0])).toEqual({
      ...KEY_LARGO_ADDRESS,
      ...NO_COORDINATES,
    });
  });

  /**
   * With the free-text boxes gone, this button is the *only* way back to no
   * address at all — a shop that mis-picked, or one that has stopped publishing
   * a storefront, has no other route.
   */
  it("removes the address, and only offers to when there is one", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard();
    expect(screen.queryByRole("button", { name: copy.removeLabel })).not.toBeInTheDocument();
    expect(screen.getByText(copy.noneSet)).toBeInTheDocument();
    unmount();

    renderCard({ initial: KEY_LARGO_ADDRESS });
    await user.click(screen.getByRole("button", { name: copy.removeLabel }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(save.mock.calls[0][0])).toEqual({ ...EMPTY, ...NO_COORDINATES });
    expect(screen.getByText(copy.noneSet)).toBeInTheDocument();
  });

  /**
   * Every fire is a *billed* Amazon Location request against an hourly budget,
   * and the budget running out looks, from this box, exactly like the geocoder
   * being down — which is how the card came to be reported as simply not
   * working (2026-08-06 review). These three keep the spend honest and the two
   * states apart.
   */
  it("does not re-ask the same question, however many times the typist pauses", async () => {
    // Fake timers for the same reason as the too-short test above: the
    // assertion is "the debounce elapsed and nothing fired", which a real
    // sleep can only approximate.
    vi.useFakeTimers();
    try {
      suggest.mockResolvedValue({ status: "ok", suggestions: [RAINBOW_REEF] });
      renderCard();
      const combobox = screen.getByRole("combobox");

      fireEvent.change(combobox, { target: { value: "Rainbow Reef" } });
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText(RAINBOW_REEF.label)).toBeInTheDocument();
      expect(suggest).toHaveBeenCalledTimes(1);

      // A character typed and taken straight back out again lands on the same
      // query — the second pause must cost nothing.
      fireEvent.change(combobox, { target: { value: "Rainbow Reefs" } });
      fireEvent.change(combobox, { target: { value: "Rainbow Reef" } });
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(suggest).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the lookup is resting, not broken, when the hour's budget is spent", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "rate_limited" });
    renderCard();

    await user.type(screen.getByRole("combobox"), "Rainbow Reef");
    expect(await screen.findByText(copy.lookupResting)).toBeInTheDocument();
    expect(screen.queryByText(copy.lookupFailed)).not.toBeInTheDocument();
  });

  it("lets a refused query be asked again once the lookup recovers", async () => {
    // A rate-limited call learned nothing about the query, so the de-dupe must
    // not hold it back — otherwise the box stays dead for that text forever.
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "rate_limited" });
    renderCard();
    const combobox = screen.getByRole("combobox");

    await user.type(combobox, "Rainbow Reef");
    await screen.findByText(copy.lookupResting);

    suggest.mockResolvedValue({ status: "ok", suggestions: [RAINBOW_REEF] });
    await user.type(combobox, " ");
    await user.keyboard("{Backspace}");
    expect(await screen.findByText(RAINBOW_REEF.label)).toBeInTheDocument();
  });

  it("says so, and leaves the saved address alone, when the lookup is unavailable", async () => {
    const user = userEvent.setup();
    // The reason travels for whoever has to fix the deployment; the staffer
    // reads the same sentence whichever one it is.
    suggest.mockResolvedValue({ status: "failed", reason: "denied" });
    renderCard({ initial: KEY_LARGO_ADDRESS });

    await user.type(screen.getByRole("combobox"), "Rainbow Reef");

    expect(await screen.findByText(copy.lookupFailed)).toBeInTheDocument();
    expect(screen.getByText("102 Ocean Drive")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("says when a real query simply matched nothing", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [] });
    renderCard();
    await user.type(screen.getByRole("combobox"), "zzzzzz");
    expect(await screen.findByText(copy.noMatches)).toBeInTheDocument();
  });

  it("does not reopen the list under an address that has already saved", async () => {
    // A lookup still in flight when the pick lands would otherwise drop its
    // rows back on top of a finished errand.
    vi.useFakeTimers();
    try {
      suggest.mockResolvedValue({ status: "ok", suggestions: [RAINBOW_REEF] });
      renderCard();
      const combobox = screen.getByRole("combobox");

      fireEvent.change(combobox, { target: { value: "Rainbow Reef" } });
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      fireEvent.mouseDown(screen.getByText(RAINBOW_REEF.label));
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The reason this card mutates through a hidden `<form>` at all (issue #629).
 *
 * `saveAddressAction` redirects back to `/shop/<slug>/settings` on its
 * validation-failure branch, and `PreserveFormScroll` remembers the viewport by
 * listening for a `submit` DOM event on `document`. All three of this card's
 * mutations used to call the action straight out of their click handler, so no
 * such event ever fired — and a staffer who picked an address two-thirds of the
 * way down Settings and hit that branch was thrown back to the top of the page
 * with nothing to restore them.
 *
 * These assert the event, not the scroll: the restoring half is
 * `PreserveFormScroll`'s own, already covered, and it is reached by any form.
 */
describe("every mutation the address card makes", () => {
  let submissions: HTMLFormElement[];
  function record(event: Event) {
    if (event.target instanceof HTMLFormElement) submissions.push(event.target);
  }

  beforeEach(() => {
    submissions = [];
    document.addEventListener("submit", record);
  });
  afterEach(() => document.removeEventListener("submit", record));

  it("fires a real submit event when a suggestion is picked", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [RAINBOW_REEF] });
    renderCard();

    await user.type(screen.getByRole("combobox"), "Rainbow Reef");
    await user.click(await screen.findByText(RAINBOW_REEF.label));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(submissions).toHaveLength(1);
    // Opting out of preservation is a thing a form can do; this one must not.
    expect(submissions[0]?.dataset.scrollReset).toBeUndefined();
  });

  it("fires one when the pick was made with the keyboard", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [RAINBOW_REEF] });
    renderCard();

    await user.type(screen.getByRole("combobox"), "Rainbow Reef");
    await screen.findByText(RAINBOW_REEF.label);
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(submissions).toHaveLength(1);
  });

  it("fires one when the address is removed", async () => {
    const user = userEvent.setup();
    renderCard({ initial: KEY_LARGO_ADDRESS });

    await user.click(screen.getByRole("button", { name: copy.removeLabel }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(submissions).toHaveLength(1);
  });

  it("carries a geocoded place's coordinates through the hidden boxes", async () => {
    // The field list is fixed now, so the pair that is usually empty is the one
    // that could silently stop being sent at all.
    const user = userEvent.setup();
    suggest.mockResolvedValue({
      status: "ok",
      suggestions: [
        {
          ...RAINBOW_REEF,
          address: { ...KEY_LARGO_ADDRESS, latitude: 25.0865, longitude: -80.4473 },
        },
      ],
    });
    renderCard();

    await user.type(screen.getByRole("combobox"), "Rainbow Reef");
    await user.click(await screen.findByText(RAINBOW_REEF.label));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(save.mock.calls[0][0])).toEqual({
      ...KEY_LARGO_ADDRESS,
      latitude: "25.0865",
      longitude: "-80.4473",
    });
  });
});
