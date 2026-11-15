// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("records bounded menu transitions without recording page text or URLs, then detaches", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("requestAnimationFrame", (fn) => window.setTimeout(fn, 1));
  document.elementFromPoint = () => document.querySelector("[data-staff-tabbar] ul a");
  document.body.innerHTML =
    '<p>private diver name</p><nav data-staff-tabbar><div><button aria-expanded="false">More</button></div></nav>';
  const source = readFileSync("scripts/mobile-more-trace.js", "utf8");
  new Function(source)();
  const button = document.querySelector("button");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  button.setAttribute("aria-expanded", "true");
  button.parentElement.insertAdjacentHTML(
    "beforeend",
    '<ul><li><a href="/private-token">private name</a></li></ul>',
  );
  await Promise.resolve();
  const replacement = button.cloneNode(true);
  button.replaceWith(replacement);
  await Promise.resolve();
  for (let n = 0; n < 50; n++)
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(10000);
  expect(log).toHaveBeenCalledOnce();
  const output = log.mock.calls[0][1];
  const trace = JSON.parse(output);
  expect(
    trace.records.some((entry) => entry.kind === "expanded-change" && entry.expanded === "true"),
  ).toBe(true);
  expect(trace.records.some((entry) => entry.panelId && entry.centerHitsPanel === true)).toBe(true);
  expect(
    trace.records.some(
      (entry) => entry.kind === "remount" && entry.buttonId !== trace.records[0].buttonId,
    ),
  ).toBe(true);
  expect(trace.records.at(-1).kind).toBe("end");
  expect(trace.dropped).toBeGreaterThan(0);
  expect(trace.records.length).toBeLessThanOrEqual(40);
  expect(output).not.toContain("private");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(10000);
  expect(log).toHaveBeenCalledOnce();
});
