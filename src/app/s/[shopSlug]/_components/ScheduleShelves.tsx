import type { ComponentProps } from "react";
import { publicCoursesPath } from "@/lib/public-routes";
import { CoursesShelf } from "./CoursesShelf";
import { MonthSightingsSection } from "./MonthSightingsShelf";
import { PublicStaffProfiles } from "./PublicStaffProfiles";
import { ShopfrontStory } from "./ShopfrontStory";
import { BoatsShelf } from "./ShopPhotoStrip";

type ShelfShop = ComponentProps<typeof ShopfrontStory>["shop"];

/** The schedule's shelves: courses, story, staff, boats and sightings. */
export function ScheduleShelves({
  shop,
  shopSlug,
  locale,
  t,
  tz,
  courses,
  aggregate,
  staffProfiles,
  boats,
  className,
  only,
}: {
  shop: ShelfShop;
  shopSlug: string;
  locale: string;
  t: ComponentProps<typeof ShopfrontStory>["t"];
  tz: string;
  courses: ComponentProps<typeof CoursesShelf>["courses"];
  aggregate: ComponentProps<typeof ShopfrontStory>["aggregate"];
  staffProfiles: ComponentProps<typeof PublicStaffProfiles>["profiles"];
  boats: ComponentProps<typeof BoatsShelf>["boats"];
  className: string;
  /** A shop that leads with its courses shows that shelf up top and the rest below the schedule. */
  only?: "courses" | "rest";
}) {
  if (only === "courses") {
    return (
      <CoursesShelf
        courses={courses}
        allCoursesHref={publicCoursesPath(shopSlug)}
        className={className}
        dates={{ shopSlug, locale, timeZone: tz, t }}
      />
    );
  }
  return (
    <>
      {/* **The shelves.** What the shop teaches, then what divers said about
          it — the two things a diver weighs after the boats and before the
          three asks below. Neither renders inside the frame, which stays the
          compact booking widget (docs ADR 20260726-schedule-embed). The courses
          shelf renders on any shop with an active course, including one with no
          departures at all: a course-led shop with an empty board is a real
          day-zero shape, and the shelf is the only thing on that page with
          something to sell. */}
      {only === "rest" ? null : (
        <CoursesShelf
          courses={courses}
          allCoursesHref={publicCoursesPath(shopSlug)}
          className={className}
          dates={{ shopSlug, locale, timeZone: tz, t }}
        />
      )}
      <ShopfrontStory
        shop={shop}
        aggregate={aggregate}
        locale={locale}
        t={t}
        className={className}
      />
      <PublicStaffProfiles profiles={staffProfiles} locale={locale} />
      <BoatsShelf boats={boats} t={t} className={className} />
      <MonthSightingsSection shop={shop} tz={tz} locale={locale} t={t} />
    </>
  );
}
