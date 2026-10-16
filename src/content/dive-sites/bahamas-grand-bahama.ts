// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Grand Bahama. */
export const BAHAMAS_GRAND_BAHAMA: DiveSiteTemplate[] = [
  // Denominator row: Theo's Wreck
  {
    slug: "theos-wreck",
    version: 1,
    area: "bahamas-grand-bahama",
    sources: [
      "https://www.bahamas.com/vendor/theos-wreck",
      "https://scubadiverlife.com/theos-wreck/",
      "https://web.archive.org/web/20141018234802/http://www.sunnodysseydivers.com/cruise-info--dive-sites.html",
      "https://www.wannadive.net/spot/Central_America/Bahamas/Grand_Bahama/Theo_s_Wreck/index.html",
      "https://www.dive-the-world.com/diving-sites-bahamas-grand-bahama.php",
      "https://en.wikipedia.org/wiki/MS_Logna",
    ],
    briefing: {
      name: "Theo’s Wreck",
      locationName: "South coast, Grand Bahama",
      // Approximate pin: three listings disagree by up to 2.4 km. Wikipedia lists 26.4714, -78.6856
      // (infobox) and 26.4779, -78.6916 (article text); wannadive 26.4829, -78.6704. The pin is the
      // median of the three, 1.5 km off the coast, west of Silver Point (26.4999, -78.6558) and east
      // of Xanadu Beach (26.4921, -78.7022), as wannadive and the Bahamas tourism page describe.
      // Depth: 21 m shallow side and 32 m on the sand (Sunn Odyssey 70-105 ft, Wikipedia 31 m,
      // wannadive 31 m maximum).
      forecastLatitude: 26.4779,
      forecastLongitude: -78.6856,
      description:
        "A cargo ship of about 70 m, sunk on purpose in 1982 as an artificial reef. She lies on her port side on a sandy floor with her stern toward the edge of the continental shelf, so the water past her goes dark blue and falls away. Gorgonians fan from the bow anchor chain and the shaded hull is covered in orange sponge.",
      marineLife: "Goliath grouper · jacks · grunts · green moray",
      marineLifeDescription:
        "Grunts and squirrelfish fill the hull’s shadows, with shoals of jacks around her. A very large grouper is sometimes seen on the deeper side.",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 32,
      currentNote:
        "Currents vary with the tide. Two permanent buoys mark the bow and stern; use them for the ascent. The shelf edge is open water, so carry an SMB. The sand lies at about 32 m.",
      divePlan:
        "Down the bow buoy line, along the hull toward the stern with the shelf edge beyond, and back up the line with reserve gas. Stay at hull depth, 21–27 m; do not go down to the sand at the stern. Stay outside the hull. Cut-aways in the hull are overhead; stay out.",
      fitTone: "demanding",
      fitNote:
        "A deep wreck with the shelf edge beside it. For divers with the card and the gas discipline for it. Medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Bow anchor chain",
          kind: "wreckFeature",
          note: "Hung with gorgonian sea fans, a short distance from the bow buoy line.",
        },
        {
          name: "Stern and propellers",
          kind: "wreckFeature",
          note: "The propellers sit at the seaward end, half buried in sand, with the shelf edge beyond.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "french-grunt",
        "green-moray",
        "common-sea-fan",
        "squirrelfish",
      ],
    },
  },
];
