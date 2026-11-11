import { getFeaturePage } from "@/lib/feature-pages";

/** The same roles as the feature-page demo doors, with a departure when available. */
export const DEMO_STARTS = [
  { id: "captain", feature: "boat-manifest", copy: "startCaptain" },
  { id: "desk", feature: "check-in", copy: "startDesk" },
  { id: "diver", feature: "online-booking", copy: "startDiver" },
] as const;

export type DemoStart = (typeof DEMO_STARTS)[number]["id"];

export function demoStartFrom(value: unknown) {
  const start = DEMO_STARTS.find(({ id }) => id === value);
  const feature = start && getFeaturePage(start.feature);
  return start && feature ? { ...start, ...feature.demo } : null;
}
