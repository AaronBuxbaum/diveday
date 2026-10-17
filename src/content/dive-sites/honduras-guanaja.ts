// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Guanaja. */
export const HONDURAS_GUANAJA: DiveSiteTemplate[] = [
  // Denominator row: Jado Trader
  {
    slug: "jado-trader-guanaja",
    version: 1,
    area: "honduras-guanaja",
    sources: [
      "https://reefrelieffounders.com/pdf/guanaja-buoy-chart.pdf",
      "https://www.dunbarrock.com/wp-content/uploads/2019/08/guanaja-dive-map.jpg",
      "https://www.clarkscay.com/portfolio/guanaja-dive-sites/",
      "https://www.frommers.com/destinations/guanaja/active-pursuits/scuba-diving/",
      "https://undercurrent.org/UCnow/dive_magazine/1997/BaymanBayGuanaja199703.html",
    ],
    briefing: {
      name: "Jado Trader",
      locationName: "Guanaja Marine Reserve, Guanaja",
      forecastLatitude: 16.4072,
      forecastLongitude: -85.865,
      description:
        "A 73 m (240 ft) refrigerated freighter sunk in 1987, resting upright on a sand shelf beside the barrier wall, between 24 and 33 m (80–110 ft). Coral pinnacles stand nearby. Stay outside the hull.",
      marineLife: "Green moray · groupers · yellowtail snapper",
      marineLifeDescription:
        "Morays, groupers and yellowtail snapper are reported around the hull.",
      difficultyLevel: "advanced",
      depthMinMeters: 24,
      maxDepthMeters: 33,
      currentNote:
        "Current not documented; ask the crew on the day. Stay off the wall edge and carry an SMB.",
      divePlan:
        "Descend to the wreck, make a slow circuit of the outside of the hull, and ascend with reserve gas. Stay outside the hull. Medical care is far; confirm the boat's oxygen and plan.",
      fitTone: "demanding",
      fitNote: "A deep wreck for experienced divers. Plan your gas for the ascent.",
      // Depth: Clark's Cay gives 24-33 m (80-110 ft); Frommer's 33 m; Undercurrent (1997) about 110 ft. Position: the 1997 buoy chart (16 24'26.0 N, 85 51'54.0 W), checked against the Franko map's grid to within about 0.3 km.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["green-moray", "black-grouper", "yellowtail-snapper"],
    },
  },
  // Denominator row: The Pinnacle
  {
    slug: "the-pinnacle-guanaja",
    version: 1,
    area: "honduras-guanaja",
    sources: [
      "https://reefrelieffounders.com/pdf/guanaja-buoy-chart.pdf",
      "https://www.dunbarrock.com/wp-content/uploads/2019/08/guanaja-dive-map.jpg",
      "https://www.clarkscay.com/portfolio/guanaja-dive-sites/",
      "https://www.frommers.com/destinations/guanaja/active-pursuits/scuba-diving/",
    ],
    briefing: {
      name: "The Pinnacle",
      locationName: "Guanaja Marine Reserve, Guanaja",
      forecastLatitude: 16.4638,
      forecastLongitude: -85.9298,
      description:
        "A coral pinnacle in a channel close to the island, rising from sand beside the channel wall to within 17 m (55 ft) of the surface. Several kinds of black coral grow on it. Its base lies at 41 m (135 ft), just past the plan.",
      marineLife: "Black coral · bluebell tunicates · crinoids",
      marineLifeDescription:
        "Black coral grows on the pinnacle, and the channel wall carries bluebell tunicates and crinoids in the shallows.",
      difficultyLevel: "advanced",
      depthMinMeters: 3,
      maxDepthMeters: 40,
      currentNote: "Current not documented; ask the crew on the day. Carry an SMB.",
      divePlan:
        "Descend along the channel wall, circle the pinnacle no deeper than 30 m (100 ft), and spend the end of the dive on the shallow wall. The base lies at 41 m, so hold the floor. Staff confirm the diver's log before boarding. Medical care is far; confirm the boat's oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "A pinnacle that stands on a deep floor. Hold the plan's floor and use the shallow wall for the ascent.",
      // The pinnacle stands on sand at 41 m (135 ft) and its top is 17 m (55 ft) down; the base is past 40 m, so the plan holds a 30 m floor; maxDepthMeters stays at 40 because the 41 m base is a bounded structure the prose names, which takes Advanced Open Water with the Deep specialty. Position: the 1997 chart (16 27'49.6 N, 85 55'47.1 W), within about 0.6 km of the Franko map's grid.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["black-coral", "bluebell-tunicate", "golden-crinoid"],
    },
  },
  // Denominator row: Vertigo
  {
    slug: "vertigo-guanaja",
    version: 1,
    area: "honduras-guanaja",
    sources: [
      "https://reefrelieffounders.com/pdf/guanaja-buoy-chart.pdf",
      "https://www.dunbarrock.com/wp-content/uploads/2019/08/guanaja-dive-map.jpg",
      "https://www.clarkscay.com/portfolio/guanaja-dive-sites/",
      "https://www.frommers.com/destinations/guanaja/active-pursuits/scuba-diving/",
    ],
    briefing: {
      name: "Vertigo",
      locationName: "Guanaja Marine Reserve, Guanaja",
      forecastLatitude: 16.3949,
      forecastLongitude: -85.8906,
      description:
        "A steep drop on the barrier reef wall. The top of the wall is near 11 m (35 ft), and it falls to about 51 m (160 ft), far past the plan, before a sand shelf and a second drop.",
      marineLife: "Black crinoids · sponges · gorgonians",
      marineLifeDescription:
        "The wall is hung with crinoids and sponges, and the dive is as much about the edge as about what lives on it.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 40,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down to the lip at about 11 m (35 ft), along the wall no deeper than 30 m (100 ft), and back up over the top of the wall with reserve gas. Medical care is far; confirm the boat's oxygen and plan.",
      fitTone: "demanding",
      fitNote: "A wall that does not end where you should. Hold your depth against the drop.",
      // The wall drops past 30 m; the plan holds a 30 m floor and maxDepthMeters stays at 40 for the bounded foot the prose names, so the gate is Advanced Open Water with the Deep specialty. Position: the 1997 buoy chart (16 23'41.7 N, 85 53'26.2 W), within about 0.2 km of the Franko map's grid.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["golden-crinoid", "common-sea-fan", "giant-barrel-sponge"],
    },
  },
  // Denominator row: Jim's Silver Lode
  {
    slug: "jims-silverlode-guanaja",
    version: 1,
    area: "honduras-guanaja",
    sources: [
      "https://reefrelieffounders.com/pdf/guanaja-buoy-chart.pdf",
      "https://www.dunbarrock.com/wp-content/uploads/2019/08/guanaja-dive-map.jpg",
      "https://www.clarkscay.com/portfolio/guanaja-dive-sites/",
      "https://undercurrent.org/UCnow/dive_magazine/1997/BaymanBayGuanaja199703.html",
    ],
    briefing: {
      name: "Jim's Silverlode",
      locationName: "Guanaja Marine Reserve, Guanaja",
      forecastLatitude: 16.4033,
      forecastLongitude: -85.8805,
      description:
        "A wall dive on the southeast side. A tunnel runs along the wall near 21 m (70 ft); it is an overhead, so stay out of it. The wall falls on beyond the plan.",
      marineLife: "Groupers · yellowtail snapper · green moray · silversides",
      marineLifeDescription:
        "Groupers, yellowtails and a green moray are reported along the wall and the sandy ground beside it.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the wall above the tunnel no deeper than 30 m (100 ft), stay out of the tunnel, and finish over the shallower coral beds. Medical care is far; confirm the boat's oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "A deep wall with a tunnel beside it. An intermediate-level dive that stays in the open.",
      // The wall drops past 30 m; the plan holds a hard floor at 30 m (100 ft), so the gate is Advanced Open Water without the Deep specialty. Overhead: the tunnel is an overhead, so the prose and plan keep divers out of it. Position: the 1997 buoy chart (16 24'11.7 N, 85 52'49.8 W), within about 0.6 km of the Franko map's grid.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["black-grouper", "yellowtail-snapper", "green-moray"],
    },
  },
];
