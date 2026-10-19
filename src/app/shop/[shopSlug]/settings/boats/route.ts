import { movedPageRedirect } from "@/lib/moved-page-redirect";

/** `/settings/boats` moved beside dive sites and gear, to `/boats` (issue #2659). */
export async function GET(request: Request, { params }: { params: Promise<{ shopSlug: string }> }) {
  return movedPageRedirect(request, (await params).shopSlug, "boats");
}
