import { notFound } from "next/navigation";
import { requireShopSurface } from "@/features/session";
import { uuidParam } from "@/lib/uuid";
import { DepartureLogPage } from "./DepartureLogPage";
export const instant = true;
export const metadata = { title: "Departure log — DiveDay" };
export default async function Page({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id } = await params;
  if (!uuidParam(id)) notFound();
  const context = await requireShopSurface(shopSlug);
  return DepartureLogPage({ params, context });
}
