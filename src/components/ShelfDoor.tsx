import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";

/**
 * **The way to the shelf, from the thread and from the recap.**
 *
 * One component, two labels, because they are two different acts and a shared
 * word would lie about one of them: from the thread the button *opens* the
 * shelf, and from the recap it *sends* the link to the address on the booking.
 * `src/app/actions/shelf-door.ts` says why the recap may not open it.
 *
 * A form rather than a link, both times: each writes — one mints a capability,
 * the other sends mail — and a link that writes is a link a preloader follows.
 */
export function ShelfDoor({
  action,
  label,
  status,
}: {
  action: () => Promise<void>;
  label: string;
  /** The send's outcome, on the recap only; the thread's door navigates away. */
  status?: { tone: "success" | "danger"; text: string } | null;
}) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {/* The link variant, because this sits in a footer beside a real link and
          reads as the second way onward rather than as the page's primary. */}
      <SubmitButton pendingLabel={label} className={buttonClass({ variant: "link" })}>
        {label}
      </SubmitButton>
      {status ? <FormStatus tone={status.tone}>{status.text}</FormStatus> : null}
    </form>
  );
}
