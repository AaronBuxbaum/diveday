import { TripDetailPage } from "./TripDetail";

// Both routes share their content; only actual route props reach a page default.
export const instant = true;
export { publicTripMetadata as generateMetadata } from "./_lib/page-metadata";

export default function PublicTripPage(
  props: Omit<Parameters<typeof TripDetailPage>[0], "isEmbed">,
) {
  return <TripDetailPage {...props} />;
}
