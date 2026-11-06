// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { RowMenu } from "@/components/RowMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { menuRowClass } from "@/components/ui/menu";

/**
 * **The two acts nobody wants by accident, behind one "⋯"**: download the
 * record, and delete the diver. They used to stand in the header and the foot
 * of every record; a staffer opening a diver to book or take a payment never
 * needs either, so they sit one tap away (Aaron, 2026-11-05).
 *
 * Delete still asks before it posts, and the question is the sentence that
 * used to sit under the old disclosure: what comes off the lists, what stays on
 * file, that it can be restored, and, for someone who also works here, that
 * they leave the team. Erasure is not here: it lives on the deleted record
 * (ADR 20260802-diver-data-erasure).
 */
export function DiverRecordMenu({
  label,
  download,
  remove,
}: {
  /** The "⋯" button's accessible name. */
  label: string;
  /** "Download record"; absent for a reader who may not export. */
  download?: { href: string; label: string };
  /** "Delete diver"; absent for a reader who may not delete, and on a deleted record. */
  remove?: {
    action: (formData: FormData) => Promise<void>;
    label: string;
    pendingLabel: string;
    confirmMessage: string;
  };
}) {
  if (!download && !remove) return null;
  return (
    <RowMenu label={label} panelClassName="w-56">
      {(close) => (
        <>
          {download ? (
            <a
              href={download.href}
              download
              onClick={close}
              className={menuRowClass("quiet", { gutter: false })}
            >
              {download.label}
            </a>
          ) : null}
          {remove ? (
            <form action={remove.action}>
              <SubmitButton
                pendingLabel={remove.pendingLabel}
                confirmMessage={remove.confirmMessage}
                className={menuRowClass("danger", { gutter: false })}
              >
                {remove.label}
              </SubmitButton>
            </form>
          ) : null}
        </>
      )}
    </RowMenu>
  );
}
