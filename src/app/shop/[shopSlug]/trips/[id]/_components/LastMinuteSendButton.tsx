"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

/**
 * The recipient checkboxes live in a server-rendered form, but the send
 * button must reflect the staffer's current selection before that form is
 * submitted. Listen to the form's native change event so the count updates
 * without turning the whole deal panel into a client component.
 */
export function LastMinuteSendButton({
  initialCount,
  singularLabel,
  pluralLabel,
  pendingLabel,
}: {
  initialCount: number;
  singularLabel: string;
  pluralLabel: string;
  pendingLabel: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form) return;
    const update = () => {
      setCount(
        form.querySelectorAll<HTMLInputElement>('input[name="recipientPersonIds"]:checked').length,
      );
    };
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, []);

  return (
    <span ref={containerRef}>
      <SubmitButton
        pendingLabel={pendingLabel}
        className={buttonClass({ className: "px-5 py-2.5" })}
      >
        {(count === 1 ? singularLabel : pluralLabel).replace(/\d+/, String(count))}
      </SubmitButton>
    </span>
  );
}
