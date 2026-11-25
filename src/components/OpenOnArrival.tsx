"use client";

import { useEffect, useRef } from "react";

/**
 * Submits the form it sits in as soon as the page runs in a browser, so a
 * prospect who taps the link lands in their preview without a second tap
 * (ADR 20261116-demo-previews; a diver's sign-in link, ADR 20261125-diver-sign-in). A client that never runs the page (most mail
 * scanners) stops at the fetch, which is counted as a fetch and nothing more.
 * The button beside it is the same door for anyone this does not fire for.
 */
export function OpenOnArrival() {
  const marker = useRef<HTMLSpanElement>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    marker.current?.closest("form")?.requestSubmit();
  }, []);
  return <span ref={marker} hidden />;
}
