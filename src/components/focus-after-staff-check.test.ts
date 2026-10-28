// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { focusAfterStaffCheck } from "./focus-after-staff-check";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

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
