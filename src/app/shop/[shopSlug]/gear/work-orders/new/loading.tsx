import { sectionCardClass } from "@/components/ui/card";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";

/**
 * Form-shaped skeleton (design principle 1): the eyebrow and title, then the
 * two cards this form opens with — who the gear belongs to, and the search box
 * inside it.
 */
export default function NewWorkOrderLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div
          className={`mt-1 h-lh ${SHELL_TITLE_CLASS} w-64 max-w-full rounded bg-surface-sunken`}
        />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          <div className="h-lh w-40 rounded bg-surface-sunken" />
          <div className="mt-4 h-12 w-full max-w-sm rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
