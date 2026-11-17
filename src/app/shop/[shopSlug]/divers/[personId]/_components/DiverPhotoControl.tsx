"use client";

import { type ChangeEvent, useState } from "react";
import { useFormStatus } from "react-dom";
import { describeImageProblem, IMAGE_ACCEPT } from "@/components/ImageFileInput";
import { PersonAvatar } from "@/components/PersonAvatar";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorToast } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";

export type DiverPhotoCopy = {
  add: string;
  change: string;
  remove: string;
  adding: string;
  wrongTypeSuffix: string;
  tooBigSuffix: string;
};

function PickButton({ copy, hasPhoto }: { copy: DiverPhotoCopy; hasPhoto: boolean }) {
  const { pending } = useFormStatus();
  const [error, setError] = useState<string | null>(null);
  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const problem = describeImageProblem(files, undefined, copy);
    if (problem) {
      input.value = "";
      setError(problem);
      return;
    }
    setError(null);
    input.form?.requestSubmit();
  }
  return (
    <>
      <label
        className={`${buttonClass({ variant: "secondary", size: "sm" })} has-[:focus-visible]:focus-ring ${
          pending ? "cursor-progress" : "cursor-pointer"
        }`}
      >
        <span aria-live="polite">{pending ? copy.adding : hasPhoto ? copy.change : copy.add}</span>
        <input
          type="file"
          name="photo"
          accept={IMAGE_ACCEPT}
          disabled={pending}
          onChange={onChange}
          className="sr-only"
        />
      </label>
      {error ? <ErrorToast message={error} /> : null}
    </>
  );
}

/**
 * The diver's picture on their record: their face (or initials), one button to
 * add or change it that uploads the moment a photo is picked, and a quiet
 * remove link once there is one.
 */
export function DiverPhotoControl({
  name,
  photoPath,
  action,
  copy,
}: {
  name: string;
  photoPath: string | null;
  action: (formData: FormData) => Promise<void>;
  copy: DiverPhotoCopy;
}) {
  return (
    <div className="flex items-center gap-3">
      <PersonAvatar name={name} photoPath={photoPath} size="lg" />
      <div className="flex flex-wrap items-center gap-2">
        <form action={action}>
          <PickButton copy={copy} hasPhoto={Boolean(photoPath)} />
        </form>
        {photoPath ? (
          <form action={action}>
            <input type="hidden" name="remove" value="1" />
            <SubmitButton
              pendingLabel={copy.adding}
              className={buttonClass({ variant: "link", size: "sm" })}
            >
              {copy.remove}
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
