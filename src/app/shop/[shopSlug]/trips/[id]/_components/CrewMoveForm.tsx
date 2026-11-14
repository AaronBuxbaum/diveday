import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";

/**
 * **Move a crew member to another boat that day** (issue #4474): one form, one
 * write (`moveTripCrewAction`), so they are never on neither boat or on both.
 * Presentation only; the action refuses a clash or a roll-call history.
 */
export function CrewMoveForm({
  tripId,
  crew,
  targets,
  action,
  copy,
}: {
  tripId: string;
  crew: readonly { id: string; fullName: string }[];
  /** Already worded: the boat's time in the shop's zone, then its title. */
  targets: readonly { id: string; label: string }[];
  action: (formData: FormData) => Promise<void>;
  copy: {
    trigger: string;
    who: string;
    to: string;
    choose: string;
    submit: string;
    pending: string;
  };
}) {
  if (crew.length === 0 || targets.length === 0) return null;
  return (
    <details className="group/crew-move">
      <summary
        className={buttonClass({
          variant: "link",
          size: "sm",
          flush: true,
          className: "list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {copy.trigger}
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={copy.who} htmlFor={`crew-move-who-${tripId}`}>
          <select
            id={`crew-move-who-${tripId}`}
            name="personId"
            required
            defaultValue=""
            className={controlClass}
          >
            <option value="">{copy.choose}</option>
            {crew.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy.to} htmlFor={`crew-move-to-${tripId}`}>
          <select
            id={`crew-move-to-${tripId}`}
            name="toTripId"
            required
            defaultValue=""
            className={controlClass}
          >
            <option value="">{copy.choose}</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </Field>
        <SubmitButton
          pendingLabel={copy.pending}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "self-start sm:self-end",
          })}
        >
          {copy.submit}
        </SubmitButton>
      </form>
    </details>
  );
}
