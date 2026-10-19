import { movedPageRedirect } from "@/lib/moved-page-redirect";

/** `/settings/safety-checklist` moved beside dive sites and gear, to `/safety-checklist` (issue #2659). */
export async function GET(request: Request, { params }: { params: Promise<{ shopSlug: string }> }) {
  return movedPageRedirect(request, (await params).shopSlug, "safety-checklist");
}
