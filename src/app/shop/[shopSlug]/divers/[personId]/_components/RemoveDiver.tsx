import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { deletePersonAction } from "../actions";
import type { DiverProfile } from "./shared";

export function RemoveDiver({
  diver,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
}) {
  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="remove-heading">
      <h2 id="remove-heading" className="text-lg font-semibold">
        Remove from active divers
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        This is a soft delete: the person disappears from active shop lists, while bookings, cards,
        and gear history remain intact for records and safety review.
      </p>
      <details className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-4">
        <summary className="flex min-h-11 cursor-pointer items-center py-2 text-sm font-medium text-danger">
          Remove {diver.person.fullName}
        </summary>
        <form
          action={deletePersonAction.bind(null, shopSlug, personId)}
          className="mt-3 flex flex-wrap items-center gap-3"
        >
          <p className="text-sm text-muted">You can add them again later as a new active record.</p>
          <SubmitButton
            pendingLabel="Removing…"
            className={buttonClass({ variant: "danger-solid" })}
          >
            Remove diver
          </SubmitButton>
        </form>
      </details>
    </section>
  );
}
