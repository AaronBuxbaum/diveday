// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createElement, Fragment, useEffect, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { focusAfterStaffCheck } from "./focus-after-staff-check";
import { useFocusTrap } from "./useFocusTrap";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function FocusTrapHarness({ covered, open }: { covered: boolean; open: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  useFocusTrap(open, dialogRef);
  useEffect(() => focusAfterStaffCheck(fieldRef.current), []);

  return createElement(
    Fragment,
    null,
    createElement(
      "main",
      { inert: covered },
      createElement("input", { ref: fieldRef, "aria-label": "New departure title" }),
    ),
    open
      ? createElement(
          "div",
          { ref: dialogRef, "data-staff-session-lock": true, tabIndex: -1 },
          "Session paused",
        )
      : null,
  );
}

it("waits for a covered field and does not steal a later focus", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const content = document.createElement("div");
  content.setAttribute("inert", "");
  const field = document.createElement("input");
  content.append(field);
  document.body.append(content);
  const cancel = focusAfterStaffCheck(field);
  expect(document.activeElement).not.toBe(field);
  content.removeAttribute("inert");
  document.dispatchEvent(new Event("staff-session-unlocked"));
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  frames[0]?.(0);
  expect(document.activeElement).toBe(other);
  cancel();
});

it("retries an initial focus request when the session locks after it", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  const content = document.createElement("div");
  const field = document.createElement("input");
  const lock = document.createElement("div");
  lock.tabIndex = -1;
  lock.setAttribute("data-staff-session-lock", "");
  content.append(field);
  document.body.append(content, lock);

  const cancel = focusAfterStaffCheck(field);
  expect(document.activeElement).toBe(field);

  content.setAttribute("inert", "");
  lock.focus();
  content.removeAttribute("inert");
  document.dispatchEvent(new Event("staff-session-unlocked"));
  frames[0]?.(0);

  expect(document.activeElement).toBe(field);
  cancel();
});

it("does not focus a field that unmounted before verification", () => {
  const field = document.createElement("input");
  const content = document.createElement("div");
  content.setAttribute("inert", "");
  content.append(field);
  document.body.append(content);
  const cancel = focusAfterStaffCheck(field);
  cancel();
  content.remove();
  document.dispatchEvent(new Event("staff-session-unlocked"));
  expect(document.activeElement).not.toBe(field);
});

it("waits when the field mounts before the session check starts", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const check = document.createElement("span");
  check.hidden = true;
  check.setAttribute("data-staff-session-check", "pending");
  const content = document.createElement("div");
  const field = document.createElement("input");
  content.append(field);
  document.body.append(check, content);

  const cancel = focusAfterStaffCheck(field);
  expect(document.activeElement).not.toBe(field);
  content.setAttribute("inert", "");
  content.removeAttribute("inert");
  check.setAttribute("data-staff-session-check", "settled");
  document.dispatchEvent(new Event("staff-session-unlocked"));
  frames[0]?.(0);

  expect(document.activeElement).toBe(field);
  cancel();
});

it("keeps the focus request when streamed content mounts during session unlock", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });

  const check = document.createElement("span");
  check.hidden = true;
  check.setAttribute("data-staff-session-check", "pending");
  const field = document.createElement("input");
  document.body.append(check, field);

  // The unlock event ran, but React has not yet committed the settled marker.
  document.dispatchEvent(new Event("staff-session-unlocked"));
  const cancel = focusAfterStaffCheck(field);
  expect(document.activeElement).not.toBe(field);

  check.setAttribute("data-staff-session-check", "settled");
  await Promise.resolve();
  frames[0]?.(0);

  expect(document.activeElement).toBe(field);
  cancel();
});

it("keeps the session-unlocked focus when the trap closes", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  const previous = document.createElement("button");
  document.body.append(previous);
  previous.focus();

  const { rerender } = render(createElement(FocusTrapHarness, { covered: true, open: true }));
  expect(document.activeElement).toHaveAttribute("data-staff-session-lock");

  rerender(createElement(FocusTrapHarness, { covered: false, open: true }));
  act(() => {
    document.dispatchEvent(new Event("staff-session-unlocked"));
    frames[0]?.(0);
  });
  const field = document.querySelector<HTMLInputElement>("input");
  expect(field).toHaveFocus();

  rerender(createElement(FocusTrapHarness, { covered: false, open: false }));
  expect(field).toHaveFocus();
});

it("still focuses the field when the closing lock dialog holds focus after the lock flag clears", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const content = document.createElement("div");
  const field = document.createElement("input");
  const root = document.createElement("div");
  root.setAttribute("data-staff-session-root", "");
  const dialog = document.createElement("div");
  dialog.tabIndex = -1;
  root.append(dialog);
  content.append(field);
  document.body.append(content, root);

  const cancel = focusAfterStaffCheck(field);
  dialog.focus();
  document.dispatchEvent(new Event("staff-session-unlocked"));
  // StaffActivity clears data-staff-session-lock before React unmounts the dialog.
  frames[0]?.(0);

  expect(document.activeElement).toBe(field);
  cancel();
});
