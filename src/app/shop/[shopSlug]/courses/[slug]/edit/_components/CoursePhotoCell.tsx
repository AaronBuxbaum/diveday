import type { ReactNode } from "react";
import { RemovablePhoto } from "@/components/RemovablePhoto";
import { controlClass, Field } from "@/components/ui/form";

/**
 * One stored photo in the editor: the picture with its Remove tick, and the
 * box for its description straight under it. The cover photo and every
 * gallery photo are drawn by this, so the two never drift apart again.
 */
export function CoursePhotoCell({
  url,
  removeName,
  removeValue,
  removeLabel,
  altId,
  altName,
  alt,
  altLabel,
  altPlaceholder,
  children,
}: {
  url: string;
  removeName: string;
  removeValue?: string;
  removeLabel: string;
  altId: string;
  altName: string;
  alt: string;
  altLabel: string;
  altPlaceholder: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <RemovablePhoto url={url} name={removeName} value={removeValue} label={removeLabel} />
      {children}
      <Field label={altLabel} className="text-xs" htmlFor={altId}>
        <input
          id={altId}
          name={altName}
          type="text"
          maxLength={200}
          defaultValue={alt}
          placeholder={altPlaceholder}
          className={controlClass}
        />
      </Field>
    </div>
  );
}
