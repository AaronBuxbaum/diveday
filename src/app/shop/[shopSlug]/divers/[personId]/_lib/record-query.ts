import { shopPath } from "@/lib/staff-notices";

/** Consumed once by FlashParams, never restored by the record's pager links. */
export const DIVER_RECORD_FLASH_PARAMS = [
  "notice",
  "undo",
  "cardType",
  "by",
  "form",
  "edit",
  "noteBody",
];

/** Invalid or unsafe URL numbers never reach the SQL offset. */
export function bookingPageNumber(value: string | string[] | undefined): number {
  const page = typeof value === "string" ? Number(value) : 1;
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function bookingPageHref(
  shopSlug: string,
  personId: string,
  query: Record<string, string | string[] | undefined>,
  target: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (DIVER_RECORD_FLASH_PARAMS.includes(key)) continue;
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, entry);
    }
  }
  params.set("bookingPage", String(target));
  return `${shopPath(shopSlug, "divers", personId)}?${params}#book-departure`;
}
