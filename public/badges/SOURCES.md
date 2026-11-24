# Badge logo sources

Each file is the organization's own logo, taken unaltered from its own website (the first five rows),
or a placeholder found online (the last two rows), for the badge wall
on a shop's public page (`src/features/public-site/badge-logos.ts`, H-20261123-badge-logos-shipped). Nothing
here is redrawn or recolored, and only the Green Fins placeholder is cropped (noted below). Legal review is #4938: if a mark is not cleared, delete its
line in `BADGE_LOGOS` and its file, and the badge reads as text again.

| Badge code | File | Source | Taken |
| --- | --- | --- | --- |
| `ssi_diamond` | `/badges/ssi_diamond.png` | https://my.divessi.com/assets/corporate/ssi-logo.png (SSI, linked from divessi.com) | 2026-11-23 |
| `naui_pro` | `/badges/naui_pro.png` | https://nauiwebsitestorage.blob.core.windows.net/media/2024/11/naui-logo.png (NAUI, naui.org) | 2026-11-23 |
| `tripadvisor` | `/badges/tripadvisor.svg` | https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_secondary_registered.svg (Tripadvisor's own static host) | 2026-11-23 |
| `blue_star` | `/badges/blue_star.png` | https://sanctuaries.noaa.gov/media/img/logos/bluestar-logo-300.png (NOAA, the Blue Star page on floridakeys.noaa.gov) | 2026-11-23 |
| `dan_partner` | `/badges/dan_partner.svg` | https://dan.org/wp-content/themes/diversalertnetwork/images/divers-alert-network-logo.svg (DAN, dan.org) | 2026-11-23 |
| `padi_5_star`, `padi_idc` | `/badges/padi.svg` | https://upload.wikimedia.org/wikipedia/en/b/b0/Logo_of_PADI.svg (English Wikipedia's PADI article) | 2026-11-23 |
| `green_fins` | `/badges/green_fins.png` | https://divernet.com/wp-content/uploads/2024/12/NEW_GF_logo.jpg (Divernet's report of the Green Fins rebrand) | 2026-11-23 |

Placeholder: found online, to be replaced by the official member file (owner, 2026-11-24). The owner
said to search farther and that the real files will replace these. Notes on the two rows above:

- `padi_5_star` and `padi_idc` share the plain PADI mark: no tier-specific 5 Star or IDC mark was
  found. The file is the SVG as downloaded, unaltered.
- `green_fins` is the emblem cut out of the article's JPEG, which is the logo laid over a photo of
  water: cropped to the circle, masked to transparent outside it and scaled to 256 px. A little of the
  water's edge shows along its bottom. greenfins.net refused automated requests, so no cleaner file.

## No file, so the badge stays text

| Badge code | Why |
| --- | --- |
| `readers_choice` | Scuba Diving magazine's Readers Choice mark: scubadiving.com refused automated requests (403), and no award mark was found on another public source. |

## Grounds

`tone` in the map is the ground the published file was drawn for. NAUI's file is white type on
transparent and sits on an ink tile; the others sit on a paper tile. The tile is the same in light
and dark mode, so a mark is never recolored to suit the scheme.
