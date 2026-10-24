import { sectionCardClass } from "@/components/ui/card";

/**
 * The long-form editors' body while they load (visual review 2026-10-24,
 * A11): the sections that open, each a label over two fields on a hairline,
 * then the closed ones as rows of one card, then the sticky Save. Shared by
 * the dive-site and course editors, whose loaded pages draw the same shape,
 * so the streamed form lands where the bars stood.
 */
export function EditorFormSkeleton({ open, closed }: { open: number; closed: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-editor-form-skeleton="">
      {Array.from({ length: open }, (_, section) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed run of placeholders, never reordered.
          key={section}
          data-open-section-stub=""
          className={section === 0 ? "" : "border-t border-border pt-6"}
        >
          <div className="h-3 w-32 rounded bg-surface-sunken" />
          <div className="mt-4 flex flex-col gap-5">
            {[0, 1].map((field) => (
              <div key={field}>
                <div className="h-4 w-28 rounded bg-surface-sunken" />
                <div className="mt-2 h-12 rounded-lg bg-surface-sunken" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div
        className={sectionCardClass({
          padding: "none",
          className: "divide-y divide-border overflow-hidden",
        })}
      >
        {Array.from({ length: closed }, (_, row) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed run of placeholders, never reordered.
            key={row}
            data-closed-section-stub=""
            className="flex min-h-14 items-center px-4 py-4 sm:px-5"
          >
            <div className="h-4 w-40 rounded bg-surface-sunken" />
          </div>
        ))}
      </div>
      {/* The one Save, in its sticky row. */}
      <div className="border-t border-border pt-3">
        <div className="h-11 w-24 rounded-lg bg-surface-sunken" />
      </div>
    </div>
  );
}
