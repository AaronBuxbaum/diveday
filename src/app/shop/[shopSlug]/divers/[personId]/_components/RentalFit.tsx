import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { offeredRentableItems } from "@/lib/rentals";
import { saveProfileAction } from "../actions";
import type { DiverProfile } from "./shared";

export function RentalFit({
  diver,
  shopSlug,
  personId,
  rentalItems,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  rentalItems: string[];
}) {
  const profile = diver.rentalFit;
  const offered = offeredRentableItems(rentalItems);
  const offers = new Set(offered.map((item) => item.kind));
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="rental-fit-heading">
      <div>
        <h2 id="rental-fit-heading" className="text-lg font-semibold">
          Rental fit
        </h2>
        <p className="mt-1 text-sm text-muted">
          What this diver takes from the shop, and in what size. It is what the trip prep list is
          built from — never an equipment reservation or a substitute for a dock-side fit check.
        </p>
      </div>
      <FieldGrid
        as="form"
        action={saveProfileAction.bind(null, shopSlug, personId)}
        columns={2}
        className="mt-4 rounded-lg border border-border bg-surface p-5"
      >
        {offered.length > 0 ? (
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">Rents from the shop</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {offered.map(({ name, field, label, defaultRented }) => (
                <label
                  key={name}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                >
                  <input
                    name={name}
                    type="checkbox"
                    defaultChecked={profile?.[field] ?? defaultRented}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {offers.has("bcd") ? (
          <Field label="BCD size">
            <input
              name="bcdSize"
              defaultValue={profile?.bcdSize ?? ""}
              placeholder="M"
              className={controlClass}
            />
          </Field>
        ) : null}
        {offers.has("wetsuit") ? (
          <Field label="Wetsuit size">
            <input
              name="wetsuitSize"
              defaultValue={profile?.wetsuitSize ?? ""}
              placeholder="3 mm / M"
              className={controlClass}
            />
          </Field>
        ) : null}
        {offers.has("wetsuit") ? (
          <Field label="Boot size">
            <input
              name="bootSize"
              defaultValue={profile?.bootSize ?? ""}
              placeholder="9"
              className={controlClass}
            />
          </Field>
        ) : null}
        {offers.has("mask_fins") ? (
          <Field label="Fin size">
            <input
              name="finSize"
              defaultValue={profile?.finSize ?? ""}
              placeholder="L"
              className={controlClass}
            />
          </Field>
        ) : null}
        {offers.has("weights") ? (
          <Field label="Weight preference" className="sm:col-span-2">
            <input
              name="weightPreference"
              defaultValue={profile?.weightPreference ?? ""}
              placeholder="Usually 12 lb with 3 mm suit"
              className={controlClass}
            />
          </Field>
        ) : null}
        <FieldActions>
          <SubmitButton pendingLabel="Saving…" className={buttonClass({ size: "lg" })}>
            Save rental fit
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </section>
  );
}
