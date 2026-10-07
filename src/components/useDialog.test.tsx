// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDialog } from "./useDialog";

afterEach(cleanup);

function Harness({ lockScroll = false, onClose }: { lockScroll?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { mounted } = useDialog({
    open,
    onClose: () => {
      onClose?.();
      setOpen(false);
    },
    containerRef: ref,
    exitMs: 0,
    lockScroll,
  });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {mounted ? (
        <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
          <button type="button">Inside</button>
        </div>
      ) : null}
    </>
  );
}

describe("useDialog", () => {
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
});
