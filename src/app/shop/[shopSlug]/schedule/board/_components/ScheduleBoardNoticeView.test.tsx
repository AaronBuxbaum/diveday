// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ScheduleBoardNoticeView } from "./ScheduleBoardNoticeView";

vi.mock("@/app/shop/[shopSlug]/_components/RescheduleHold", () => ({
  RescheduleHold: () => null,
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

it("accumulates separate move results and consumes their query parameters once", () => {
  const first = "2 gear assignments were released.";
  const second = "1 gear assignment was released.";
  window.history.replaceState(
    {},
    "",
    "/shop/reef/schedule/board?week=2026-10-26&builder=moved&gear=2&result=move-one",
  );
  const props = {
    initialNotice: null,
    notice: { tone: "warning" as const, message: first },
    gearMessage: first,
  };
  const view = render(
    <StrictMode>
      <ScheduleBoardNoticeView {...props} resultId="move-one" />
    </StrictMode>,
  );

  expect(screen.getByText(first)).toBeVisible();
  expect(window.location.search).toBe("?week=2026-10-26");

  window.history.replaceState(
    {},
    "",
    "/shop/reef/schedule/board?builder=moved&gear=1&result=move-two",
  );
  view.rerender(
    <StrictMode>
      <ScheduleBoardNoticeView
        {...props}
        notice={{ tone: "warning", message: second }}
        gearMessage={second}
        resultId="move-two"
      />
    </StrictMode>,
  );

  expect(screen.getByText(first)).toBeVisible();
  expect(screen.getByText(second)).toBeVisible();
  expect(window.location.search).toBe("");
});

it("clears a visit's gear notices before a cached page can be restored", () => {
  const message = "2 gear assignments were released.";
  const view = render(
    <ScheduleBoardNoticeView
      initialNotice={null}
      notice={{ tone: "warning", message }}
      gearMessage={message}
      resultId="move-one"
    />,
  );
  expect(screen.getByText(message)).toBeVisible();

  act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  expect(view.container).toBeEmptyDOMElement();

  act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  expect(view.container).toBeEmptyDOMElement();
});
