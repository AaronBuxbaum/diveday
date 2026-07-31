import type { MetadataRoute } from "next";

/**
 * Lets a crew member install the roll-call manifest to a phone's home
 * screen, alongside the offline-ready service worker that already exists
 * for it (manifest-sw.js). `icon.tsx`/`apple-icon.tsx` already generate the
 * bubble-trail mark at the two sizes referenced here; `theme_color` and
 * `background_color` mirror globals.css's light-mode `--primary`/
 * `--background` (a static manifest can't read the runtime theme).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DiveDay — a calmer way to run a dive day",
    short_name: "DiveDay",
    description:
      "Bookings, waivers, cert checks, trip prep, and boat manifests — one calm system for the whole dive shop.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#0e7490",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
