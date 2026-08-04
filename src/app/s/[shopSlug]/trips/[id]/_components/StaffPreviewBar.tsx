import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

/**
 * The one staff-facing strip on an otherwise entirely diver-facing page.
 *
 * A signed-in staffer viewing their own shop's booking page used to be
 * redirected straight to the management view, which made the trip overview's
 * "View booking page" button impossible to use — it opened the page and the
 * page sent them back. This says the same thing the redirect was trying to say
 * ("this is the diver's view, the management view is over here") while leaving
 * the preview on screen.
 *
 * Words come in as props: the surrounding page renders diver copy, and staff
 * copy is server-resolved from the staff bundle by the caller.
 */
export function StaffPreviewBar({
  message,
  manageLabel,
  manageHref,
}: {
  message: string;
  manageLabel: string;
  manageHref: string;
}) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-4 py-3"
    >
      <p className="text-sm font-medium">
        <span aria-hidden="true">👁 </span>
        {message}
      </p>
      <Link href={manageHref} className={buttonClass({ variant: "secondary", size: "sm" })}>
        {manageLabel}
      </Link>
    </div>
  );
}
