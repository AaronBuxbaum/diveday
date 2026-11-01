import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useState } from "react";
import { CLEAR_CONFIRM_MIN_GAP_MS, CLEAR_CONFIRM_TIMEOUT_MS } from "@/lib/pre-departure-check";

/**
 * Shared confirmation mechanics for clearing a checked pre-departure item.
 * The caller keeps ownership of the write and its pending state.
 */
export function useClearConfirmation({ checked, pending }: { checked: boolean; pending: boolean }) {
  const [asking, setAsking] = useState(false);
  const [settled, setSettled] = useState(false);
  const askingNow = asking && checked;
  const armed = askingNow && settled;

  const standDown = () => {
    setAsking(false);
    setSettled(false);
  };

  useEffect(() => {
    if (!askingNow) return;
    const settle = setTimeout(() => setSettled(true), CLEAR_CONFIRM_MIN_GAP_MS);
    const expire = setTimeout(() => {
      setAsking(false);
      setSettled(false);
    }, CLEAR_CONFIRM_TIMEOUT_MS);
    return () => {
      clearTimeout(settle);
      clearTimeout(expire);
    };
  }, [askingNow]);

  // A refused or successful write spends the ask once its pending state settles.
  useEffect(() => {
    if (!pending) {
      setAsking(false);
      setSettled(false);
    }
  }, [pending]);

  const requestClear = (event: MouseEvent<HTMLButtonElement>) => {
    if (!checked || armed) return armed;
    event.preventDefault();
    // A tap inside the gap is the first one bouncing: ignored.
    if (!askingNow) setAsking(true);
    return false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // A held Enter repeats keydown, and each repeat clicks: one press could
    // ask and then clear. Only the first press counts.
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") standDown();
  };

  return { armed, standDown, requestClear, onKeyDown };
}
