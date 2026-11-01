// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadAcknowledgmentLink } from "./DownloadAcknowledgmentLink";
import { buttonClass } from "./ui/button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PROPS = {
  href: "/shop/blue-mantis/settings/export/download",
  idleLabel: "Download export",
  acknowledgedLabel: "Export download requested",
};

describe("DownloadAcknowledgmentLink", () => {
  it("keeps the download href, labels and default button style", () => {
    render(<DownloadAcknowledgmentLink {...PROPS} />);
    const link = screen.getByRole("link", { name: PROPS.idleLabel });

    expect(link).toHaveAttribute("href", PROPS.href);
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("aria-live", "polite");
    expect(link.className).toBe(buttonClass());
  });

  it("supports the diver record's secondary button style", () => {
    render(<DownloadAcknowledgmentLink {...PROPS} variant="secondary" />);
    expect(screen.getByRole("link")).toHaveClass(buttonClass({ variant: "secondary" }));
  });

  it("acknowledges a click for 2.5 seconds and restarts the timer on a reclick", () => {
    vi.useFakeTimers();
    render(<DownloadAcknowledgmentLink {...PROPS} />);
    const link = screen.getByRole("link");

    fireEvent.click(link);
    expect(screen.getByRole("link", { name: PROPS.acknowledgedLabel })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(link);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("link", { name: PROPS.acknowledgedLabel })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("link", { name: PROPS.idleLabel })).toBeInTheDocument();
  });

  it("clears its acknowledgement timer on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<DownloadAcknowledgmentLink {...PROPS} />);
    fireEvent.click(screen.getByRole("link"));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
