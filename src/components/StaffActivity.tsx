"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { useFocusTrap } from "@/components/useFocusTrap";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";

const INPUT_GAP_MS = 10_000;

/** Input renews only this session. Background reads never do. */
export function StaffActivity({
  sessionId,
  copy,
}: {
  sessionId: string;
  copy: { title: string; body: string; retry: string; signIn: string };
}) {
  const [locked, setLocked] = useState(false);
  const [checkState, setCheckState] = useState<"pending" | "settled">("pending");
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(locked, dialogRef);

  useEffect(() => {
    let stopped = false;
    let isLocked = false;
    let timer: ReturnType<typeof setTimeout>;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let lastSent = Number.NEGATIVE_INFINITY;
    let inFlight: Promise<void> | undefined;
    let generation = 0;
    const root = document.createElement("div");
    document.body.append(root);
    setPortal(root);
    const previousInert = new Map<HTMLElement, boolean>();
    const coverBody = () => {
      for (const child of document.body.children) {
        if (!(child instanceof HTMLElement) || child === root) continue;
        if (!previousInert.has(child)) previousInert.set(child, child.inert);
        child.inert = true;
      }
      // Other dialogs share z-50. Put the lock after every existing portal and
      // keep it last if another portal is mounted while the page is locked.
      if (document.body.lastElementChild !== root) document.body.append(root);
    };
    const observer = new MutationObserver(() => {
      if (isLocked) coverBody();
    });
    observer.observe(document.body, { childList: true });
    const lock = (value: boolean) => {
      if (stopped) return;
      isLocked = value;
      if (value) coverBody();
      else {
        for (const [element, wasInert] of previousInert) element.inert = wasInert;
        previousInert.clear();
      }
      setLocked(value);
    };
    const headers = { "x-staff-session": sessionId };
    const schedule = (remainingMs: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void check(), Math.max(0, remainingMs));
    };
    const check = async () => {
      const version = ++generation;
      setCheckState("pending");
      lock(true);
      try {
        await inFlight;
        if (stopped || version !== generation) return;
        const started = performance.now();
        const response = await fetch("/api/staff-activity", { headers, cache: "no-store" });
        if (stopped || version !== generation) return;
        if (!response.ok) return;
        const body: { remainingMs?: unknown } = await response.json();
        if (stopped || version !== generation) return;
        if (
          typeof body.remainingMs !== "number" ||
          !Number.isFinite(body.remainingMs) ||
          body.remainingMs <= 0
        )
          return;
        const remaining = body.remainingMs - (performance.now() - started);
        if (remaining <= 0) return;
        lock(false);
        schedule(remaining);
      } catch {
        // Keep the page covered when the server cannot confirm the session.
        // The separately saved offline manifest and unsent roll call are untouched.
      } finally {
        if (!stopped && version === generation) setCheckState("settled");
      }
    };
    const send = () => {
      if (!pending || stopped || isLocked) return;
      pending = false;
      lastSent = performance.now();
      const started = lastSent;
      const version = generation;
      inFlight = fetch("/api/staff-activity", { method: "POST", headers, keepalive: true })
        .then((response) => {
          if (stopped) return;
          if (response.status === 401) {
            generation++;
            lock(true);
            setCheckState("settled");
          } else if (response.ok && version === generation)
            schedule(Math.max(0, STAFF_IDLE_LIMIT_MS - (performance.now() - started)));
        })
        .catch(() => {});
    };
    const input = (event: Event) => {
      if (!event.isTrusted || isLocked) return;
      pending = true;
      const wait = Math.max(0, INPUT_GAP_MS - (performance.now() - lastSent));
      if (wait === 0) send();
      else if (!trailing)
        trailing = setTimeout(() => {
          trailing = undefined;
          send();
        }, wait);
    };
    const flush = () => {
      if (trailing) clearTimeout(trailing);
      trailing = undefined;
      send();
    };
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("pointerdown", input, true);
    document.addEventListener("keydown", input, true);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", flush);
    setRetry(() => () => void check());
    // Hydration may happen long after the server rendered the page. Confirm
    // the live session before exposing its content and use a conservative
    // request-start clock for every subsequent deadline.
    void check();
    return () => {
      flush();
      stopped = true;
      observer.disconnect();
      for (const [element, wasInert] of previousInert) element.inert = wasInert;
      root.remove();
      clearTimeout(timer);
      if (trailing) clearTimeout(trailing);
      document.removeEventListener("pointerdown", input, true);
      document.removeEventListener("keydown", input, true);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pagehide", flush);
    };
  }, [sessionId]);

  const dialog =
    locked && portal
      ? createPortal(
          <div
            ref={dialogRef}
            className="fixed inset-0 z-50 grid place-items-center bg-surface p-6"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="staff-session-title"
            aria-describedby="staff-session-description"
            tabIndex={-1}
          >
            <div className="space-y-4 text-center">
              <h1 id="staff-session-title" className={SECTION_TITLE_CLASS}>
                {copy.title}
              </h1>
              <p id="staff-session-description">{copy.body}</p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  className={buttonClass({ variant: "secondary" })}
                  onClick={() => retry?.()}
                >
                  {copy.retry}
                </button>
                <a className={buttonClass()} href="/sign-in?session=ended">
                  {copy.signIn}
                </a>
              </div>
            </div>
          </div>,
          portal,
        )
      : null;
  return (
    <>
      <span hidden data-staff-session-check={checkState} />
      {dialog}
    </>
  );
}
