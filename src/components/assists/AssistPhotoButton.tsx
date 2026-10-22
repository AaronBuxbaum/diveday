"use client";

import { useId, useRef, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { fillFormFields } from "./fill-form";

/** A card is legible at this width; a phone's 4000px photo is twelve times the bytes. */
const MAX_EDGE_PX = 1600;

/** The photo, shrunk and re-encoded as JPEG in the browser, as base64 without its prefix. */
async function shrunkJpeg(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return url.split(",")[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * **Read a card photo into the form** (the `certscan` assist). The photo is
 * taken or picked, shrunk in the browser, sent once to the server action, and
 * dropped: the file input is cleared straight away and nothing keeps the
 * image. The answer fills the form's own boxes (agency, card, number), which
 * the person still reads and submits; an unreadable card fills nothing.
 */
export function AssistPhotoButton({
  read,
  label,
  pendingLabel,
  className,
}: {
  read: (image: { data: string; mediaType: string }) => Promise<Record<string, string> | null>;
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  function onChange() {
    const field = input.current;
    const file = field?.files?.[0];
    const form = button.current?.form ?? null;
    if (!field || !file) return;
    startTransition(async () => {
      const data = await shrunkJpeg(file);
      // The photo leaves the page with this request and nowhere else.
      field.value = "";
      if (!data) return;
      try {
        const values = await read({ data, mediaType: "image/jpeg" });
        if (values) fillFormFields(form, values);
      } catch {
        // A failed read is a dark assist: the boxes stay as they were.
      }
    });
  }

  return (
    <>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={onChange}
        disabled={pending}
        // Not part of what the form posts: the card is evidence by its number.
        form="__assist-photo-detached"
      />
      <button
        ref={button}
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        aria-busy={pending || undefined}
        className={buttonClass({ variant: "ghost", size: "sm", busy: pending, className })}
      >
        {pending ? pendingLabel : label}
      </button>
    </>
  );
}
