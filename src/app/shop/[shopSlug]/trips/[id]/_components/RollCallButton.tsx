"use client";

import { type ReactNode, useActionState, useEffect, useSyncExternalStore } from "react";
import { NOTE_DRAFT_CHANGE_EVENT, pendingNoteDraft } from "@/lib/roll-call-note-draft";

/**
 * The result a roll-call server action returns instead of redirecting, so the
 * card can settle in place. `not_ready` is the server's fail-closed refusal —
 * readiness is re-checked on the server at board time and can always win.
 */
export type RollCallResult = { ok: true } | { ok: false; reason: "not_ready" | "error" } | null;

export type RollCallAction = (prev: RollCallResult, formData: FormData) => Promise<RollCallResult>;

/**
 * Every word this client component renders, resolved on the server — see the
 * note in src/i18n/staff-messages.ts. Pure text-source extraction: none of the
 * control flow, gating, or roll-call logic below changed.
 *
 * `blockedMessage` is pre-rendered JSX rather than a string: the "not ready"
 * refusal embeds one rich element (the "Open Guests" link to the specific
 * booking), and a translated sentence cannot correctly be reassembled here
 * from separate prefix/link/suffix string fragments — the composed-string
 * rule this codebase's i18n work follows. Passing already-rendered JSX
 * (built with `t.rich` in the Server Component caller) across the boundary is
 * fine; only a function/closure crossing it is not.
 */
export type RollCallButtonCopy = {
  errorRefusal: string;
  blockedMessage: ReactNode;
};

/**
 * A boarding control with an instant *pending* state. Tapping shows "Boarding…"
 * within a frame — never the confirmed ✓, which only ever appears when the
 * server re-renders this card as boarded. A server refusal rolls the card back
 * and shows the worded reason in place. This is the safety line for WP-6:
 * pending is a client hint; confirmed is server-authoritative.
 *
 * Before hydration the form still posts and the card settles from the server;
 * only the in-flight "Boarding…" hint needs the client.
 *
 * `result` lives in `useActionState`, which exposes no external setter to
 * clear it on demand. The checkpoint switcher (manifest/page.tsx's
 * `?checkpoint=` links, `scroll={false}`) reuses the same route/key across
 * checkpoints, so if `cacheComponents: true`'s Activity-based navigation is
 * ever re-enabled, a stale refusal from one checkpoint could otherwise
 * survive and misattribute to another (docs ADR
 * 20260801-cache-components-activity-state, currently reverted, commit
 * 100fcf8). The caller must render this with `key={checkpoint}` (or a key
 * that includes it) so switching checkpoints fully remounts the button —
 * and its `useActionState` — rather than carrying a prior checkpoint's
 * `result` forward.
 */
export function RollCallButton({
  action,
  subject,
  status,
  label,
  pendingLabel,
  ariaLabel,
  className,
  formClassName,
  noteDraftFor,
  copy,
}: {
  action: RollCallAction;
  /**
   * Who this result is about, as the hidden field the server action parses.
   * A booked diver is `bookingId`; an assigned crew member is `personId` —
   * two genuinely different subjects (a paid seat vs. a roster line), each
   * with its own `notNull` subject column and its own server action (ADR
   * 20260803-per-person-crew-roll-call).
   *
   * The subject is the *only* thing that differs, which is why this is one
   * generalized control rather than a near-copy: the instant pending label,
   * the confirm/refuse haptics, the `role="alert"` refusal, the pre-hydration
   * form post, and the remount-key contract below are all safety behaviour, and a
   * sibling component would be a second place for them to drift. The union
   * (rather than a bare field name) is what stops a caller typing
   * `"bookingid"` and posting a crew id into a diver action.
   */
  subject: { field: "bookingId"; id: string } | { field: "personId"; id: string };
  status: string;
  label: string;
  pendingLabel: string;
  /**
   * Overrides the accessible name while the visible `label` stays put — the
   * one case is a settled control with no done-check to point at nearby
   * (principle 7 carves out "Not back aboard" as the sole *visible* exception;
   * every other settled state, "Boarded ☑️" and its siblings, reads its own
   * re-tap affordance to a sighted user from the ☑️ and the row's own green
   * fill, neither of which reaches a screen reader). Undefined leaves the
   * accessible name as the rendered text, unchanged for every unrecorded and
   * pending state.
   */
  ariaLabel?: string;
  className: string;
  /**
   * Sizing for the `<form>` the button posts through. In the control
   * cluster's flex row the form — not the button — is the flex item, so the
   * "how much of the row does this control claim" classes have to land here
   * while `className` keeps styling the button itself.
   */
  formClassName?: string;
  /**
   * The row whose note draft this submit should carry, when it has one. See
   * `useUnsavedNote` below for why a button posts a note at all.
   */
  noteDraftFor?: { bookingId: string; checkpoint: string };
  copy: RollCallButtonCopy;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  const unsavedNote = useUnsavedNote(noteDraftFor);

  useEffect(() => {
    if (result) {
      if (typeof window !== "undefined" && "vibrate" in navigator) {
        try {
          if (result.ok) {
            navigator.vibrate(10);
          } else {
            navigator.vibrate([40, 40, 40]);
          }
        } catch {
          // Ignore vibration exceptions (e.g. from security policies)
        }
      }
    }
  }, [result]);
  return (
    <>
      <form action={formAction} className={formClassName}>
        <input type="hidden" name={subject.field} value={subject.id} />
        <input type="hidden" name="status" value={status} />
        {/* A note typed before anybody was called has nowhere to be saved:
            the note lives on the roll-call event row, and there isn't one yet
            (`updateLatestRollCallNote`, src/db/manifests.ts). So it rides the
            result that creates it — *either* result. It used to ride only the
            "not boarded" submit, through a `form=` attribute on the note
            input, which meant a note drafted while looking at a diver and then
            marking them **boarded** was silently dropped. A controlled hidden
            field on both buttons is also why this is `value=` rather than an
            imperative write in `onSubmit`: React builds the action's FormData
            from the DOM at submit time, and racing it is not a thing to do on
            the roll-call surface. */}
        {unsavedNote !== null ? <input type="hidden" name="note" value={unsavedNote} /> : null}
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          aria-label={isPending ? undefined : ariaLabel}
          className={className}
        >
          {isPending ? pendingLabel : label}
        </button>
      </form>
      {result && !result.ok ? (
        // `basis-full order-3`: the cluster is a flex-wrap row at every width
        // now, and its controls are visually ordered with `order-1`/`order-2`
        // — so a refusal drops to its own full-width line *below* both
        // controls instead of squeezing in as a third column or, at the
        // default order 0, jumping above them.
        <p role="alert" className="order-3 mt-1 basis-full text-sm font-medium text-danger">
          {result.reason === "not_ready" ? copy.blockedMessage : copy.errorRefusal}
        </p>
      ) : null}
    </>
  );
}

/**
 * This row's note text that the server has not acknowledged yet, or `null`.
 *
 * The note field mirrors every keystroke to the device (localStorage) as its
 * never-lost guarantee, and clears the mirror once the server confirms. That
 * makes the *pending* mirror exactly the set of notes a roll-call submit still
 * needs to carry — which is what the hidden field above posts.
 *
 * `useSyncExternalStore` rather than an effect: the value has to be correct in
 * the render that the submit reads its DOM from, and the store is a plain
 * `window` event because `storage` events fire only in *other* tabs.
 */
function useUnsavedNote(row: { bookingId: string; checkpoint: string } | undefined): string | null {
  return useSyncExternalStore(
    (onChange) => {
      if (!row) return () => {};
      window.addEventListener(NOTE_DRAFT_CHANGE_EVENT, onChange);
      return () => window.removeEventListener(NOTE_DRAFT_CHANGE_EVENT, onChange);
    },
    () => (row ? pendingNoteDraft(row.bookingId, row.checkpoint) : null),
    // Server render: no device, so nothing is pending. Matches the first
    // client render, so there is nothing to hydrate-mismatch on.
    () => null,
  );
}
