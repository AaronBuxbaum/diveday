// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressLookupResult } from "@/lib/address-lookup";
import { AddressFields } from "./AddressFields";

// The action drags next-auth (and the whole Next server runtime) in behind it.
const suggest = vi.fn<(query: string) => Promise<AddressLookupResult>>();
vi.mock("./actions", () => ({ suggestAddressAction: (query: string) => suggest(query) }));

const copy = {
  searchLabel: "Find your address",
  searchHint: "optional",
  searchPlaceholder: "Start typing…",
  searching: "Looking…",
  noMatches: "No matches",
  lookupFailed: "Address lookup isn't available right now.",
  lookupResting: "That's a lot of lookups for one hour — searching pauses for a bit.",
  suggestionsLabel: "Address suggestions",
  streetLabel: "Street address",
  streetPlaceholder: "",
  localityLabel: "City / town",
  localityPlaceholder: "",
  regionLabel: "State / region",
  regionPlaceholder: "",
  postalCodeLabel: "Postal code",
  postalCodePlaceholder: "",
  countryLabel: "Country code",
  countryHint: "two letters",
  countryPlaceholder: "",
};

const EMPTY = {
  addressStreet: "",
  addressLocality: "",
  addressRegion: "",
  addressPostalCode: "",
  addressCountry: "",
};

const KEY_LARGO = {
  id: "place-1",
  label: "102 Ocean Drive, Key Largo, FL 33037",
  address: {
    addressStreet: "102 Ocean Drive",
    addressLocality: "Key Largo",
    addressRegion: "FL",
    addressPostalCode: "33037",
    addressCountry: "US",
  },
};

function renderFields(props: { enabled?: boolean; initial?: typeof EMPTY } = {}) {
  return render(
    <AddressFields initial={props.initial ?? EMPTY} enabled={props.enabled ?? true} copy={copy} />,
  );
}

const field = (label: string) => screen.getByLabelText(new RegExp(label, "i"));

beforeEach(() => {
  suggest.mockReset();
});
afterEach(cleanup);

describe("the address card with no geocoder configured", () => {
  it("is exactly the five boxes, with no control that looks broken", () => {
    renderFields({ enabled: false });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    for (const label of ["Street address", "City / town", "State / region", "Postal code"]) {
      expect(field(label)).toBeInTheDocument();
    }
  });

  it("still posts whatever the shop typed by hand", async () => {
    const user = userEvent.setup();
    renderFields({ enabled: false });
    await user.type(field("Street address"), "1 Dock Road");
    expect(field("Street address")).toHaveValue("1 Dock Road");
  });
});

describe("the address card with a geocoder", () => {
  it("does not spend a request on a query too short to mean anything", async () => {
    const user = userEvent.setup();
    renderFields();
    await user.type(screen.getByRole("combobox"), "10");
    // Past the debounce, and still nothing sent.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(suggest).not.toHaveBeenCalled();
  });

  it("fills all five boxes from the picked place", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [KEY_LARGO] });
    renderFields();

    await user.type(screen.getByRole("combobox"), "102 Ocean");
    const option = await screen.findByText(KEY_LARGO.label);
    await user.click(option);

    await waitFor(() => expect(field("Street address")).toHaveValue("102 Ocean Drive"));
    expect(field("City / town")).toHaveValue("Key Largo");
    expect(field("State / region")).toHaveValue("FL");
    expect(field("Postal code")).toHaveValue("33037");
    expect(field("Country code")).toHaveValue("US");
  });

  it("replaces the whole address rather than merging into what was there", async () => {
    // Half of one address and half of another is worse than either: a picked
    // place with no postcode has to clear the postcode box.
    const user = userEvent.setup();
    suggest.mockResolvedValue({
      status: "ok",
      suggestions: [{ ...KEY_LARGO, address: { ...EMPTY, addressLocality: "Cozumel" } }],
    });
    renderFields({
      initial: { ...EMPTY, addressPostalCode: "33037", addressCountry: "US" },
    });

    await user.type(screen.getByRole("combobox"), "Cozumel");
    await user.click(await screen.findByText(KEY_LARGO.label));

    await waitFor(() => expect(field("City / town")).toHaveValue("Cozumel"));
    expect(field("Postal code")).toHaveValue("");
    expect(field("Country code")).toHaveValue("");
  });

  it("says so, and leaves the boxes usable, when the lookup is unavailable", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "failed" });
    renderFields();

    await user.type(screen.getByRole("combobox"), "102 Ocean");

    expect(await screen.findByText(copy.lookupFailed)).toBeInTheDocument();
    await user.type(field("Street address"), "1 Dock Road");
    expect(field("Street address")).toHaveValue("1 Dock Road");
  });

  /**
   * Every fire is a *billed* Amazon Location request against an hourly budget,
   * and the budget running out looks, from this box, exactly like the geocoder
   * being down — which is how the card came to be reported as simply not
   * working (2026-08-06 review). These three keep the spend honest and the two
   * states apart.
   */
  it("does not re-ask the same question, however many times the typist pauses", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [KEY_LARGO] });
    renderFields();
    const combobox = screen.getByRole("combobox");

    await user.type(combobox, "102 Ocean");
    await screen.findByText(KEY_LARGO.label);
    expect(suggest).toHaveBeenCalledTimes(1);

    // A character typed and taken straight back out again lands on the same
    // query — the second pause must cost nothing.
    await user.type(combobox, "s");
    await user.keyboard("{Backspace}");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it("says the lookup is resting, not broken, when the hour's budget is spent", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "rate_limited" });
    renderFields();

    await user.type(screen.getByRole("combobox"), "102 Ocean");
    expect(await screen.findByText(copy.lookupResting)).toBeInTheDocument();
    expect(screen.queryByText(copy.lookupFailed)).not.toBeInTheDocument();
  });

  it("lets a refused query be asked again once the lookup recovers", async () => {
    // A rate-limited call learned nothing about the query, so the de-dupe must
    // not hold it back — otherwise the box stays dead for that text forever.
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "rate_limited" });
    renderFields();
    const combobox = screen.getByRole("combobox");

    await user.type(combobox, "102 Ocean");
    await screen.findByText(copy.lookupResting);

    suggest.mockResolvedValue({ status: "ok", suggestions: [KEY_LARGO] });
    await user.type(combobox, " ");
    await user.keyboard("{Backspace}");
    expect(await screen.findByText(KEY_LARGO.label)).toBeInTheDocument();
  });

  it("says when a real query simply matched nothing", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [] });
    renderFields();
    await user.type(screen.getByRole("combobox"), "zzzzzz");
    expect(await screen.findByText(copy.noMatches)).toBeInTheDocument();
  });

  it("picks with the keyboard, not only the mouse", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ status: "ok", suggestions: [KEY_LARGO] });
    renderFields();

    const combobox = screen.getByRole("combobox");
    await user.type(combobox, "102 Ocean");
    await screen.findByText(KEY_LARGO.label);
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(field("Street address")).toHaveValue("102 Ocean Drive"));
  });
});
