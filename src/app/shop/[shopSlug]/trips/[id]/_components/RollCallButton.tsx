"use client";

import { type ReactNode, useActionState, useEffect, useRef } from "react";
import { vibrate } from "@/components/haptics";
import { controlClass } from "@/components/ui/form";

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
 * refusal embeds one rich element (the "Open Trip" link to the specific
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
  mark,
  pendingMark,
  className,
  formClassName,
  copy,
  noteField,
  observabilityAction,
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
  /**
   * A drawn glyph to render **instead of** the label's text — the roll-call
   * row's 56px circle (ADR 20260827-the-departure-is-two-working-surfaces,
   * decision 5: status is drawn, never typed as emoji).
   *
   * The words do not disappear when this is set, they move: `label` becomes the
   * button's accessible name, so a screen reader still hears "Mark boarded" and
   * "Aboard — tap again to undo" where a sighted user reads a check in a green
   * circle. That is the whole reason this is a prop on the same control rather
   * than a second component — the pending state, the confirm/refuse haptics,
   * the `role="alert"` refusal and the remount-key contract are safety
   * behaviour, and a mark-shaped copy of them is a copy that can drift.
   */
  mark?: ReactNode;
  /** The same, while this control's own submit is in flight. */
  pendingMark?: ReactNode;
  className: string;
  /**
   * Sizing for the `<form>` the button posts through. In the control
   * cluster's flex row the form — not the button — is the flex item, so the
   * "how much of the row does this control claim" classes have to land here
   * while `className` keeps styling the button itself.
   */
  formClassName?: string;
  copy: RollCallButtonCopy;
  /**
   * An optional sentence carried on the *same submit* as the tap
   * (ADR 20260828-a-missing-diver-gets-a-sentence): what the crew observed
   * about a person who is unaccounted for. Only the three controls that state
   * or unsay a missing person pass this, and the server keeps it only at an
   * after-dive checkpoint.
   *
   * Inside this form rather than beside it, which is the whole design: there is
   * no draft to mirror to the device, no second save to lose on a dropped
   * connection, and no way to edit what a crew recorded afterwards. The
   * apparatus that tried to do it the other way was deleted for good reason.
   */
  noteField?: { name: string; label: string; maxLength: number };
  /** Stable action label used by the app-wide mutation-duration reporter. */
  observabilityAction?: string;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  const startedAt = useRef<number | null>(null);
  const sawPending = useRef(false);

  useEffect(() => {
    if (isPending) {
      sawPending.current = true;
      if (startedAt.current === null) startedAt.current = performance.now();
      return;
    }
    if (!sawPending.current || startedAt.current === null) return;
    const durationMs = Math.max(0, performance.now() - startedAt.current);
    startedAt.current = null;
    sawPending.current = false;
    const actionName = observabilityAction ?? "roll-call";
    if (typeof window === "undefined" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(actionName)) return;
    window.dispatchEvent(
      new CustomEvent("diveday:mutation-settled", {
        detail: { action: actionName, durationMs },
      }),
    );
  }, [isPending, observabilityAction]);

  useEffect(() => {
    if (result) {
      // **Never the only carrier of a refusal.** The buzz is Android-only and
      // switchable off, so the `role="alert"` text below is what actually
      // tells a crew member the tap did not land (see @/components/haptics).
      vibrate(result.ok ? 10 : [40, 40, 40]);
    }
  }, [result]);
  return (
    <>
      <form action={formAction} className={formClassName}>
        <input type="hidden" name={subject.field} value={subject.id} />
        <input type="hidden" name="status" value={status} />
        {noteField ? (
          <p className="mb-2">
            <label htmlFor={`${noteField.name}-${subject.id}-${status}`} className="sr-only">
              {noteField.label}
            </label>
            <textarea
              id={`${noteField.name}-${subject.id}-${status}`}
              name={noteField.name}
              // The one attribute that tells this box apart from the private
              // staff note a row also carries, which posts under the same
              // field name to a different action.
              data-roll-call-note=""
              rows={2}
              maxLength={noteField.maxLength}
              placeholder={noteField.label}
              className={`${controlClass} text-base`}
            />
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          // With a drawn mark there is no visible text to be the accessible
          // name, so the words always have to be said here — including while
          // the submit is in flight, where a nameless button would otherwise
          // go silent at the one moment a reader is waiting to hear what
          // happened. Without a mark the rendered label *is* the name and this
          // stays what it was: unset unless a settled control has no visible
          // done-check to point at.
          aria-label={
            mark
              ? isPending
                ? pendingLabel
                : (ariaLabel ?? label)
              : isPending
                ? undefined
                : ariaLabel
          }
          className={className}
        >
          {mark ? (
            <span aria-hidden="true">{isPending ? (pendingMark ?? mark) : mark}</span>
          ) : isPending ? (
            pendingLabel
          ) : (
            label
          )}
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
