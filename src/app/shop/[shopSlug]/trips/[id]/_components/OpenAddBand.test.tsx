// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADD_A_BOOKING_ID } from "./add-a-booking-id";
import { OpenAddBand } from "./OpenAddBand";

afterEach(cleanup);

describe("OpenAddBand", () => {
  it("brings the add band on screen and puts the cursor in its search", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container } = render(
      <>
        <div id={ADD_A_BOOKING_ID}>
          <form>
            <input type="hidden" name="request" value="r-1" />
            <input type="search" name="diverq" aria-label="Find a diver" />
          </form>
        </div>
        <OpenAddBand />
      </>,
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(document.activeElement).toBe(container.querySelector('input[name="diverq"]'));
  });

  it("does nothing on a departure with no band", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<OpenAddBand />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});
