import { dismissOrientationAction } from "@/app/shop/[shopSlug]/actions";
import {
  type orientationRoleFor,
  orientationTourHref,
  orientationTourText,
} from "@/i18n/orientation-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { RoleOrientationCard, RoleOrientationLine } from "./RoleOrientationCard";

/** Orientation earns its size from the day: the full card on an empty Today, one quiet line beside work. */
export function TodayOrientation({
  shopSlug,
  orientationRole,
  nextDepartureTripId,
  hasWorkToShow,
  t,
}: {
  shopSlug: string;
  orientationRole: NonNullable<ReturnType<typeof orientationRoleFor>>;
  nextDepartureTripId?: string;
  hasWorkToShow: boolean;
  t: StaffTranslator;
}) {
  // One href rule and one dismissal for both forms — only the words
  // and the chrome differ between the card and the line.
  const tourHref = orientationTourHref(shopSlug, orientationRole, nextDepartureTripId);
  const tourText = orientationTourText(t, orientationRole);
  return hasWorkToShow ? (
    <RoleOrientationLine
      tourHref={tourHref}
      dismissAction={dismissOrientationAction}
      copy={{
        heading: t("shopHome.orientation.lineHeading"),
        dismiss: t("shopHome.orientation.dismiss"),
        tryThis: tourText.tryThis,
      }}
    />
  ) : (
    <RoleOrientationCard
      tourHref={tourHref}
      dismissAction={dismissOrientationAction}
      copy={{
        heading: t("shopHome.orientation.heading"),
        tryLabel: t("shopHome.orientation.tryLabel"),
        dismiss: t("shopHome.orientation.dismiss"),
        ...tourText,
      }}
    />
  );
}
