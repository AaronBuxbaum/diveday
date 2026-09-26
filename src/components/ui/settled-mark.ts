/**
 * **The settle mark's geometry**, in a plain module so a Server Component can
 * read it: `SettledCheck.tsx` is a `"use client"` module, and every export of
 * one reaches the server as a client reference rather than as its value — a
 * class string imported from there would render as nothing.
 *
 * `SettledCheck` draws its mark at `SETTLED_MARK_SIZE` and sets its label
 * `SETTLED_MARK_GAP` after it, and those two are the only source of
 * `SETTLED_CHECK_TEXT_INSET`: the start a line hung under the label takes, so
 * it starts on the label's edge rather than on a hand-picked one. The thread's
 * steps hung their one-line fact at `ps-8`, 32px, under a name that starts at
 * 28, 4px right of it on every step (K-169). `SettledCheck.test.tsx` holds the
 * three together.
 */
export const SETTLED_MARK_SIZE = "size-5";

/** Between the mark and its label: 8px. */
export const SETTLED_MARK_GAP = "gap-2";

/** The mark's 20px plus the 8px gap: where the label's words start. */
export const SETTLED_CHECK_TEXT_INSET = "ps-7";
