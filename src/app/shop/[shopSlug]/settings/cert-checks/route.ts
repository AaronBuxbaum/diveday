import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * `/settings/cert-checks` was the Try the checks page; it is a disclosure on
 * the Card checks row of Bookings now (issue #2817). A 308 to that row's
 * anchor keeps an old bookmark working. A Route Handler, not a page, for the
 * reason `moved-page-redirect.ts` gives, and by hand because that helper
 * carries a query, not a fragment.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  await requireStaffSession();
  const { shopSlug } = await params;
  return new Response(null, {
    status: 308,
    headers: { Location: `${shopPath(shopSlug, "settings")}#cert-check` },
  });
}
