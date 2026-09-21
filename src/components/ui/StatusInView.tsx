"use client";

import { useEffect, useRef } from "react";
import { SCROLL_SETTLED_ATTRIBUTE } from "@/components/PreserveFormScroll";

/**
 * **Brings a form's outcome into view when it lands off-screen.**
 *
 * A section's outcome renders inside that section rather than in one banner
 * under the `<h1>` (ADR 20260827-people-not-lists' "edit in place"), which
 * fixed the original complaint: you saved a fit halfway down the diver record
 * and the confirmation appeared off-screen *above* you. It left the mirror
 * image open. `PreserveFormScroll` puts the reader back exactly where they
 * submitted from, and a status that renders below the submit button can land
 * below the fold — so the same save says nothing at all, from the other
 * direction.
 *
 * Measured on the diver record's gear group at 1280×720: the notice sat 26px
 * above the fold, and clearing the sticky bar for anchor landings
 * (`scroll-padding-top`, issue #1941) spent that margin and put it 30px below.
 * The margin was the only thing holding it, which is what makes this worth a
 * rule rather than a nudge.
 *
 * **It moves the page only when it has to.** A status already on screen is
 * left alone — an outcome that yanks the viewport when the reader can already
 * read it is worse than one that does nothing. `block: "nearest"` then scrolls
 * the minimum, and `scroll-padding-top` keeps the result clear of the bar.
 *
 * **It never steals focus.** `FieldErrorFocus` does that, deliberately and for
 * refusals only, because a refusal is a thing to fix and a confirmation is a
 * thing to read. This moves the viewport and nothing else.
 *
 * **Not for `danger`.** A refusal's own `FieldErrorFocus` scrolls the offending
 * control into view and focuses it, and two scrolls aimed at different
 * elements in the same frame is a page that jumps twice and settles wherever
 * the second one left it. The field is the better destination of the two — it
 * is what the reader has to act on — so a refusal is its business and this
 * stays out of the way.
 */
export function StatusInView() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const status = ref.current?.previousElementSibling;
    if (!(status instanceof HTMLElement)) return;

    // **Two things have to be true before this can measure anything**, and
    // both were found the expensive way.
    //
    // *The viewport has to be where it is going.* `PreserveFormScroll` restores
    // the submit-time position inside a `requestAnimationFrame`, and it does
    // not reliably run before this effect — measured on the diver record's gear
    // group, the status sat at viewport 138 when this check ran and at 748 once
    // the restore had happened, so the reveal correctly declined to move a page
    // it had been told was fine, and the confirmation stayed below the fold.
    // `SCROLL_SETTLED_ATTRIBUTE` is that component saying it has finished, in
    // every branch including the ones that move nothing — the same contract
    // `ScrollToHash` states with `data-hash-landed`. Waiting on the page's own
    // signal rather than on a count of frames is what keeps this from being a
    // timing guess.
    //
    // *The status has to be something the renderer is drawing.* One inside a
    // `<details>` that has just opened is in a subtree held at
    // `content-visibility: hidden` (`globals.css`, "the disclosure's body
    // arrives"), where `getBoundingClientRect` is all zeros and
    // `scrollIntoView` moves nothing at all — no scroll, no error, and a
    // confirmation still below the fold. `DiverFileGroupDisclosure` learned
    // that one the same way and left the note; `checkVisibility()` is the one
    // call that answers "would this be painted" for a skipped subtree as well
    // as for `display: none`.
    //
    // Bounded, so a page that never sends either signal cannot hold a frame
    // loop open for its own lifetime.
    let frame = 0;
    let framesWaited = 0;
    let lastY = Number.NaN;
    let stillFrames = 0;
    const revealOnceRendered = () => {
      const settled = document.documentElement.hasAttribute(SCROLL_SETTLED_ATTRIBUTE);
      const rendered =
        typeof status.checkVisibility === "function" ? status.checkVisibility() : true;
      // **And the page has to have stopped moving.** Three things scroll this
      // one in the same moment — the disclosure opening its group, the restore
      // above, and the browser's own smooth animation between them — so a
      // single measurement catches whatever offset the page was passing
      // through. Recorded on the diver record: the status read viewport 138
      // mid-flight and 748 once everything had landed, and 138 is a position
      // no reader ever sees. Two still frames is the page saying it is done,
      // which is a condition rather than a duration.
      stillFrames = window.scrollY === lastY ? stillFrames + 1 : 0;
      lastY = window.scrollY;
      if ((!settled || !rendered || stillFrames < 2) && framesWaited < 60) {
        framesWaited += 1;
        frame = window.requestAnimationFrame(revealOnceRendered);
        return;
      }
      const box = status.getBoundingClientRect();
      // The *usable* viewport, which starts below the sticky chrome bar —
      // `globals.css` names that inset once, and reading it here rather than
      // the bar's height keeps the two from disagreeing.
      const padding = Number.parseFloat(
        getComputedStyle(document.documentElement).scrollPaddingTop,
      );
      const top = Number.isFinite(padding) && padding > 0 ? padding : 0;
      const bottom = document.documentElement.clientHeight;
      if (box.top >= top && box.bottom <= bottom) return;

      status.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    frame = window.requestAnimationFrame(revealOnceRendered);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // A sibling rather than a child of the status: the status is a flex row with
  // a gap, and a child — even a `hidden` one — is a thing the next reader has
  // to check is not a flex item. `hidden` keeps it out of layout either way.
  return <span ref={ref} hidden />;
}
