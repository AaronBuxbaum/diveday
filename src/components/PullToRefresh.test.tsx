// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullToRefresh } from "./PullToRefresh";

afterEach(() => {
  cleanup();
});

describe("PullToRefresh", () => {
  it("renders children at rest", () => {
    render(
      <PullToRefresh onRefresh={vi.fn()}>
        <div>Manifest Content</div>
      </PullToRefresh>,
    );

    expect(screen.getByText("Manifest Content")).toBeInTheDocument();
  });

  it("does not trigger on small drag below threshold", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div>Manifest Content</div>
      </PullToRefresh>,
    );

    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(root, { button: 0, clientY: 10 });
    fireEvent.pointerMove(root, { clientY: 30 });
    fireEvent.pointerUp(root);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("triggers onRefresh when pulled past threshold and released", async () => {
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const onRefresh = vi.fn().mockReturnValue(refreshPromise);

    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div>Manifest Content</div>
      </PullToRefresh>,
    );

    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(root, { button: 0, clientY: 10 });
    // Pull down by 150px (damped value will exceed threshold 60px)
    fireEvent.pointerMove(root, { clientY: 160 });

    expect(screen.getByText("Release to sync")).toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerUp(root);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Syncing…")).toBeInTheDocument();

    await act(async () => {
      resolveRefresh();
    });
  });

  it("accepts a touch pointer, whose primary button is -1", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div>Manifest Content</div>
      </PullToRefresh>,
    );

    const root = container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(root, { button: -1, pointerType: "touch", clientY: 10 });
    fireEvent.pointerMove(root, { pointerType: "touch", clientY: 160 });
    await act(async () => {
      fireEvent.pointerUp(root, { pointerType: "touch" });
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
