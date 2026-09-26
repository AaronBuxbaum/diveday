"use client";

import { type ComponentPropsWithRef, useCallback, useEffect, useRef, useState } from "react";

function holds(value: ComponentPropsWithRef<"input">["value"]): boolean {
  return value !== undefined && value !== null && String(value) !== "";
}

/**
 * **The `<input>` a `DateField` draws, and whether it is empty.**
 *
 * A date, month, time or date-and-time box never matches `::placeholder`, so
 * an empty one drew the platform's mask (`mm/dd/yyyy`, `--:-- --`) in the
 * input's own ink: `#1d1d1f`, the colour of a filled answer, where every real
 * placeholder on the same form is the muted `#88888c` (the pixel probe,
 * schedule-off-season and took-a-call). Nothing in CSS can tell an empty
 * temporal box from a filled one, so this says so itself — `data-empty`
 * while it holds no value — and `globals.css` paints the mask in the
 * placeholder's colour beside the `::placeholder` rule.
 *
 * It is the one piece of `DateField` that runs in the browser, which is why
 * it is its own module: `form.tsx` renders on the server as often as not.
 * The attribute is right on the server's first paint (from `value` or
 * `defaultValue`), follows every `input` event — typing, the picker, and a
 * restored draft, since `applyFormFields` and the course editor's guard both
 * dispatch one — and follows a form reset. A controlled box reads its
 * `value` prop instead. Everything else passes through untouched, a callback
 * `ref` included.
 *
 * **A half-typed box is not an empty one.** The value stays "" until every
 * segment is filled, so "09/dd/yyyy" still said `data-empty` and the typed
 * "09" drew in the placeholder's grey. The stylesheet leaves a focused box's
 * mask in the ink, and a box left half-typed (`validity.badInput`) stops
 * saying it is empty when the person leaves it.
 *
 * **A box the browser does not have says so.** Safari and Firefox on a desk
 * have no month control and draw `type="month"` as a text box, which reads
 * its type back as `text`: the box marks itself `data-fallback`, and
 * `DateField` drops the calendar glyph that would promise a picker there.
 */
export function DateInput({
  type,
  value,
  defaultValue,
  onInput,
  onBlur,
  ref,
  ...input
}: ComponentPropsWithRef<"input">) {
  const own = useRef<HTMLInputElement | null>(null);
  const [filled, setFilled] = useState(() => holds(value ?? defaultValue));
  const [halfTyped, setHalfTyped] = useState(false);
  const [fallback, setFallback] = useState(false);
  // One ref for as long as the caller's is the same one. A fresh callback on
  // every render would detach and re-attach the caller's ref each time this
  // re-renders — and the schedule builder's ref focuses the box, so every
  // keystroke would focus it again, and so would any render after a staffer
  // had moved on.
  const setRef = useCallback(
    (node: HTMLInputElement | null) => {
      own.current = node;
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    },
    [ref],
  );

  // A reset puts the default back without an `input` event; read the box
  // once the reset has landed.
  useEffect(() => {
    const form = own.current?.form;
    if (!form) return;
    const onReset = () => {
      setHalfTyped(false);
      setTimeout(() => setFilled(holds(own.current?.value)), 0);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  // Read once the box is in the document: an unknown type reads back `text`.
  useEffect(() => {
    setFallback(Boolean(type) && own.current !== null && own.current.type !== type);
  }, [type]);

  const empty = (value !== undefined ? !holds(value) : !filled) && !halfTyped;
  return (
    <input
      {...input}
      type={type}
      ref={setRef}
      value={value}
      defaultValue={defaultValue}
      data-empty={empty ? "" : undefined}
      data-fallback={fallback ? "" : undefined}
      onInput={(event) => {
        setFilled(event.currentTarget.value !== "");
        setHalfTyped(false);
        onInput?.(event);
      }}
      onBlur={(event) => {
        const box = event.currentTarget;
        setHalfTyped(box.value === "" && box.validity.badInput);
        onBlur?.(event);
      }}
    />
  );
}
