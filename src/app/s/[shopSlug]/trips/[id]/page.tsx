import { notFound } from "next/navigation";
import { uuidParam } from "@/lib/uuid";
import { TripDetailPage } from "./TripDetail";

// Both routes share their content; only actual route props reach a page default.
export const instant = true;
export { publicTripMetadata as generateMetadata } from "./_lib/page-metadata";

export default async function PublicTripPage(
  props: Omit<Parameters<typeof TripDetailPage>[0], "isEmbed">,
) {
  const { id } = await props.params;
  if (!uuidParam(id)) notFound();
  return <TripDetailPage {...props} />;
}
