import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

export type RoleOrientationCardCopy = {
  heading: string;
  subtitle: string;
  tryLabel: string;
  dismiss: string;
  title: string;
  desc: string;
  tryThis: string;
};

/**
 * A day-one hire's first-visit orientation on Today (UX-persona task 79 — Kai,
 * the seasonal hire handed a login and never told where anything lives).
 * Reuses the demo role tour's shape (title/desc/"Try:" prompt, `DemoBanner`)
 * but with real-shop content pointed at the role's actual daily surface —
 * the manifest for a captain, check-in for crew. Dismissal is a plain form
 * submit (no client JS needed) so it works even on a spotty dock connection,
 * and persists per account (`user_accounts.orientation_dismissed_at`) rather
 * than per browser, so it stays dismissed across the shop's shared devices.
 */
export function RoleOrientationCard({
  tourHref,
  dismissAction,
  copy,
}: {
  tourHref: string;
  dismissAction: () => Promise<void>;
  copy: RoleOrientationCardCopy;
}) {
  return (
    <section
      aria-labelledby="role-orientation-heading"
      className="mb-10 rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="role-orientation-heading" className="text-lg font-semibold">
            {copy.heading}
          </h2>
          <p className="mt-1 text-sm text-muted">{copy.subtitle}</p>
          <p className="mt-4 font-medium">{copy.title}</p>
          <p className="mt-1 text-sm text-muted">{copy.desc}</p>
          <p className="mt-3 text-sm">
            <span className="font-semibold text-foreground">💡 {copy.tryLabel}</span>{" "}
            <Link href={tourHref} className="font-medium text-primary hover:underline">
              {copy.tryThis}
            </Link>
          </p>
        </div>
        <form action={dismissAction} className="shrink-0" data-scroll-reset="true">
          <SubmitButton
            pendingLabel={copy.dismiss}
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "text-foreground",
            })}
          >
            {copy.dismiss}
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}
