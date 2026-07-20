import type { ReactNode } from "react";
import {
  CaptainRollCallFallback,
  DiverBookingFallback,
  FrontDeskReadinessFallback,
} from "@/components/MarketingScreenFallbacks";
import { productFeatureGroups } from "@/lib/marketing";

/**
 * Shared marketing rendering used by the landing, product, and pricing pages so
 * they always describe the same product with the same components.
 *
 * The public pages ship deterministic illustrated mockups (the `*Fallback`
 * components) as the design. `MarketingMockup` preserves the framing the old
 * `MarketingScreenshot` fallback branch provided: an accessible `role="img"`
 * with an `aria-label`, plus the rounded bordered surface.
 */
export function MarketingMockup({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`overflow-hidden rounded-2xl border border-border bg-surface text-left ${className}`}
    >
      {children}
    </div>
  );
}

/** The captain roll-call mockup inside a phone device frame (landing hero + product dock). */
export function CaptainPhoneFrame({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[2.5rem] border-[9px] border-foreground bg-foreground p-1.5 shadow-2xl shadow-foreground/15 ${className}`}
    >
      <div className="mx-auto mb-1.5 h-1.5 w-20 rounded-full bg-surface-sunken" />
      <MarketingMockup label={label} className="rounded-[1.9rem] border-0">
        <CaptainRollCallFallback />
      </MarketingMockup>
    </div>
  );
}

/** A "moment" card: role eyebrow + title + description above an illustrated mockup. */
export function MarketingMomentCard({
  role,
  title,
  description,
  children,
}: {
  role: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="p-6 sm:p-8">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">{role}</p>
        <h3 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-3 max-w-lg leading-7 text-muted">{description}</p>
      </div>
      <div className="border-t border-border bg-surface-sunken p-4 sm:p-6">{children}</div>
    </article>
  );
}

export const marketingMockups = {
  diverBooking: {
    label: "The Blue Mantis public schedule with upcoming dive trips and available places.",
    render: () => <DiverBookingFallback />,
  },
  frontDeskReadiness: {
    label: "The trip readiness section showing clear diver-ready and diver-blocked states.",
    render: () => <FrontDeskReadinessFallback />,
  },
} as const;

/**
 * The `productFeatureGroups` grid rendered on landing, product, and pricing.
 *
 * `featuresPerGroup` caps how many features each card lists; `1` renders a
 * single summary paragraph (the compact landing treatment), anything higher
 * renders a checklist. `columns` chooses the responsive grid width.
 */
export function FeatureGroupsGrid({
  featuresPerGroup,
  columns = 2,
}: {
  featuresPerGroup?: number;
  columns?: 2 | 4;
}) {
  const gridClass =
    columns === 4 ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-5 md:grid-cols-2";

  return (
    <div className={gridClass}>
      {productFeatureGroups.map((group) => {
        const features = featuresPerGroup
          ? group.features.slice(0, featuresPerGroup)
          : group.features;
        const summaryOnly = featuresPerGroup === 1;

        return (
          <article
            key={group.eyebrow}
            className="rounded-xl border border-border bg-background p-5 sm:p-6"
          >
            <p className="text-xs font-semibold tracking-widest text-primary uppercase">
              {group.eyebrow}
            </p>
            <h3 className="mt-3 font-semibold leading-6">{group.title}</h3>
            {summaryOnly ? (
              <p className="mt-3 text-sm leading-6 text-muted">{features[0]}</p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm leading-6 text-muted">
                {features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span className="font-semibold text-primary">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
