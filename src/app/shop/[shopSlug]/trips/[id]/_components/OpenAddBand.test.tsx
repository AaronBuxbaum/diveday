// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADD_A_BOOKING_ID } from "./add-a-booking-id";
import { OpenAddBand } from "./OpenAddBand";

afterEach(cleanup);

describe("OpenAddBand", () => {
  it("brings the add band on screen and puts the cursor in its search", () => {
    // The readiness marker must remain pending while the effect can move the
    // page, so a browser click cannot race the scroll.
    const scrollIntoView = vi.fn(function (this: Element) {
      expect(this.querySelector("[data-open-add-band]")).not.toHaveAttribute(
        "data-open-add-band-settled",
      );
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container, unmount } = render(
      <>
        <div id={ADD_A_BOOKING_ID}>
          <form>
            <input type="hidden" name="request" value="r-1" />
            <input type="search" name="diverq" aria-label="Find a diver" />
          </form>
          <OpenAddBand />
        </div>
      </>,
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(container.querySelector("[data-open-add-band]")).toHaveAttribute(
      "data-open-add-band-settled",
      "",
    );
    expect(document.activeElement).toBe(container.querySelector('input[name="diverq"]'));
    const marker = container.querySelector("[data-open-add-band]");
    unmount();
    expect(marker).not.toHaveAttribute("data-open-add-band-settled");
  });

  it("does nothing on a departure with no band", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<OpenAddBand />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});
