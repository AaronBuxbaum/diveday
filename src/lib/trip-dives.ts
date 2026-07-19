import type { TripDiveDraft } from "@/db/queries";

/** Reads the ordered optional dive cards from a trip form. */
export function tripDiveDraftsFromForm(formData: FormData, count: number): TripDiveDraft[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const value = (name: string) => String(formData.get(`dive-${number}-${name}`) ?? "").trim();
    return {
      title: value("title") || null,
      diveSiteId: value("siteId") || null,
      description: value("description") || null,
    };
  });
}
