import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { choiceClass, FieldActions, FieldGrid } from "@/components/ui/form";
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
 * **The checkbox wears the row's name.** It used to sit under an `<h3>` that
 * said "Where each boat is in its day" and carry a label that said "Say where
 * each boat is in its day" — the same fact, twice, a line apart. The control
 * is the row now, and the group's own `<h2>` above it is the heading.
 *
 * The value word on the right survives that cut and is not a third telling:
 * it is the **saved** state, server-rendered, while the checkbox beside it is
 * the *staged* one. An uncontrolled checkbox reads back whatever was last
 * clicked whether or not the write landed, which is why `follow-the-boat.spec`
 * asserts on this word and not on the box (check:e2e-hygiene's `action-race`).
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
    /** The row's name — and the checkbox's label, which is the same words. */
    rowHeading: string;
    detail: string;
    valueOn: string;
    valueOff: string;
    submit: string;
    submitting: string;
  };
}) {
  return (
    <InsetGroup as="h2" label={copy.heading} className="mt-10">
      <div className="p-4 sm:p-5">
        <FieldGrid as="form" action={action} columns={1}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
              <input
                name="publicBoatLine"
                type="checkbox"
                defaultChecked={on}
                className={choiceClass}
              />
              {copy.rowHeading}
            </label>
            <p className="text-sm font-medium text-muted">{on ? copy.valueOn : copy.valueOff}</p>
          </div>
          <p className="-mt-2 max-w-2xl text-sm text-muted">{copy.detail}</p>
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
