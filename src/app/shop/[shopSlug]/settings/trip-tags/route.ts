import { movedPageRedirect } from "@/lib/moved-page-redirect";

/** `/settings/trip-tags` moved beside dive sites and gear, to `/trip-tags` (issue #2659). */
export async function GET(request: Request, { params }: { params: Promise<{ shopSlug: string }> }) {
  return movedPageRedirect(request, (await params).shopSlug, "trip-tags");
}
