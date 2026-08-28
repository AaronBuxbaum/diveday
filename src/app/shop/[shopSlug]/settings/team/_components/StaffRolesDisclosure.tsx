"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FormStatus } from "@/components/ui/form";

export type StaffRoleOption = {
  /** The `STAFF_ROLES` value. */
  value: string;
  label: string;
  checked: boolean;
};

/**
 * One checkbox's field name. The wire format is the invite form's exactly —
 * `role_<role>` present and `"on"` — so both doors post through the same
 * `rolesFromFormData` reader in ./actions.ts.
 */
const inputName = (role: string) => `role_${role}`;

/** The same map back: `role_captain` is the box for `captain`. */
const roleOf = (name: string) => name.slice("role_".length);

/**
 * Reports the moment this row's save has settled — the action ran, the
 * redirect landed, and the props below are the server's answer to it.
 *
 * It exists because "a refusal reopens the row" cannot be read off the
 * `refusal` prop alone: refusing the same save twice hands back the *same*
 * string, so nothing in the props changes and no effect keyed on them fires.
 * `useFormStatus` sees the submission itself, which is the fact being waited
 * on. Must be rendered inside the `<form>` whose status it reads.
 */
function SaveSettled({ onSettled }: { onSettled: () => void }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    onSettled();
  }, [onSettled, pending]);
  return null;
}

/**
 * One teammate's roles, edited in place on their row and **saved when the row
 * closes** — ADR 20260827-the-shops-shelves, slice 9h. This component must not
 * drift from that record: it replaced a page-level "Save changes" that batched
 * every row's checkboxes into one submit, so the page carried two mental models
 * at once (immediate Enable/Disable/Delete, deferred roles) and a reader who
 * edited one row and walked away took nothing with them.
 *
 * The interaction contract, in full:
 *
 * - **Close saves.** The toggle, a click outside the row, or moving focus out
 *   of it all close the disclosure, and closing submits — but only when the
 *   checkboxes actually differ from what the server rendered. A peek that
 *   changes nothing writes nothing and claims nothing, because a "saved" line
 *   after a look is a lie the next reader has to unpick.
 * - **Escape aborts, from anywhere.** Every checkbox goes back to the roles
 *   this row was rendered with and the disclosure closes. Nothing is
 *   submitted. The listener is on the document for as long as the row is open,
 *   not on the fieldset: a row reopened by a refusal is opened
 *   programmatically, and a click on the panel's own padding blurs to
 *   `<body>` — in both the row is on screen with focus outside it, and an
 *   abort that answers only to focus would leave the way out unreachable while
 *   the next click elsewhere wrote the edit the reader was trying to abandon.
 * - **A refusal reopens, field-side.** The server sends the row's own
 *   `?notice=` back; the page passes it here as `refusal`, which renders in the
 *   panel beside the checkboxes it is about (`FormStatus` — the form-level half
 *   of the rule `Field`'s `error` prop is the field half; these refusals are
 *   about the whole group, never one box) and opens the disclosure. It is never
 *   a banner at the top of a roster of eleven people.
 * - **Undo is one re-save**, and exactly one. The page composes it and passes
 *   it as `footer` — an answer about the save that just happened, not a
 *   control on the panel — but it renders *inside* this row, because a close
 *   is a save and a sibling Undo button is somewhere else on the page: tabbing
 *   to it, or pressing it, would close-and-save the open row on the way and
 *   turn one tap into two writes.
 *
 * The form stays mounted whether the panel is open or shut — `hidden` on the
 * panel, never an unmount — so a close has live checkbox values to submit.
 */
export function StaffRolesDisclosure({
  personId,
  summary,
  legend,
  editLabel,
  options,
  action,
  refusal,
  footer,
}: {
  personId: string;
  /** The current roles as words — what the row reads at rest. */
  summary: string;
  /** Names the checkbox group for a screen reader. */
  legend: string;
  /** The toggle's accessible name; one roster row's roles read like another's. */
  editLabel: string;
  options: readonly StaffRoleOption[];
  action: (formData: FormData) => void;
  /** This row's refusal, already worded. Its presence is what reopens the row. */
  refusal?: string;
  /** The page's answer to the save that just landed, Undo included. */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(refusal));
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const panelId = useId();
  const refusalId = useId();

  /**
   * What the server rendered: the roles Escape reverts to, what a close
   * measures "did anything change?" against, and — posted as `baseline` — what
   * the action compares with the row's live state before writing, so a close
   * cannot silently revert somebody else's edit to the same person.
   */
  const saved = options
    .filter((option) => option.checked)
    .map((option) => option.value)
    .sort()
    .join(",");

  const checkboxes = useCallback(
    () => [...(formRef.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? [])],
    [],
  );

  const closeAndSave = useCallback(() => {
    if (!open) return;
    setOpen(false);
    const selected = checkboxes()
      .filter((box) => box.checked)
      .map((box) => roleOf(box.name))
      .sort()
      .join(",");
    if (selected !== saved) formRef.current?.requestSubmit();
  }, [checkboxes, open, saved]);

  const abort = useCallback(() => {
    if (!open) return;
    for (const box of checkboxes()) {
      box.checked = options.some(
        (option) => inputName(option.value) === box.name && option.checked,
      );
    }
    // The panel is about to be hidden, so anything focused inside it would take
    // focus to nowhere. Only when it *was* inside: an Escape pressed with focus
    // elsewhere on the page still closes this row, and stealing the cursor back
    // to it would be the rudest possible answer.
    const root = rootRef.current;
    if (root && document.activeElement instanceof Node && root.contains(document.activeElement)) {
      toggleRef.current?.focus();
    }
    setOpen(false);
  }, [checkboxes, open, options]);

  // A refusal that arrives while the row sits shut puts it back on screen with
  // the words beside the boxes. Two signals, because neither covers the other:
  // this one catches a refusal whose wording differs from the last render (and
  // the first render, where the page loaded straight into one), `SaveSettled`
  // catches the same refusal handed back twice.
  // Reopening is not enough on its own: the row that was refused was usually
  // closed by a click somewhere else, so focus is already off it and the
  // reader has no keyboard route back to the boxes the refusal is about. The
  // counter is what the focus effect below waits on — a bare flag could not
  // tell one refusal from the next, which is the same reason `SaveSettled`
  // exists.
  const [refusalCount, setRefusalCount] = useState(0);
  useEffect(() => {
    if (!refusal) return;
    setOpen(true);
    setRefusalCount((count) => count + 1);
  }, [refusal]);
  const refusalRef = useRef(refusal);
  refusalRef.current = refusal;
  const onSettled = useCallback(() => {
    if (!refusalRef.current) return;
    setOpen(true);
    setRefusalCount((count) => count + 1);
  }, []);
  // Separate from the two above because focus cannot be moved into a `hidden`
  // panel: this runs on the render that has already opened it.
  const focusedFor = useRef(0);
  useEffect(() => {
    if (!open || refusalCount === focusedFor.current) return;
    focusedFor.current = refusalCount;
    (checkboxes()[0] ?? toggleRef.current)?.focus();
  }, [checkboxes, open, refusalCount]);

  // Read through a ref by the document listener below: `abort` closes over
  // `options`, a fresh array on every render of the page, and a listener
  // re-subscribing on every render is a cost with no reader.
  const abortRef = useRef(abort);
  abortRef.current = abort;

  // A click anywhere else on the page is a close, and therefore a save. Bound
  // on `pointerdown` rather than `click` so the save is already in flight
  // before whatever was clicked navigates away with it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      closeAndSave();
    };
    // Escape belongs to the open row, not to whatever happens to hold focus:
    // a refusal reopens this panel programmatically, and a click on the
    // panel's own padding blurs to `<body>` — both leave the row open with
    // focus outside it, where a fieldset-scoped handler is unreachable and the
    // next click elsewhere would write the abandoned edit. The element-level
    // handlers below stay for the `stopPropagation` an ancestor listener (the
    // command palette) depends on.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") abortRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeAndSave, open]);

  // Escape and focus-leave ride the two elements that own a real role — the
  // toggle and the fieldset — rather than the wrapping <div>: a handler on a
  // static element is a control a screen reader cannot find.
  const onEscape = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    abort();
  };
  // Tabbing past the last checkbox leaves the row, which is a close like any
  // other — the keyboard's version of clicking elsewhere. A null
  // `relatedTarget` (a click landing on nothing focusable) is left to the
  // pointerdown listener above rather than guessed at here.
  const onFocusLeave = (event: React.FocusEvent) => {
    const next = event.relatedTarget;
    if (!next || rootRef.current?.contains(next)) return;
    closeAndSave();
  };

  return (
    <div ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={editLabel}
        onClick={() => (open ? closeAndSave() : setOpen(true))}
        onKeyDown={onEscape}
        onBlur={onFocusLeave}
        className="flex min-h-11 w-fit items-center gap-2 text-sm text-muted select-none hover:text-primary"
      >
        <DisclosureCaret className={open ? "rotate-90" : ""} />
        <span className="hover:underline">{summary}</span>
      </button>
      <form ref={formRef} action={action}>
        <SaveSettled onSettled={onSettled} />
        <input type="hidden" name="personId" value={personId} />
        {/* What this row was rendered with. The action refuses rather than
            writes when it no longer matches — see `saveStaffRolesAction`. */}
        <input type="hidden" name="baseline" value={saved} />
        <div id={panelId} hidden={!open} className="mt-2 flex flex-col gap-2">
          {/* Keyed on the server's answer so a save the reader did not make in
              these boxes — their own Undo, or a reload after somebody else's
              edit — remounts them. React assigns `defaultChecked` on mount and
              never again, so without the key an uncontrolled box keeps the
              value it was last clicked to and the row shows roles the shop no
              longer holds. A refusal leaves `saved` alone, which is the point:
              the boxes stay as the reader left them, ready to be corrected. */}
          {/* `aria-describedby` and not `aria-invalid`: ARIA 1.2 dropped
              `aria-invalid` from the global set, so on a fieldset's implicit
              `group` role it is an attribute axe refuses. The refusal is a
              `role="alert"`, announced as it arrives and named here, which is
              what a reader on this group actually needs. */}
          <fieldset
            key={saved}
            aria-describedby={refusal ? refusalId : undefined}
            onKeyDown={onEscape}
            onBlur={onFocusLeave}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            <legend className="sr-only">{legend}</legend>
            {options.map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"
              >
                <input
                  name={inputName(option.value)}
                  type="checkbox"
                  defaultChecked={option.checked}
                  className="size-4 accent-primary"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <FormStatus id={refusalId} tone="danger">
            {refusal}
          </FormStatus>
        </div>
      </form>
      {footer}
    </div>
  );
}
