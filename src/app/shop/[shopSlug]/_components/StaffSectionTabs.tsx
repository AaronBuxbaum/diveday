import { SectionTabs, SectionTabsSkeleton } from "@/components/SectionTabs";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import { type Role, staffDestinationGates } from "@/lib/authz";
import {
  STAFF_DESTINATION_LABEL_KEYS,
  STAFF_SECTION_TAB_LABEL_KEYS,
  STAFF_SECTION_TABS,
  type StaffDestinationId,
  staffDestinationHref,
  staffSectionTabs,
  staffShopRoot,
  type TabbedStaffSection,
} from "@/lib/staff-destinations";

/**
 * Inbox's and Money's tabs, read from the destination registry with the
 * viewer's own gates — so a tab never offers a page the nav would hide, and
 * each tab says what the nav's search calls that page.
 */
export function StaffSectionTabs({
  shopSlug,
  section,
  current,
  roles,
  t,
}: {
  shopSlug: string;
  section: TabbedStaffSection;
  current: StaffDestinationId;
  roles: readonly Role[] | undefined;
  t: (key: StaffMessageKey) => string;
}) {
  const root = staffShopRoot(shopSlug);
  return (
    <SectionTabs
      label={t(`shared.shopSections.${section}`)}
      current={current}
      tabs={staffSectionTabs(section, staffDestinationGates(roles)).map((destination) => ({
        id: destination.id,
        href: staffDestinationHref(root, destination),
        label: t(
          STAFF_SECTION_TAB_LABEL_KEYS[destination.id] ??
            STAFF_DESTINATION_LABEL_KEYS[destination.id],
        ),
      }))}
    />
  );
}

/**
 * The tabs in a `loading.tsx`, which cannot know the viewer: drawn at the
 * full count, the shape an owner sees.
 */
export function StaffSectionTabsSkeleton({ section }: { section: TabbedStaffSection }) {
  return <SectionTabsSkeleton count={STAFF_SECTION_TABS[section].length} />;
}
