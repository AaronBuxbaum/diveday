import { requireShopSurface } from "@/lib/session";
import type { BoardSearchParams } from "../_components/board-search-params";
import ScheduleBoardPage from "../page";

export const instant = true;

export default async function AddDeparturePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<BoardSearchParams>;
}) {
  // This route must check its URL's shop before rendering the shared board.
  const { shopSlug } = await params;
  await requireShopSurface(shopSlug);
  const query = await searchParams;
  return ScheduleBoardPage({
    params,
    searchParams: Promise.resolve({ ...query, _createPage: "1" }),
  });
}
