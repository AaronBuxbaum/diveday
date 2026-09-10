import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";

/**
 * **What the world can see** — ADR 20260908-one-hand, decision 6, lever U,
 * frame 3.
 *
 * One row, one sentence, one switch. The sentence says exactly what leaves the
 * shop, because that is the only thing a shop owner is deciding here: a stage
 * word a crew member tapped and the time they tapped it. Off until they say
 * otherwise.
 *
 * There is no notice under it. The row's own value word is the answer — a
 * banner saying "saved" beneath a control that already reads **On** is a
 * sentence reassuring a reader about an outcome they can see.
 */
export function WorldPanel({
  action,
  on,
  copy,
}: {
  action: (formData: FormData) => Promise<void>;
  on: boolean;
  copy: {
    heading: string;
    rowHeading: string;
    detail: string;
    label: string;
    valueOn: string;
    valueOff: string;
    submit: string;
    submitting: string;
  };
}) {
  return (
    <InsetGroup as="h2" label={copy.heading} className="mt-10">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-base font-semibold">{copy.rowHeading}</h3>
          <p className="text-sm font-medium text-muted">{on ? copy.valueOn : copy.valueOff}</p>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">{copy.detail}</p>
        <FieldGrid as="form" action={action} columns={1} className="mt-4">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              name="publicBoatLine"
              type="checkbox"
              defaultChecked={on}
              className="size-4 accent-primary"
            />
            {copy.label}
          </label>
          <FieldActions>
            <SubmitButton
              pendingLabel={copy.submitting}
              className={buttonClass({ variant: "secondary" })}
            >
              {copy.submit}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </div>
    </InsetGroup>
  );
}
