// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { useReportWebVitals } from "next/web-vitals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebVitals } from "./web-vitals-client";

const reports = vi.hoisted(() => ({
  callback: undefined as Parameters<typeof useReportWebVitals>[0] | undefined,
}));
vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (callback: Parameters<typeof useReportWebVitals>[0]) => {
    reports.callback = callback;
  },
}));

function report(name = "CLS", value = 0.1, id = "metric-1") {
  act(() =>
    reports.callback?.({
      name,
      value,
      id,
      delta: value,
      rating: "good",
      entries: [],
      navigationType: "navigate",
    } as Parameters<Parameters<typeof useReportWebVitals>[0]>[0]),
  );
}
function hide() {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}
function show() {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}
function pagehide() {
  act(() => window.dispatchEvent(new Event("pagehide")));
}

const beacon = vi.fn((_url: string, _body: Blob) => true);
beforeEach(() => {
  beacon.mockReset().mockReturnValue(true);
  vi.stubGlobal("navigator", { sendBeacon: beacon });
  window.history.replaceState({}, "", "/shop");
  show();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("web vitals visibility reporting", () => {
  it("retries a rejected beacon on pagehide instead of marking it sent", () => {
    beacon.mockReturnValueOnce(false);
    render(<WebVitals />);
    report();
    hide();
    pagehide();
    expect(beacon).toHaveBeenCalledTimes(2);
    pagehide();
    expect(beacon).toHaveBeenCalledTimes(2);
  });
  it("retains metrics when the beacon throws", () => {
    beacon.mockImplementationOnce(() => {
      throw new Error("transport unavailable");
    });
    render(<WebVitals />);
    report();
    hide();
    pagehide();
    expect(beacon).toHaveBeenCalledTimes(2);
  });
  it("reports changed vitals after resuming without replaying identical reports", () => {
    render(<WebVitals />);
    report();
    hide();
    pagehide();
    show();
    report();
    hide();
    expect(beacon).toHaveBeenCalledTimes(1);
    show();
    report("CLS", 0.2);
    hide();
    pagehide();
    expect(beacon).toHaveBeenCalledTimes(2);
  });
  it("accepts a new metric identity after a bfcache restore even at the same value", () => {
    render(<WebVitals />);
    report();
    hide();
    show();
    report("CLS", 0.1, "metric-restored");
    hide();
    expect(beacon).toHaveBeenCalledTimes(2);
  });
  it("sends no empty report and removes listeners on unmount", () => {
    const view = render(<WebVitals />);
    hide();
    pagehide();
    expect(beacon).not.toHaveBeenCalled();
    report();
    view.unmount();
    hide();
    pagehide();
    expect(beacon).not.toHaveBeenCalled();
  });
});

async function payload(index = 0) {
  const blob = beacon.mock.calls[index]?.[1] as Blob | undefined;
  if (!blob) throw new Error("no beacon body");
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
  return JSON.parse(text);
}

it("only sends updated metrics after resume, preserving the redacted entry route", async () => {
  window.history.replaceState({}, "", "/ready/secret-token?token=also-secret");
  render(<WebVitals />);
  report("CLS", 0.1);
  report("LCP", 1000, "lcp-1");
  hide();
  const first = await payload();
  expect(JSON.stringify(first)).not.toContain("secret");
  expect(first.metrics).toHaveLength(2);
  show();
  window.history.replaceState({}, "", "/shop/new-route");
  report("CLS", 0.2);
  hide();
  expect(await payload(1)).toEqual({
    url: first.url,
    navigationType: "navigate",
    metrics: [{ name: "CLS", value: 0.2 }],
  });
});
