"use client";

import { useEffect, useRef, useState } from "react";
import { fill, pluralForm } from "@/i18n/fill";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { reloadPage } from "./reload-page";

type AutosaveOutcome = "saved" | "skipped" | "closed" | "rate";

/** How long after the last answer a step is saved, when focus never leaves it. */
const SETTLE_MS = 2_000;

/**
 * **A counter code's time left, and its draft saved on each step** (issue
 * #3985). A counter QR lasts half an hour from when it was shown, so a slow
 * signer (a parent and a child, one phone) is told how long they have, and
 * every finished step is saved as they go, with no navigation: when focus
 * leaves a section, or a little after the last answer in it. A code that has
 * closed reloads the page, which then says to ask the staff for a fresh one.
 *
 * Pure enhancement: with no JavaScript the form still signs, and the line
 * says the clock time the code closes, rendered on the server.
 */
export function CounterAutosave({
  action,
  msLeft,
  closesAt,
  copy,
}: {
  action: (formData: FormData) => Promise<AutosaveOutcome>;
  /**
   * How long the code had left when the server drew the page. A count from
   * the page's own arrival, never the phone's clock, so a phone set fast
   * cannot reload the page in a loop.
   */
  msLeft: number;
  /** When the code closes, as the reader's clock time, formatted on the server. */
  closesAt: string;
  copy: { minutesOne: string; minutesOther: string; closesAt: string; saved: string };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const deadline = nowMs() + msLeft;
    let reloaded = false;
    const tick = () => {
      const left = Math.ceil((deadline - nowMs()) / MINUTE_MS);
      // Once, when the count runs out while the page is open.
      if (left <= 0 && msLeft > 0 && !reloaded) {
        reloaded = true;
        reloadPage();
      }
      setMinutes(Math.max(left, 0));
    };
    tick();
    const every = setInterval(tick, 15_000);
    return () => clearInterval(every);
  }, [msLeft]);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = async () => {
      const outcome = await action(new FormData(form));
      if (outcome === "saved") setSaved(true);
      if (outcome === "closed") reloadPage();
    };
    const soon = (wait: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void save(), wait);
    };
    // A step is a section the diver leaves.
    const onFocusOut = (event: FocusEvent) => {
      const from = (event.target as Element | null)?.closest("section, fieldset");
      const to = (event.relatedTarget as Element | null)?.closest("section, fieldset");
      if (from && from !== to) soon(0);
    };
    const onChange = () => {
      setSaved(false);
      soon(SETTLE_MS);
    };
    form.addEventListener("focusout", onFocusOut);
    form.addEventListener("change", onChange);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("focusout", onFocusOut);
      form.removeEventListener("change", onChange);
    };
  }, [action]);

  const left =
    minutes === null
      ? fill(copy.closesAt, { time: closesAt })
      : fill(pluralForm(minutes, { one: copy.minutesOne, other: copy.minutesOther }), {
          count: minutes,
          time: closesAt,
        });
  return (
    <div ref={ref} className="mt-1 text-sm text-muted" data-testid="counter-time-left">
      <span>{left}</span>
      {saved ? (
        <span role="status" className="ms-2">
          {copy.saved}
        </span>
      ) : null}
    </div>
  );
}
