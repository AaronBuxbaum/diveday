"use client";

import { useState } from "react";
import { ErrorToast } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";
import type { PostcardImage } from "@/lib/postcard-image";
import { exportPostcard } from "./SavePostcard";

/**
 * **Save the booked ticket as a picture** (issue #4386), through the same
 * export the recap's postcard uses (`exportPostcard`): the share sheet on a
 * phone, a PNG download elsewhere. The picture holds the worded facts and no
 * link: this page's URL can cancel the booking, so what a diver sends a buddy
 * is an image (src/lib/postcard-image.ts).
 */
export function SaveTicket({
  postcard,
  fileName,
  copy,
}: {
  postcard: PostcardImage;
  fileName: string;
  copy: { save: string; saving: string; failed: string };
}) {
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");

  async function save() {
    setState("saving");
    try {
      await exportPostcard(postcard, fileName, { borrowMark: false });
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      {state === "failed" ? <ErrorToast message={copy.failed} /> : null}
      <button
        type="button"
        onClick={save}
        disabled={state === "saving"}
        aria-busy={state === "saving"}
        className={buttonClass({ variant: "secondary", size: "sm", busy: true })}
      >
        {state === "saving" ? copy.saving : copy.save}
      </button>
    </>
  );
}
