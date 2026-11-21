import { requireShopSurface } from "@/features/accounts/session";
import { COMPUTER_CSV_TEMPLATE } from "@/lib/computer-import";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string; personId: string }> },
) {
  const { shopSlug } = await params;
  const { shop } = await requireShopSurface(shopSlug);
  if (!shop.computerDivesEnabled) return new Response(null, { status: 404 });
  return new Response(COMPUTER_CSV_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=computer-dives-template.csv",
      "Cache-Control": "private, no-store",
    },
  });
}
