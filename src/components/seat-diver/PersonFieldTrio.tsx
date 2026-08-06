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
 */
export function PersonFieldTrio({
  email,
  nameLabel,
  emailLabel,
  phoneLabel,
  optionalHint,
  emailMaxLength = 200,
  phoneMaxLength = 30,
  className = "",
  as = "div",
  children,
  ...rest
}: {
  email: "required" | "optional";
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
  className?: string;
  as?: "div" | "form";
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<"form">, "className" | "children">) {
  return (
    <FieldGrid columns={3} className={className} as={as} {...rest}>
      <Field label={nameLabel}>
        <input
          name="fullName"
          required
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
          maxLength={emailMaxLength}
          autoComplete="email"
          className={controlClass}
        />
      </Field>
      <Field label={phoneLabel} hint={optionalHint}>
        <input
          name="phone"
          type="tel"
          maxLength={phoneMaxLength}
          autoComplete="tel"
          className={controlClass}
        />
      </Field>
      {children}
    </FieldGrid>
  );
}
