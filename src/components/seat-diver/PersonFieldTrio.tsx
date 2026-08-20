import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";

/**
 * Name / email / phone — the three fields every hand-entry form in the staff
 * app asks for, in one place.
 *
 * The one thing that legitimately differs between doors is whether the email is
 * required, and that is already declared as data per surface
 * (`SEAT_SURFACES[…].email`, src/app/actions/seat-diver-surfaces.ts). It
 * arrives here as that same flag instead of being hand-copied into four
 * `required` attributes that could disagree with the action validating them:
 * optional is the counter's rule (`people.email` is nullable precisely for the
 * diver who just walked up), while the trip roster keeps asking for one.
 *
 * Renders the `FieldGrid` itself so callers cannot drift on the column count;
 * `as="form"` lets a caller with nothing to nest the grid in be the form, and
 * `children` lands inside the grid for that caller's `FieldActions` row.
 *
 * `as` discriminates the props: only the `as="form"` arm accepts a form's own
 * attributes, so `action` (or `method`, or `onSubmit`) cannot be handed to a
 * component that is about to render a `<div>` and drop it. `FieldGrid` below
 * takes the looser shape — one prop bag for all three of its tags — which is
 * why the narrowing is worth stating here, at the call sites, rather than
 * assumed from it.
 *
 * `as` is **required on both arms**, which is what makes the union bite. With
 * an optional `as?: "div"` the narrowing is decorative: TypeScript's
 * excess-property check on a union admits any property present in *some*
 * member, so `<PersonFieldTrio action={…} />` with no `as` at all still
 * compiles clean against the div arm. Verified both ways before this was
 * written down.
 */
type PersonFieldTrioProps = {
  email: "required" | "optional";
  name?: "required" | "optional";
  nameLabel: string;
  emailLabel: string;
  phoneLabel: string;
  /** Rendered beside every field this surface does not insist on. */
  optionalHint: string;
  /**
   * The browser-side caps, defaulting to what the seat-a-diver action accepts.
   * A door whose own validator is looser passes its own, so the box never stops
   * a value the server would have taken (the diver roster's create-a-person
   * form allows a longer address and phone than a seating does).
   */
  emailMaxLength?: number;
  phoneMaxLength?: number;
  defaultValues?: {
    fullName?: string;
    email?: string;
    phone?: string;
  };
  className?: string;
  children?: ReactNode;
} & (
  | ({ as: "form" } & Omit<ComponentPropsWithoutRef<"form">, "className" | "children">)
  | { as: "div" }
);

export function PersonFieldTrio({
  email,
  name = "required",
  nameLabel,
  emailLabel,
  phoneLabel,
  optionalHint,
  emailMaxLength = 200,
  phoneMaxLength = 30,
  defaultValues,
  className = "",
  as,
  children,
  ...rest
}: PersonFieldTrioProps) {
  return (
    <FieldGrid columns={3} className={className} as={as} {...rest}>
      <Field label={nameLabel} hint={name === "optional" ? optionalHint : undefined}>
        <input
          name="fullName"
          required={name === "required"}
          defaultValue={defaultValues?.fullName}
          maxLength={120}
          autoComplete="name"
          className={controlClass}
        />
      </Field>
      <Field label={emailLabel} hint={email === "optional" ? optionalHint : undefined}>
        <input
          name="email"
          type="email"
          required={email === "required"}
          defaultValue={defaultValues?.email}
          maxLength={emailMaxLength}
          autoComplete="email"
          className={controlClass}
        />
      </Field>
      <Field label={phoneLabel} hint={optionalHint}>
        <input
          name="phone"
          type="tel"
          defaultValue={defaultValues?.phone}
          maxLength={phoneMaxLength}
          autoComplete="tel"
          className={controlClass}
        />
      </Field>
      {children}
    </FieldGrid>
  );
}
