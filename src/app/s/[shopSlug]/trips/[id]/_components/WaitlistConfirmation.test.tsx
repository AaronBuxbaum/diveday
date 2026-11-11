// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCROLL_SETTLED_ATTRIBUTE } from "@/components/PreserveFormScroll";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { renderDiver } from "@/test/intl";
import { WaitlistConfirmation } from "./BookingSections";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    Number(setTimeout(() => fn(0), 0)),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(735);
  document.documentElement.style.scrollPaddingTop = "56px";
  document.documentElement.setAttribute(SCROLL_SETTLED_ATTRIBUTE, "true");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(SCROLL_SETTLED_ATTRIBUTE);
  document.documentElement.style.scrollPaddingTop = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function confirmation(top: number, bottom: number) {
  const rendered = renderDiver(<WaitlistConfirmation firstName="Astra" shopSlug="reef-shop" />);
  const heading = screen.getByRole("heading", { name: "You’re on the wait list, Astra" });
  const status = screen.getByRole("status");
  status.getBoundingClientRect = () => ({ top, bottom, height: bottom - top }) as DOMRect;
  const reveal = vi.fn();
  status.scrollIntoView = reveal;
  return { ...rendered, heading, status, reveal };
}

describe("the wait-list form's replacement", () => {
  it("announces the saved outcome and focuses it without a second scroll", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const { heading, status, reveal } = confirmation(-195, 20);
    expect(status).toHaveTextContent("You’re on the wait list, Astra");
    expect(heading).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    vi.runAllTimers();
    expect(reveal).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("leaves an already visible result in place and does not refocus on rerender", () => {
    const { rerender, reveal } = confirmation(100, 315);
    const back = screen.getByRole("link");
    back.focus();
    rerender(
      <DiverIntlProvider
        locale="en-US"
        timeZone="America/New_York"
        namespaces={["booking", "common"]}
      >
        <WaitlistConfirmation firstName="Astra" shopSlug="reef-shop" />
      </DiverIntlProvider>,
    );
    vi.runAllTimers();
    expect(reveal).not.toHaveBeenCalled();
    expect(back).toHaveFocus();
  });

  it("cancels a pending reveal when navigation interrupts the confirmation", () => {
    const { unmount, reveal } = confirmation(-195, 20);
    unmount();
    vi.runAllTimers();
    expect(reveal).not.toHaveBeenCalled();
  });
});
