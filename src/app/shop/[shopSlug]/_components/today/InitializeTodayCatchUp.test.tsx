// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InitializeTodayCatchUp } from "./InitializeTodayCatchUp";

afterEach(cleanup);

describe("InitializeTodayCatchUp", () => {
  it("stays pending until the initialization action resolves", async () => {
    let resolveAction!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const { container } = render(<InitializeTodayCatchUp action={action} />);
    const marker = container.querySelector("[data-today-catch-up-state]");

    expect(marker).toHaveAttribute("data-today-catch-up-state", "pending");
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => resolveAction());
    expect(marker).toHaveAttribute("data-today-catch-up-state", "ready");
  });

  it("stays non-ready when the initialization action rejects", async () => {
    const action = vi.fn().mockRejectedValue(new Error("initialization failed"));
    const { container } = render(<InitializeTodayCatchUp action={action} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("[data-today-catch-up-state]")).toHaveAttribute(
      "data-today-catch-up-state",
      "failed",
    );
  });

  it("starts the action once across Strict Mode effect replay", async () => {
    let resolveAction!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const { container } = render(
      <StrictMode>
        <InitializeTodayCatchUp action={action} />
      </StrictMode>,
    );

    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => resolveAction());
    expect(container.querySelector("[data-today-catch-up-state]")).toHaveAttribute(
      "data-today-catch-up-state",
      "ready",
    );
  });

  it("does not let an older action resolve the marker after its identity changes", async () => {
    let resolveOld!: () => void;
    let resolveCurrent!: () => void;
    const oldAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const currentAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCurrent = resolve;
        }),
    );
    const { container, rerender } = render(<InitializeTodayCatchUp action={oldAction} />);

    rerender(<InitializeTodayCatchUp action={currentAction} />);
    await act(async () => resolveOld());
    expect(container.querySelector("[data-today-catch-up-state]")).toHaveAttribute(
      "data-today-catch-up-state",
      "pending",
    );

    await act(async () => resolveCurrent());
    expect(container.querySelector("[data-today-catch-up-state]")).toHaveAttribute(
      "data-today-catch-up-state",
      "ready",
    );
  });

  it("renders pending immediately when a previously ready action is replaced", async () => {
    let resolveCurrent!: () => void;
    const previousAction = vi.fn().mockResolvedValue(undefined);
    const currentAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCurrent = resolve;
        }),
    );
    const { container, rerender } = render(
      <InitializeTodayCatchUp action={previousAction} />,
    );

    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-today-catch-up-state]")).toHaveAttribute(
      "data-today-catch-up-state",
      "ready",
    );

    rerender(<InitializeTodayCatchUp action={currentAction} />);
    expect(container.querySelector("[data-today-catch-up-state]")).toHaveAttribute(
      "data-today-catch-up-state",
      "pending",
    );

    await act(async () => resolveCurrent());
    expect(container.querySelector("[data-today-catch-up-state]")).toHaveAttribute(
      "data-today-catch-up-state",
      "ready",
    );
  });
});
