import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { type GearRef, saveGearRequest } from "../actions";
import { RENTAL_GEAR_OPTIONS, type RentalProfile, type RentalRequest } from "./types";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

export function RentalGearForm({
  gearRef,
  rentalRequest,
  rentalProfile,
  saved,
}: {
  gearRef: GearRef;
  rentalRequest: RentalRequest;
  rentalProfile: RentalProfile;
  saved: boolean;
}) {
  return (
    <section className="mt-5 rounded-lg border border-border bg-surface/70 p-4 text-left">
      <h3 className="font-medium">Rental gear</h3>
      <p className="mt-1 text-sm text-muted">
        Tell the crew what you’d like to rent. We start with a typical set; they’ll confirm fit and
        weighting with you at the dock.
      </p>
      {saved ? (
        <p
          role="status"
          className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
        >
          Your gear request is with the crew — they’ll have it sized and packed before you arrive.
        </p>
      ) : null}
      <form action={saveGearRequest.bind(null, gearRef)} className="mt-4 flex flex-col gap-4">
        <fieldset>
          <legend className="text-sm font-medium">What should we plan to have ready?</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {RENTAL_GEAR_OPTIONS.map(({ name, label }) => {
              const requested = rentalRequest?.[name];
              const defaultChecked = requested ?? name !== "diveComputer";
              return (
                <label
                  key={name}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                >
                  <input
                    name={name}
                    type="checkbox"
                    defaultChecked={defaultChecked}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <FieldGrid columns={2}>
          <Field label="BCD size">
            <select
              name="bcdSize"
              defaultValue={rentalRequest?.bcdSize ?? rentalProfile?.bcdSize ?? ""}
              className={controlClass}
            >
              <option value="">Not sure — help me fit it</option>
              {SIZES.map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </Field>
          <Field label="Wetsuit size">
            <select
              name="wetsuitSize"
              defaultValue={rentalRequest?.wetsuitSize ?? rentalProfile?.wetsuitSize ?? ""}
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
              defaultValue={rentalRequest?.bootSize ?? rentalProfile?.bootSize ?? ""}
              placeholder="US 9 / EU 42"
              className={controlClass}
            />
          </Field>
          <Field label="Buddy or group notes" hint="(optional)">
            <textarea
              name="buddyPreference"
              rows={2}
              maxLength={300}
              placeholder="I’m travelling with Maya; we’d love a relaxed photo pace."
              className={controlClass}
            />
          </Field>
          <Field label="Fin size" hint="(optional)">
            <input
              name="finSize"
              maxLength={20}
              defaultValue={rentalRequest?.finSize ?? rentalProfile?.finSize ?? ""}
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
              defaultValue={
                rentalRequest?.weightPreference ?? rentalProfile?.weightPreference ?? ""
              }
              placeholder="e.g. 16 lb with a 3 mm suit"
              className={controlClass}
            />
          </Field>
          <Field label="Anything else the crew should know?" hint="(optional)">
            <textarea
              name="note"
              rows={2}
              maxLength={300}
              defaultValue={rentalRequest?.note ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel="Saving gear…"
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "px-4 text-foreground",
            })}
          >
            Save gear request
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
