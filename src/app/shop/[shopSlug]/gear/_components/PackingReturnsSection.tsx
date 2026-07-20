import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { returnAction } from "../actions";
import type { GearAssignment } from "./types";

export function PackingReturnsSection({ assignments }: { assignments: GearAssignment[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Packing & returns</h2>
      {assignments.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Everything is back in the room.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {assignments.map(({ assignment, item, person, trip }) => (
            <li key={assignment.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <strong>{item.label}</strong> · {person.fullName}
                <span className="block text-sm text-muted">{trip.title}</span>
              </span>
              <form action={returnAction}>
                <input type="hidden" name="id" value={assignment.id} />
                <SubmitButton
                  pendingLabel="Returning…"
                  className={buttonClass({
                    variant: "secondary",
                    size: "sm",
                    className: "text-foreground",
                  })}
                >
                  Return gear
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
