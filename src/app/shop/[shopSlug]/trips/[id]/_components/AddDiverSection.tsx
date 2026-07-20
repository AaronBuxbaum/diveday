import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";

export function AddDiverSection({
  full,
  addBookingAction,
  addToWaitlistAction,
}: {
  full: boolean;
  addBookingAction: (formData: FormData) => void;
  addToWaitlistAction: (formData: FormData) => void;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Add a diver</h2>
      <p className="mt-1 text-sm text-muted">
        For walk-ins or divers tracked in another system — puts them straight on the{" "}
        {full ? "wait list" : "manifest"}, no public booking page required.
      </p>
      <form action={full ? addToWaitlistAction : addBookingAction} className="mt-4">
        <FieldGrid columns={3}>
          <Field label="Name">
            <input name="fullName" required maxLength={120} className={controlClass} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required maxLength={200} className={controlClass} />
          </Field>
          <Field label="Phone" hint="(optional)">
            <input name="phone" type="tel" maxLength={30} className={controlClass} />
          </Field>
        </FieldGrid>
        <FieldActions className="mt-4">
          <SubmitButton pendingLabel="Adding…" className={buttonClass()}>
            {full ? "Add to wait list" : "Add to trip"}
          </SubmitButton>
        </FieldActions>
      </form>
    </section>
  );
}
