// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDialogBehaviour } from "./useDialogBehaviour";

afterEach(cleanup);

function Harness({
  lockScroll = false,
  onClose,
  withTrigger = false,
}: {
  lockScroll?: boolean;
  onClose?: () => void;
  withTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { mounted, dialogProps } = useDialogBehaviour({
    open,
    onClose: () => {
      onClose?.();
      setOpen(false);
    },
    containerRef: ref,
    triggerRef: withTrigger ? triggerRef : undefined,
    exitMs: 0,
    lockScroll,
  });
  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Elsewhere</button>
      {mounted ? (
        <div ref={ref} role="dialog" {...dialogProps}>
          <button type="button" onClick={() => setOpen(false)}>
            Inside
          </button>
        </div>
      ) : null}
    </>
  );
}

describe("useDialogBehaviour", () => {
  it("closes on Escape, and only while open", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops the page scrolling while a sheet is up, and gives it back", async () => {
    vi.useFakeTimers();
    try {
      render(<Harness lockScroll />);
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(document.body.style.overflow).toBe("hidden");
      fireEvent.keyDown(document, { key: "Escape" });
      await act(async () => {
        vi.runAllTimers();
      });
      expect(document.body.style.overflow).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the page scrolling when not asked to lock it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(document.body.style.overflow).toBe("");
  });

  it("marks the panel as a modal dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus inside on open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("hands focus to the trigger on Escape and on its own close control", () => {
    render(<Harness withTrigger />);
    const trigger = screen.getByRole("button", { name: "Open" });

    fireEvent.click(trigger);
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Inside" }));
    expect(trigger).toHaveFocus();
  });
});
