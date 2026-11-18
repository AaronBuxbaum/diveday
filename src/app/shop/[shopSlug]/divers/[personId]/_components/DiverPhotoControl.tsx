"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, useState } from "react";
import { useFormStatus } from "react-dom";
import { describeImageProblem, IMAGE_ACCEPT } from "@/components/ImageFileInput";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ErrorToast, Toast } from "@/components/Toast";

export type DiverPhotoCopy = {
  add: string;
  change: string;
  remove: string;
  adding: string;
  wrongTypeSuffix: string;
  tooBigSuffix: string;
  saved: string;
  error: string;
};

function PickButton({
  copy,
  hasPhoto,
  name,
  photoPath,
}: {
  copy: DiverPhotoCopy;
  hasPhoto: boolean;
  name: string;
  photoPath: string | null;
}) {
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
        className="inline-flex cursor-pointer rounded-full has-[:focus-visible]:focus-ring"
        title={hasPhoto ? copy.change : copy.add}
      >
        <PersonAvatar name={name} photoPath={photoPath} size="lg" />
        <input
          type="file"
          name="photo"
          accept={IMAGE_ACCEPT}
          disabled={pending}
          onChange={onChange}
          aria-label={hasPhoto ? copy.change : copy.add}
          className="sr-only"
        />
      </label>
      {error ? <ErrorToast message={error} /> : null}
    </>
  );
}

/**
 * The avatar opens the picker and uploads as soon as a photo is chosen.
 */
export function DiverPhotoControl({
  name,
  photoPath,
  action,
  copy,
}: {
  name: string;
  photoPath: string | null;
  action: (formData: FormData) => Promise<boolean>;
  copy: DiverPhotoCopy;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<"saved" | "error" | null>(null);
  return (
    <>
      <form
        action={async (data) => {
          try {
            const ok = await action(data);
            setOutcome(ok ? "saved" : "error");
            if (ok) router.refresh();
          } catch {
            setOutcome("error");
          }
        }}
      >
        <PickButton copy={copy} hasPhoto={Boolean(photoPath)} name={name} photoPath={photoPath} />
      </form>
      {outcome === "saved" ? (
        <Toast message={copy.saved} />
      ) : outcome === "error" ? (
        <ErrorToast message={copy.error} />
      ) : null}
    </>
  );
}
