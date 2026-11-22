import { Suspense } from "react";
import type { DiverTranslator } from "@/i18n/messages";
import { OurYearSection } from "./OurYear";
import { SafetyRecordSection } from "./SafetyRecord";

/**
 * **The shop's own counts at the foot of the shopfront**: "Our year" and the
 * safety record, each behind its own switch and its own `<Suspense>` so one
 * slow count never holds the other back. Neither draws anything until the
 * shop has the history to count.
 */
export function ShopfrontCounts({
  shop,
  locale,
  t,
  className,
}: {
  shop: {
    id: string;
    name: string;
    timezone: string;
    seasonStartMonth: number;
    seasonStartDay: number;
    publicYearEnabled: boolean;
    safetyRecordEnabled: boolean;
  };
  locale: string;
  t: DiverTranslator;
  className?: string;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <OurYearSection shop={shop} locale={locale} t={t} className={className} />
      </Suspense>
      <Suspense fallback={null}>
        <SafetyRecordSection shop={shop} locale={locale} t={t} className={className} />
      </Suspense>
    </>
  );
}
