import type { MetadataRoute } from "next";

/**
 * Lets a crew member install the roll-call manifest to a phone's home
 * screen, alongside the offline-ready service worker that already exists
 * for it (manifest-sw.js). `theme_color` and `background_color` mirror
 * globals.css's light-mode `--primary`/`--background` (a static manifest can't
 * read the runtime theme), and `src/app/layout.tsx`'s `viewport` export carries
 * the same colour as a `<meta name="theme-color">` because Safari reads the tag
 * and not this file.
 *
 * **This declared two icons, 32 and 180, and so could not be installed.**
 * Chrome wants at least 192×192 before it will fire `beforeinstallprompt`, and
 * 512 for the splash screen; with neither, the "Install app" option never
 * appeared on Android — for the app whose whole purpose is a crew phone holding
 * a manifest for a boat with no signal (issue #794).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DiveDay — a calmer way to run a dive day",
    short_name: "DiveDay",
    description:
      "Bookings, waivers, cert checks, trip prep, and boat manifests — one calm system for the whole dive shop.",
    // **Not "/", which is the marketing homepage.** A crew member who installs
    // DiveDay and taps the icon was landing on "Run the whole dive day" and
    // "Start a trial" — the one answer that helps nobody who has already
    // installed it. `/shop` is an existing entry point rather than a new
    // surface: `src/lib/auth.config.ts` redirects a signed-in staff member from
    // it to their own shop, and bounces anyone else to sign-in, which returns
    // here afterwards. So an installed launch lands on the shop's own day, and
    // the shop layout's auto-save is what keeps this device's offline copy
    // current — which is exactly what the empty offline-manifest screen tells
    // a crew member to go and do.
    start_url: "/shop",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#0e7490",
    icons: [
      { src: "/icon/32", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      // Drawn to be cropped: the mark sits inside Android's safe zone and the
      // brand colour bleeds to the edge, so the launcher can cut a circle, a
      // squircle or a teardrop out of it. Without a maskable entry Android
      // letterboxes the square mark inside a white circle and shrinks it.
      {
        src: "/pwa-icon-maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
