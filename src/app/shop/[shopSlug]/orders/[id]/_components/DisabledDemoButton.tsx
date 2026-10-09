import { buttonClass } from "@/components/ui/button";

/** A greyed-out stand-in for a Stripe action a demo shop can't perform. */
export function DisabledDemoButton({
  label,
  hint,
  variant,
}: {
  label: string;
  hint: string;
  variant: "secondary" | "danger";
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={hint}
      className={buttonClass({
        variant,
        className: "cursor-not-allowed opacity-50",
      })}
    >
      {label}
    </button>
  );
}
