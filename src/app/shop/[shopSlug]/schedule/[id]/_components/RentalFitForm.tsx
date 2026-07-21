import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { RENTAL_FIT_OPTIONS, type RentalFit } from "./types";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

/**
 * The diver's rental-fit capture, reused by the booking confirmation and the
 * `/ready` page. The submit target is passed in as `action` so each surface
 * binds its own (page-scoped or token-scoped) server action.
 */
export function RentalFitForm({
  action,
  rentalFit,
  wantsNitrox,
  nitroxCardVerified,
  plannedDives,
  saved,
}: {
  action: (formData: FormData) => void;
  rentalFit: RentalFit;
  wantsNitrox: boolean;
  nitroxCardVerified: boolean;
  plannedDives: number;
  saved: boolean;
}) {
  return (
    <section className="mt-5 rounded-lg border border-border bg-surface/70 p-4 text-left">
      <h3 className="font-medium">Rental fit</h3>
      <p className="mt-1 text-sm text-muted">
        Tell the crew what you’d like to rent and roughly what size. We keep it on file for next
        time, and they’ll confirm fit and weighting with you at the dock.
      </p>
      {saved ? (
        <p
          role="status"
          className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
        >
          Saved. The crew will see this when they pack, and check the fit with you at the dock.
        </p>
      ) : null}
      <form action={action} className="mt-4 flex flex-col gap-4">
        <fieldset>
          <legend className="text-sm font-medium">What should we plan to have ready?</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {RENTAL_FIT_OPTIONS.map(({ name, field, label }) => (
              <label
                key={name}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
              >
                <input
                  name={name}
                  type="checkbox"
                  defaultChecked={rentalFit?.[field] ?? true}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">
            We plan one tank per dive, so {plannedDives} {plannedDives === 1 ? "tank" : "tanks"} for
            this trip. Ask the shop what’s included in the trip price.
          </p>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Enriched air (nitrox)</legend>
          {nitroxCardVerified ? (
            <label className="mt-2 flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm">
              <input
                name="nitrox"
                type="checkbox"
                defaultChecked={wantsNitrox}
                className="size-4 accent-primary"
              />
              Fill my tanks with nitrox — charged per dive
            </label>
          ) : (
            <p className="mt-2 rounded-lg border border-border px-3 py-2 text-sm text-muted">
              Enriched air needs a verified nitrox card on file with the shop. Bring yours to the
              counter and they’ll add it — then you can request nitrox here.
            </p>
          )}
          {nitroxCardVerified ? (
            <p className="mt-2 text-sm text-muted">
              You’ll analyze your own tanks and sign for the mix at the fill station, as always.
            </p>
          ) : null}
        </fieldset>

        <FieldGrid columns={2}>
          <Field label="BCD size">
            <select name="bcdSize" defaultValue={rentalFit?.bcdSize ?? ""} className={controlClass}>
              <option value="">Not sure — help me fit it</option>
              {SIZES.map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </Field>
          <Field label="Wetsuit size">
            <select
              name="wetsuitSize"
              defaultValue={rentalFit?.wetsuitSize ?? ""}
              className={controlClass}
            >
              <option value="">Not sure — help me fit it</option>
              {SIZES.map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </Field>
          <Field label="Boot size" hint="(optional)">
            <input
              name="bootSize"
              maxLength={20}
              defaultValue={rentalFit?.bootSize ?? ""}
              placeholder="US 9 / EU 42"
              className={controlClass}
            />
          </Field>
          <Field label="Fin size" hint="(optional)">
            <input
              name="finSize"
              maxLength={20}
              defaultValue={rentalFit?.finSize ?? ""}
              placeholder="M/L"
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={1}>
          <Field label="Usual weight setup" hint="(optional)">
            <input
              name="weightPreference"
              maxLength={80}
              defaultValue={rentalFit?.weightPreference ?? ""}
              placeholder="e.g. 16 lb with a 3 mm suit"
              className={controlClass}
            />
          </Field>
          <Field label="Anything else the crew should know?" hint="(optional)">
            <textarea
              name="note"
              rows={2}
              maxLength={300}
              defaultValue={rentalFit?.note ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel="Saving fit…"
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "px-4 text-foreground",
            })}
          >
            Save rental fit
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
