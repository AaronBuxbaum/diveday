import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { saveProfileAction } from "../actions";
import type { DiverProfile } from "./shared";

export function RentalFit({
  diver,
  shopSlug,
  personId,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
}) {
  const profile = diver.gearProfile;
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="gear-profile-heading">
      <div>
        <h2 id="gear-profile-heading" className="text-lg font-semibold">
          Rental fit
        </h2>
        <p className="mt-1 text-sm text-muted">
          Planning preferences, not an equipment reservation or a substitute for a dock-side fit
          check.
        </p>
      </div>
      <FieldGrid
        as="form"
        action={saveProfileAction.bind(null, shopSlug, personId)}
        columns={2}
        className="mt-4 rounded-lg border border-border bg-surface p-5"
      >
        <Field label="BCD size">
          <input
            name="bcdSize"
            defaultValue={profile?.bcdSize ?? ""}
            placeholder="M"
            className={controlClass}
          />
        </Field>
        <Field label="Wetsuit size">
          <input
            name="wetsuitSize"
            defaultValue={profile?.wetsuitSize ?? ""}
            placeholder="3 mm / M"
            className={controlClass}
          />
        </Field>
        <Field label="Boot size">
          <input
            name="bootSize"
            defaultValue={profile?.bootSize ?? ""}
            placeholder="9"
            className={controlClass}
          />
        </Field>
        <Field label="Fin size">
          <input
            name="finSize"
            defaultValue={profile?.finSize ?? ""}
            placeholder="L"
            className={controlClass}
          />
        </Field>
        <Field label="Weight preference" className="sm:col-span-2">
          <input
            name="weightPreference"
            defaultValue={profile?.weightPreference ?? ""}
            placeholder="Usually 12 lb with 3 mm suit"
            className={controlClass}
          />
        </Field>
        <FieldActions>
          <SubmitButton pendingLabel="Saving…" className={buttonClass({ size: "lg" })}>
            Save rental fit
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </section>
  );
}
