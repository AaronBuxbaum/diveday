import { requireShopSurface } from "@/features/session";
import { COMPUTER_CSV_TEMPLATE } from "@/lib/computer-import";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string; personId: string }> },
) {
  const { shopSlug } = await params;
  await requireShopSurface(shopSlug);
  return new Response(COMPUTER_CSV_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=computer-dives-template.csv",
      "Cache-Control": "private, no-store",
    },
  });
}
