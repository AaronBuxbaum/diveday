// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SuggestShopLink } from "./SuggestShopLink";

afterEach(cleanup);

/**
 * **The shop link and the address it produces** (ADR 20260827-first-light,
 * decision 1). The rules pinned here are the design's, not the layout's: what
 * the line says, when it is allowed to say it, and — the silence that matters
 * — when it must say nothing at all.
 *
 * The component enhances two native inputs the page already renders, so every
 * case below stands those inputs up itself, exactly as `/onboard` does.
 */
function mount({ slugValue = "", fieldError }: { slugValue?: string; fieldError?: string } = {}) {
  return render(
    <form>
      <input id="shop-name" name="shopName" defaultValue="" />
      <input id="shop-slug" name="shopSlug" defaultValue={slugValue} />
      <p data-testid="hint">
        <SuggestShopLink
          nameId="shop-name"
          slugId="shop-slug"
          initialSlug={slugValue}
          urlLead="Your schedule will live at"
          urlHost="dive.day"
          fieldError={fieldError}
        />
      </p>
    </form>,
  );
}

const nameBox = () => document.getElementById("shop-name") as HTMLInputElement;
const slugBox = () => document.getElementById("shop-slug") as HTMLInputElement;
const hint = () => screen.getByTestId("hint");
function inputById(id: string): HTMLInputElement {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Expected input #${id}`);
  return input;
}

describe("the storefront address under the shop-link field", () => {
  it("reads the address the slug already in the box produces", () => {
    mount({ slugValue: "torchlight" });
    expect(hint()).toHaveTextContent("Your schedule will live at dive.day/s/torchlight");
  });

  it("writes itself as the shop's name is typed, alongside the box it fills", () => {
    mount();
    fireEvent.input(nameBox(), { target: { value: "Torchlight Divers" } });

    // Both halves of the same keystroke: the box gets the slug, the line under
    // it gets the address — the owner never has to imagine the join.
    expect(slugBox().value).toBe("torchlight-divers");
    expect(hint()).toHaveTextContent("dive.day/s/torchlight-divers");
  });

  it("shows the normalized slug, not the keystrokes", () => {
    mount();
    // A shop that types its own link straight into the box: capitals, spaces
    // and a trailing hyphen are what the URL would *not* have, and the line has
    // to say the address that will exist rather than echo the box.
    fireEvent.input(slugBox(), { target: { value: "Coral Cove -" } });
    expect(hint()).toHaveTextContent("dive.day/s/coral-cove");
  });

  it("renders nothing at all while the field carries a refusal", () => {
    // The design's silence: the box's own error is the only line under it. A
    // "your schedule will live at" beside "that link is taken" argues with the
    // refusal at the moment the owner is reading it.
    mount({ slugValue: "blue-mantis", fieldError: "That shop link is already taken." });
    expect(hint()).toBeEmptyDOMElement();
    expect(screen.queryByText(/Your schedule will live at/)).toBeNull();
    expect(screen.queryByText(/dive\.day/)).toBeNull();
  });

  it("says nothing on a fresh form, where there is no address yet", () => {
    // The other silence, and the one that is easy to miss: before the owner has
    // typed anything there is no slug, and `dive.day/s/` is not an address —
    // it is the shape of one with the answer missing. Rendering the bare host
    // instead would be the same defect in fewer characters.
    mount();
    expect(hint()).toBeEmptyDOMElement();
    expect(screen.queryByText(/Your schedule will live at/)).toBeNull();
    expect(screen.queryByText(/dive\.day/)).toBeNull();
  });

  it("starts speaking as soon as the name gives it one", () => {
    // And the silence lifts the moment there is something true to say, so the
    // guard above can never be satisfied by a hint that simply never renders.
    mount();
    fireEvent.input(nameBox(), { target: { value: "Coral Cove Divers" } });
    expect(hint()).toHaveTextContent("dive.day/s/coral-cove-divers");
  });

  it("keeps filling the box while it is refused — the hint stands down, the wiring does not", () => {
    // Mounting is what wires the two inputs together, so rendering nothing may
    // not mean doing nothing: a form bounced back with an empty slug must still
    // suggest one as the name is retyped.
    mount({ fieldError: "Shop link is required" });
    fireEvent.input(nameBox(), { target: { value: "Reef Runners" } });
    expect(slugBox().value).toBe("reef-runners");
  });

  it("never overwrites a link the owner typed", () => {
    mount();
    fireEvent.input(slugBox(), { target: { value: "mine" } });
    fireEvent.input(nameBox(), { target: { value: "Something Else Entirely" } });
    expect(slugBox().value).toBe("mine");
    expect(hint()).toHaveTextContent("dive.day/s/mine");
  });

  it("leaves a prefilled link alone as the shop name changes", () => {
    mount({ slugValue: "existing-link" });
    fireEvent.input(nameBox(), { target: { value: "A Different Shop Name" } });

    expect(slugBox().value).toBe("existing-link");
    expect(hint()).toHaveTextContent("dive.day/s/existing-link");
  });

  it("does not resume suggesting after a generated link is manually cleared", () => {
    mount();
    fireEvent.input(nameBox(), { target: { value: "First Shop Name" } });
    expect(slugBox().value).toBe("first-shop-name");

    fireEvent.input(slugBox(), { target: { value: "my-own-link" } });
    fireEvent.input(slugBox(), { target: { value: "" } });
    fireEvent.input(nameBox(), { target: { value: "Another Shop Name" } });

    expect(slugBox().value).toBe("");
    expect(hint()).toBeEmptyDOMElement();
  });

  it("removes its input listeners when it unmounts", () => {
    render(
      <>
        <input id="unmounted-shop-name" defaultValue="" />
        <input id="unmounted-shop-slug" defaultValue="" />
      </>,
    );
    const suggestion = render(
      <SuggestShopLink
        nameId="unmounted-shop-name"
        slugId="unmounted-shop-slug"
        urlLead="Your schedule will live at"
        urlHost="dive.day"
      />,
    );

    suggestion.unmount();
    fireEvent.input(inputById("unmounted-shop-name"), {
      target: { value: "No Longer Mounted" },
    });

    expect(inputById("unmounted-shop-slug").value).toBe("");
  });

  it("keeps the remaining instance wired when another instance unmounts", () => {
    render(
      <>
        <input id="shared-shop-name" defaultValue="" />
        <input id="shared-shop-slug" defaultValue="" />
      </>,
    );
    const first = render(
      <p data-testid="second-hint">
        <SuggestShopLink
          nameId="shared-shop-name"
          slugId="shared-shop-slug"
          urlLead="Your schedule will live at"
          urlHost="dive.day"
        />
      </p>,
    );
    const second = render(
      <p data-testid="remaining-hint">
        <SuggestShopLink
          nameId="shared-shop-name"
          slugId="shared-shop-slug"
          urlLead="Your schedule will live at"
          urlHost="dive.day"
        />
      </p>,
    );

    first.unmount();
    fireEvent.input(inputById("shared-shop-name"), {
      target: { value: "Reef Runners" },
    });

    expect(inputById("shared-shop-slug").value).toBe("reef-runners");
    expect(second.getByTestId("remaining-hint")).toHaveTextContent("dive.day/s/reef-runners");
  });

  it("keeps listener cleanup balanced under Strict Mode", () => {
    const { unmount } = render(
      <StrictMode>
        <input id="strict-shop-name" defaultValue="" />
        <input id="strict-shop-slug" defaultValue="" />
        <p data-testid="strict-hint">
          <SuggestShopLink
            nameId="strict-shop-name"
            slugId="strict-shop-slug"
            urlLead="Your schedule will live at"
            urlHost="dive.day"
          />
        </p>
      </StrictMode>,
    );
    fireEvent.input(inputById("strict-shop-name"), {
      target: { value: "Coral Cove" },
    });
    expect(inputById("strict-shop-slug").value).toBe("coral-cove");
    expect(screen.getByTestId("strict-hint")).toHaveTextContent("dive.day/s/coral-cove");
    unmount();
  });
});
