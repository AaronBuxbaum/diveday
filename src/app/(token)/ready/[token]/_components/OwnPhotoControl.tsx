"use client";

import { useActionState } from "react";
import { ImageFileInput } from "@/components/ImageFileInput";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { OwnPhotoState } from "../person-photo-actions";

export type OwnPhotoWords = {
  choose: string;
  chooseAnother: string;
  upload: string;
  uploading: string;
  remove: string;
  saved: string;
  failed: string;
  rateLimited: string;
  wrongTypeSuffix: string;
  tooBigSuffix: string;
};

export function OwnPhotoControl({
  photoUrl,
  hasPhoto,
  action,
  words,
}: {
  photoUrl: string | null;
  hasPhoto: boolean;
  action: (previous: OwnPhotoState, data: FormData) => Promise<OwnPhotoState>;
  words: OwnPhotoWords;
}) {
  const [state, formAction] = useActionState(action, { outcome: null });
  const message =
    state.outcome === "saved"
      ? words.saved
      : state.outcome === "rate_limited"
        ? words.rateLimited
        : state.outcome
          ? words.failed
          : null;
  return (
    <form action={formAction} className="mt-4 space-y-3">
      {photoUrl ? (
        // The capability-scoped route checks every request; the shared image optimizer cannot.
        // biome-ignore lint/performance/noImgElement: the capability must reach the authenticated route without a shared optimizer.
        <img
          src={photoUrl}
          alt=""
          className="size-24 rounded-full border border-border object-cover"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <ImageFileInput name="photo" shape="logo" copy={words} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel={words.uploading}
          className={buttonClass({ variant: "secondary" })}
        >
          {words.upload}
        </SubmitButton>
        {hasPhoto ? (
          <SubmitButton
            name="remove"
            value="1"
            pendingLabel={words.uploading}
            className={buttonClass({ variant: "link" })}
          >
            {words.remove}
          </SubmitButton>
        ) : null}
      </div>
      <FormStatus tone={state.outcome === "saved" ? "success" : "danger"}>{message}</FormStatus>
    </form>
  );
}
