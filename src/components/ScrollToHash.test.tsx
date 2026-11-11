// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SCROLL_SETTLED_ATTRIBUTE } from "./PreserveFormScroll";
import { ScrollToHash } from "./ScrollToHash";

const scroll = vi.fn();
beforeEach(() => {
  scroll.mockClear();
  HTMLElement.prototype.scrollIntoView = scroll;
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    Number(setTimeout(() => fn(0), 0)),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  document.documentElement.setAttribute(SCROLL_SETTLED_ATTRIBUTE, "true");
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute(SCROLL_SETTLED_ATTRIBUTE);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function recovery(hash = "#recovery") {
  window.history.replaceState(null, "", `/${hash}`);
  const rendered = render(
    <>
      <section id="recovery">
        <input aria-label="Email" />
      </section>
      <ScrollToHash onlyHash="recovery" focusSelector="input" />
    </>,
  );
  const field = screen.getByRole("textbox");
  const target = field.parentElement as HTMLElement;
  return { ...rendered, field, target, scroll };
}

it("lands on an explicit recovery hash after its field is rendered", () => {
  const { field, scroll } = recovery();
  let visible = false;
  field.checkVisibility = () => visible;
  vi.advanceTimersByTime(0);
  expect(field).not.toHaveFocus();
  expect(scroll).not.toHaveBeenCalled();
  visible = true;
  vi.runAllTimers();
  expect(field).toHaveFocus();
  expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
});

it.each(["", "#unrelated"])("does not focus or scroll on an unrelated load: %s", (hash) => {
  const { field, scroll } = recovery(hash);
  vi.runAllTimers();
  expect(field).not.toHaveFocus();
  expect(scroll).not.toHaveBeenCalled();
});

it("cancels the landing when navigation interrupts it", () => {
  const { unmount, scroll } = recovery();
  unmount();
  vi.runAllTimers();
  expect(scroll).not.toHaveBeenCalled();
});
