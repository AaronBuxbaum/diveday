// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Cayman Brac and Little Cayman. */
export const CAYMAN_SISTER_ISLANDS: DiveSiteTemplate[] = [
  // Denominator row: Three Fathom Wall
  {
    slug: "three-fathom-wall-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubadiving.com/10-reasons-why-scuba-divers-love-little-cayman",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://www.littlecaymandivers.com/little-cayman-dive-sites-and-map",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=8",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
      "https://dtmag.com/thelibrary/the-island-of-little-cayman-a-bucket-list-dive-destination/",
    ],
    briefing: {
      name: "Three Fathom Wall",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6849,
      forecastLongitude: -80.078,
      description:
        "The first site in the Bloody Bay string, where Jackson's Bight meets the wall. The top starts near 6 m (18 to 20 ft), with sponges along the lip, then falls away. Black coral grows deeper on the wall. Also called Mixing Bowl.",
      marineLife: "Nassau grouper · snapper and grunts · eagle rays · turtles",
      marineLifeDescription:
        "Snapper and grunts pack the cleft called the Mixing Bowl. Rays and yellowhead jawfish work the sand beside the coral fingers.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 6 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "A shallow lip that tempts you to stay up, and a wall that does not end where you should. Hold the 30 m floor.",
      // Sources put the wall top at 18 ft (5.5 m) to 20 ft (6 m); the range starts at 6 m. The mooring is in 25 ft.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nassau-grouper",
        "bermuda-chub",
        "spotted-eagle-ray",
        "yellowhead-jawfish",
        "black-coral",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Marilyn's Cut
  {
    slug: "marilyns-cut-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubadiving.com/10-reasons-why-scuba-divers-love-little-cayman",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://www.scubago.com/en/explore/destination/bloody-bay-9750208",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=7",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
      "https://blog.padi.com/best-dive-sites-in-the-cayman-islands/",
    ],
    briefing: {
      name: "Marilyn's Cut",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6847,
      forecastLongitude: -80.0791,
      description:
        "A wall dive named for its cut, a large swim-through. The cut is overhead; stay out of it and take the open wall. Two deep canyons slice into the reef beside it, and the coral cover is intact.",
      marineLife: "Nassau grouper · horse-eye jacks · turtles · barrel sponges",
      marineLifeDescription:
        "A grouper sometimes slips inside a big barrel sponge, and the cleaning stations reward a slow look.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 11 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A wall that drops far below any plan. Skip the cut and hold your floor.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The cut",
          kind: "reefFormation",
          note: "A large swim-through. Overhead; stay outside it.",
        },
      ],
      creatureSlugs: [
        "nassau-grouper",
        "horse-eye-jack",
        "green-sea-turtle",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Randy's Gazebo
  {
    slug: "randys-gazebo-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubadiving.com/10-reasons-why-scuba-divers-love-little-cayman",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://www.littlecaymandivers.com/little-cayman-dive-sites-and-map",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=9",
      "https://cadivingnews.com/dive-spots/little-caymans-big-walls/",
    ],
    briefing: {
      name: "Randy's Gazebo",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6838,
      forecastLongitude: -80.083,
      description:
        "A wall named for its chimney and a wide limestone arch. The chimney is a narrow overhead tunnel; stay out of it and dive the open wall. Barrel sponges, anemones and yellow tube sponges decorate the arch.",
      marineLife: "Sailfin blennies · octopus · hawksbill turtles · arrow crabs",
      marineLifeDescription:
        "The top of the wall is a small-animal site: seahorses, feather stars, cleaner shrimp and morays turn up if you look slowly.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 9 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "Rewarding for macro eyes and wide-angle alike. The chimney is a narrow overhead tunnel; stay out of it.",
      // Sources call the chimney a narrow tunnel or a squeeze, so it is beyond a cavern card: no gate, and the prose says to stay out. Most sources run it 12 m (40 ft) down to 24 m (80 ft); one older page reverses the direction.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The chimney",
          kind: "reefFormation",
          note: "A narrow overhead tunnel in the plateau. Stay out of it.",
        },
        {
          name: "The archway",
          kind: "reefFormation",
          note: "A wide limestone arch set into the coral plateau.",
        },
      ],
      creatureSlugs: [
        "sailfin-blenny",
        "arrow-crab",
        "hawksbill-turtle",
        "giant-barrel-sponge",
        "longsnout-seahorse",
      ],
    },
  },
  // Denominator row: Lea Lea's Lookout
  {
    slug: "lea-leas-lookout-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.littlecaymandivers.com/little-cayman-dive-sites-and-map",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
      "https://www.scubago.com/en/explore/destination/bloody-bay-9750208",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=6",
    ],
    briefing: {
      name: "Lea Lea's Lookout",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6814,
      forecastLongitude: -80.0886,
      description:
        "A sheer section of the Bloody Bay Wall. A hole in the hard pan leads to a dark swim-through, which is overhead; stay out of it and dive the open wall. Soft corals and sponges crust the face.",
      marineLife: "Basket stars · morays · grunts · snapper",
      marineLifeDescription:
        "Grunts and snapper school over the hard pan. The wall carries basket stars and sea goddess slugs, and morays live in the canyon.",
      difficultyLevel: "advanced",
      depthMinMeters: 10,
      maxDepthMeters: 30,
      currentNote:
        "Nutrient-rich current runs along the canyons at times. Carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 10 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "The wall face is the dive. The dark swim-through is overhead; skip it.",
      // Sources describe a hole in the hard pan leading into a large enclosed swim-through and an 'enormous cave', so it is beyond a cavern card: no gate, and the prose says to stay out.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["giant-basket-star", "green-moray", "french-grunt", "schoolmaster-snapper"],
    },
  },
  // Denominator row: Great Wall
  {
    slug: "great-wall-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=11",
      "https://dtmag.com/thelibrary/the-island-of-little-cayman-a-bucket-list-dive-destination/",
    ],
    briefing: {
      name: "Great Wall (East and West)",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6823,
      forecastLongitude: -80.0855,
      description:
        "Two moorings on a steep, near-vertical wall. The lip lies at about 6 to 9 m (20 to 30 ft), coated with sponges and gorgonians, with large coral heads in the shallows.",
      marineLife: "Nassau grouper · grazing turtles · seahorses · lettuce sea slugs",
      marineLifeDescription:
        "Resident groupers keep divers company, and seahorses and lettuce-leaf slugs reward a close look.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 6 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Shallow enough to feel gentle, then a drop that makes buoyancy the whole job.",
      // Sources put the top at under 20 ft (6 m) or about 30 ft (9 m); the range starts at 6 m. Moorings: Great Wall West 20 ft, East 25 ft; the point is the West mooring.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "nassau-grouper",
        "green-sea-turtle",
        "lettuce-sea-slug",
        "longsnout-seahorse",
      ],
    },
  },
  // Denominator row: Donna's Delight
  {
    slug: "donnas-delight-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://www.scuba-diving-smiles.com/cayman-brac-diving.html",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=14",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
    ],
    briefing: {
      name: "Donna's Delight",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6844,
      forecastLongitude: -80.0806,
      description:
        "Wall diving in good visibility. The dive often starts through a cut in the reef that leads onto the wall, which begins near 12 m (40 ft). Giant barrel sponges and arching sea fans line the face.",
      marineLife: "Barrel sponges · sea fans · flamingo tongues · crabs",
      marineLifeDescription:
        "Neck crabs and decorator crabs live on the wall, and flamingo tongue shells are common. Bring a macro lens.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 9 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A classic Cayman wall that plunges. The plan floor is 30 m.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["giant-barrel-sponge", "common-sea-fan", "flamingo-tongue", "spiny-lobster"],
    },
  },
  // Denominator row: Eagleray Roundup
  {
    slug: "eagle-ray-roundup-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubadiving.com/10-reasons-why-scuba-divers-love-little-cayman",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=15",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
    ],
    briefing: {
      name: "Eagle Ray Roundup",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6912,
      forecastLongitude: -80.0693,
      description:
        "Eagle rays forage in the sand here, digging for crustaceans, and the site is named for them. The sand sits beside a vertical, sponge-covered section of the Bloody Bay Wall, best seen around 30 m (98 ft).",
      marineLife: "Spotted eagle rays · nurse sharks · Nassau grouper · surgeonfish",
      marineLifeDescription:
        "Rays come and go in the open water over the sand; nurse sharks patrol among the surgeonfish and groupers.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 6 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "The ray show is shallow. The wall beside it is not.",
      // The mooring is in 20 ft (6 m); one guide recommends the wall views near 30 m, which is the plan floor.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "nurse-shark",
        "nassau-grouper",
        "ocean-surgeonfish",
        "yellow-tube-sponge",
      ],
    },
  },
  // Denominator row: Cumber's Caves
  {
    slug: "cumbers-caves-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubadiving.com/10-reasons-why-scuba-divers-love-little-cayman",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
      "https://web.archive.org/web/2026/http://www.littlecayman.com/diving/diving_sites.php",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
    ],
    briefing: {
      name: "Cumber's Caves",
      locationName: "Jackson's Bight, Little Cayman",
      forecastLatitude: 19.6896,
      forecastLongitude: -80.07,
      description:
        "A wall with a sand plain in front of it and swim-throughs cut into the face. The wall top lies near 14 m (45 ft); the swim-throughs begin near 12 m (40 ft) and open onto the wall between 18 and 36 m (60 to 120 ft). They are overhead; stay out of them. Hundreds of garden eels and southern stingrays live on the sand.",
      marineLife: "Garden eels · southern stingrays · Nassau grouper · turtles",
      marineLifeDescription:
        "The sand plain is the stage; the eels pull back as you approach, so keep still and let them come out again.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 6 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "The swim-throughs are overhead and exit well past the plan floor. Stay out of them and on the wall's upper section.",
      // Mooring is in 20 ft (6 m); sources put the wall top near 45 ft (14 m).
      // Sources describe swim-throughs that run from 12 m to exits at 18 to 36 m. They are overhead and beyond a cavern card, so there is no gate and the prose says to stay out; the plan itself stops at 30 m.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["garden-eel", "southern-stingray", "nassau-grouper", "green-sea-turtle"],
    },
  },
  // Denominator row: Windsock Reef
  // Sourcing: DAN describes the south-side reefs together; each mooring depth is from the DoE list.
  {
    slug: "windsock-reef-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
    ],
    briefing: {
      name: "Windsock Reef",
      locationName: "South side, Little Cayman",
      forecastLatitude: 19.6573,
      forecastLongitude: -80.0919,
      description:
        "A south-side reef moored in 9 m (30 ft). Hard-pan shallows give way to spur-and-groove coral, which slopes to a sandy floor near 14 to 15 m (45 to 50 ft) before a vertical drop from about 24 m (80 ft).",
      marineLife: "Grouper · turtles · rays · angelfish",
      marineLifeDescription:
        "Groupers, turtles and rays are the animals to look for on the spurs and sand.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 24,
      currentNote:
        "Current not documented; ask the crew on the day. The south side offers diving whichever way the wind blows.",
      divePlan:
        "Down the mooring in 9 m, along the spurs and sand floor, no deeper than 24 m (80 ft), and back up with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Moored in 9 m, with a drop below the plan. Hold the 24 m floor.",
      // Sources put the vertical drop at about 80 ft (24 m) and give no deeper floor; the plan floor is 24 m, the same figure.
      // The wall drops past recreational depth; the plan holds a floor at 24 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["queen-parrotfish", "bluehead-wrasse", "common-sea-fan", "french-angelfish"],
    },
  },
  // Denominator row: Grundy's Gardens
  {
    slug: "grundys-gardens-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
    ],
    briefing: {
      name: "Grundy's Gardens",
      locationName: "South side, Little Cayman",
      forecastLatitude: 19.6573,
      forecastLongitude: -80.0896,
      description:
        "A south-side reef moored in 9 m (30 ft), just east of Windsock Reef. Hard-pan shallows give way to spur-and-groove coral and a sandy floor near 14 to 15 m (45 to 50 ft), then a vertical drop from about 24 m (80 ft).",
      marineLife: "Grouper · turtles · rays · angelfish",
      marineLifeDescription:
        "Watch the sand floor for rays and the spurs for groupers and turtles.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 24,
      currentNote:
        "Current not documented; ask the crew on the day. The south side offers diving whichever way the wind blows.",
      divePlan:
        "Down the mooring in 9 m, along the spurs and sand floor, no deeper than 24 m (80 ft), and back up with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A gentle start in 9 m, then a wall below the plan. Hold the 24 m floor.",
      // Sources put the vertical drop at about 80 ft (24 m) and give no deeper floor; the plan floor is 24 m, the same figure.
      // The wall drops past recreational depth; the plan holds a floor at 24 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["queen-parrotfish", "bluehead-wrasse", "common-sea-fan", "french-angelfish"],
    },
  },
  // Denominator row: Pirate's Point Reef
  {
    slug: "pirates-point-reef-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
    ],
    briefing: {
      name: "Pirate's Point Reef",
      locationName: "South side, Little Cayman",
      forecastLatitude: 19.6566,
      forecastLongitude: -80.0978,
      description:
        "A south-side reef moored in 11 m (35 ft), the westernmost of its neighbors. Spur-and-groove coral slopes to a sandy floor near 14 to 15 m (45 to 50 ft), then a vertical drop from about 24 m (80 ft).",
      marineLife: "Grouper · turtles · rays · angelfish",
      marineLifeDescription:
        "Turtles and angelfish work the spurs, with trumpetfish and jacks passing.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 24,
      currentNote:
        "Current not documented; ask the crew on the day. The south side offers diving whichever way the wind blows.",
      divePlan:
        "Down the mooring in 11 m, along the spurs and sand floor, no deeper than 24 m (80 ft), and back up with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "Moored a little deeper than its neighbors. The wall below is not part of the plan; hold 24 m.",
      // Sources put the vertical drop at about 80 ft (24 m) and give no deeper floor; the plan floor is 24 m, the same figure.
      // The wall drops past recreational depth; the plan holds a floor at 24 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["queen-parrotfish", "bluehead-wrasse", "common-sea-fan", "french-angelfish"],
    },
  },
  // Denominator row: Charlie's Chimney
  // Mooring 20 m (DoE) against the 14 to 15 m sand floor DAN gives for the group: the group description is approximate, so the dive is written as starting near the drop, floor 24 m.
  {
    slug: "charlies-chimney-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
    ],
    briefing: {
      name: "Charlie's Chimney",
      locationName: "South side, Little Cayman",
      forecastLatitude: 19.6558,
      forecastLongitude: -80.0937,
      description:
        "A south-side reef moored in 20 m (65 ft), deeper than the neighboring moorings, so the dive starts close to the vertical drop that begins from about 24 m (80 ft).",
      marineLife: "Grouper · turtles · rays · jacks",
      marineLifeDescription: "Groupers and jacks hold near the mooring, and rays cross the sand.",
      difficultyLevel: "advanced",
      depthMinMeters: 20,
      maxDepthMeters: 24,
      currentNote:
        "Current not documented; ask the crew on the day. The south side offers diving whichever way the wind blows.",
      divePlan:
        "Down the mooring in 20 m, no deeper than 24 m (80 ft), and back up with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "The mooring already sits at 20 m, so there is little room above the 24 m floor.",
      // Sources put the vertical drop at about 80 ft (24 m) and give no deeper floor; the plan floor is 24 m, the same figure.
      // The wall drops past recreational depth; the plan holds a floor at 24 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["queen-parrotfish", "bluehead-wrasse", "common-sea-fan", "french-angelfish"],
    },
  },
  // Denominator row: Anchor Wall
  {
    slug: "anchor-wall-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
    ],
    briefing: {
      name: "Anchor Wall",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.678,
      forecastLongitude: -79.8837,
      description:
        "A south-side wall named for a huge old anchor wedged in a reef crevice near 27 to 30 m (90 to 100 ft). A swim-through on the inside of the wall runs beneath it; it is overhead, so stay out of it.",
      marineLife: "Sponges · corals · reef fish",
      marineLifeDescription:
        "The wall carries a thick covering of sponges and corals with plenty of fish.",
      difficultyLevel: "advanced",
      depthMinMeters: 23,
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. The south side is usually the sheltered side in north wind.",
      divePlan:
        "Down the mooring to about 23 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "The anchor sits right at the plan floor. Hold 30 m and look from above. The swim-through beneath it is overhead; skip it.",
      // Sources put the anchor at about 90 ft (BSS) or 100 ft (DAN); the plan caps at 30 m. The mooring is in 75 ft.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The anchor",
          kind: "pointOfInterest",
          note: "A large old anchor lodged in the reef near 90 to 100 ft. An overhead swim-through runs beneath it; stay out.",
        },
      ],
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "yellow-tube-sponge",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Wilderness Wall
  {
    slug: "wilderness-wall-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://www.thingstodocayman.net/best-dive-sites-cayman-islands/",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Wilderness Wall",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.7041,
      forecastLongitude: -79.8078,
      description:
        "A south-side drop-off that starts near 15 m (50 ft). Crevices and canyons cut the face, a big pinnacle stands off the wall to form a corridor, and sponges and corals crowd the face in many colors.",
      marineLife: "Nassau grouper · stingrays · angelfish · horse-eye jacks · turtles",
      marineLifeDescription:
        "Larger animals pass along the corridor from deeper water, and stingrays and turtles may swim close.",
      difficultyLevel: "advanced",
      depthMinMeters: 14,
      maxDepthMeters: 30,
      currentNote:
        "There may be more current at the east end of the island than the west. Carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 14 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A wall that drops several hundred feet. Plan to 30 m and no further.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The pinnacle",
          kind: "reefFormation",
          note: "A large coral pinnacle that creates a corridor along the wall.",
        },
      ],
      creatureSlugs: [
        "nassau-grouper",
        "southern-stingray",
        "queen-angelfish",
        "horse-eye-jack",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: East Chute (Cayman Mariner)
  {
    slug: "east-chute-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
      "https://www.scuba-diving-smiles.com/cayman-brac-diving.html",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
      "https://dtmag.com/thelibrary/cayman-brac-a-caribbean-favorite/",
    ],
    briefing: {
      name: "East Chute",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6932,
      forecastLongitude: -79.8901,
      description:
        "Sand chutes lead to a wall with a swim-through; the swim-through is overhead, so stay out of it. The wall top lies near 14 to 15 m (45 to 50 ft). The small Cayman Mariner, a former crew boat, lies in the sand near 17 m (55 ft), now flattened by storms into a debris field with one porthole.",
      marineLife: "Rays · groupers · eels · sponges",
      marineLifeDescription:
        "Sponges, including orange elephant ear, dress the wall, and small animals live around the wreck remains.",
      difficultyLevel: "advanced",
      depthMinMeters: 14,
      maxDepthMeters: 30,
      currentNote: "Little current is reported on Cayman Brac's north side.",
      divePlan:
        "Down the mooring to about 14 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "Stay outside the hull of what remains of the wreck, and out of the wall's swim-through.",
      // DAN puts the wall face at about 70 ft (21 m); other sources put its top at 45 to 50 ft. The range starts at the shallower figure.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Cayman Mariner",
          kind: "wreckFeature",
          note: "A small crew boat, now a debris field with a porthole. Stay outside the hull.",
        },
      ],
      creatureSlugs: [
        "giant-barrel-sponge",
        "orange-elephant-ear-sponge",
        "nassau-grouper",
        "green-moray",
        "southern-stingray",
      ],
    },
  },
  // Denominator row: West Chute
  {
    slug: "west-chute-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
      "https://dan.org/alert-diver/article/cayman-brac/",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
      "https://dtmag.com/thelibrary/cayman-brac-a-caribbean-favorite/",
    ],
    briefing: {
      name: "West Chute",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6919,
      forecastLongitude: -79.8934,
      description:
        "A north-side wall where sand chutes lead to a drop-off starting around 15 m (50 ft). A tall coral pinnacle stands between two edges of the reef wall, and healthy pillar coral grows on the buttresses at 21 to 24 m (70 to 80 ft).",
      marineLife: "Pillar coral · hawksbill turtles · barrel sponges",
      marineLifeDescription: "Hawksbills graze the barrel sponges on the buttresses.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 15 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Chutes make the way down easy. The wall beyond them is not.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The pinnacle",
          kind: "reefFormation",
          note: "A large coral pinnacle between two edges of the wall.",
        },
      ],
      creatureSlugs: ["pillar-coral", "hawksbill-turtle", "giant-barrel-sponge", "common-sea-fan"],
    },
  },
  // Denominator row: Middle Chute
  {
    slug: "middle-chute-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
      "https://dan.org/alert-diver/article/cayman-brac/",
      "https://dtmag.com/thelibrary/cayman-brac-a-caribbean-favorite/",
    ],
    briefing: {
      name: "Middle Chute",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6927,
      forecastLongitude: -79.8914,
      description:
        "Several sandy channels lead to the reef wall and its drop-off. The top of the reef averages about 15 m (50 ft), with many cleaning stations and barrel sponges.",
      marineLife: "Cleaner fish · barrel sponges · reef fish",
      marineLifeDescription:
        "Cleaning stations along the channels are good places to watch fish queue up.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 15 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Sand channels, then a wall. Keep the 30 m floor.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "cleaning-goby",
        "spotted-cleaner-shrimp",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Double Wall
  {
    slug: "double-wall-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
    ],
    briefing: {
      name: "Double Wall",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6907,
      forecastLongitude: -79.8962,
      description:
        "The first wall dive at the north-west end of the island. Barrel sponges and colorful corals draw schools of fish and turtles.",
      marineLife: "Barrel sponges · schooling fish · turtles",
      marineLifeDescription: "Fish gather around the sponges and corals on the face.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A wall dive. The mooring already sits at 18 m (60 ft), so plan the rest with care.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "green-sea-turtle",
        "nassau-grouper",
      ],
    },
  },
  // Denominator row: Fisheries Reef
  {
    slug: "fisheries-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
    ],
    briefing: {
      name: "Fisheries Reef",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6869,
      forecastLongitude: -79.8954,
      description:
        "The most westerly site on the north side. From the mooring a mini wall runs past two sand chutes to a large pillar coral, whose top lies near 9 m (30 ft), with the reef floor at 15 m (50 ft).",
      marineLife: "Pillar coral · reef fish · sponges",
      marineLifeDescription:
        "The pillar coral is the landmark. Check the base for small residents.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 15,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A shallow mini wall and a coral worth the trip.",
      landmarks: [
        {
          name: "Pillar coral",
          kind: "reefFormation",
          note: "A large pillar coral at the end of the mini wall, top near 9 m (30 ft).",
        },
      ],
      creatureSlugs: ["pillar-coral", "common-sea-fan", "bluehead-wrasse", "queen-angelfish"],
    },
  },
  // Denominator row: Lighthouse Reef
  {
    slug: "lighthouse-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
    ],
    briefing: {
      name: "Lighthouse Reef",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.6799,
      forecastLongitude: -79.8875,
      description:
        "Close to the West End dock. The reef top lies near 6 m (20 ft) and the sand floor near 14 to 15 m (45 to 50 ft). There is an outer reef, and an inner reef with several swim-throughs that are overhead; stay out of them.",
      marineLife: "Reef fish · sponges · corals",
      marineLifeDescription:
        "Reef fish gather over the outer and inner reef, and sand lies between them.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 15,
      currentNote:
        "Close to the West End dock, so listen for boat traffic and carry an SMB. Check the entry and the sea first, as the shore here is ironshore. Current not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. A close, shallow reef with room to explore.",
      // Scubago names several swim-throughs on the inner reef but does not describe them as dark. They are overhead and the plan stays outside them, so there is no cavern gate.
      creatureSlugs: ["bluehead-wrasse", "common-sea-fan", "queen-angelfish", "sergeant-major"],
    },
  },
  // Denominator row: Capt. Keith Tibbetts (MV Captain Keith Tibbetts)
  {
    slug: "mv-captain-keith-tibbetts",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/cayman-brac/",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
      "https://bracbeachhouse.com/shore-diving--snorkeling.html",
      "https://dtmag.com/thelibrary/cayman-brac-a-caribbean-favorite/",
      "https://www.scuba-diving-smiles.com/cayman-brac-diving.html",
    ],
    briefing: {
      name: "MV Captain Keith Tibbetts",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6953,
      forecastLongitude: -79.885,
      description:
        "A 100 m (330 ft) Soviet-built frigate, sunk as an artificial reef in 1996. She rests on her port side on a sand slope, the bow rising from about 34 m (110 ft) and the stern deck near 14 m (45 ft). Gun emplacements remain at both ends, and sponges cover the railings.",
      marineLife: "Goliath grouper · barracuda · hawksbill turtles · lionfish",
      marineLifeDescription:
        "Barracuda and a goliath grouper live around the wreck, and the stern deck and guns are the features to look for.",
      difficultyLevel: "advanced",
      depthMinMeters: 14,
      maxDepthMeters: 34,
      currentNote:
        "Storms and surge have twisted and broken the ship, and she has largely collapsed amidships. Stay clear of the collapsed sections and out of the hull. Current not documented; ask the crew on the day.",
      fitTone: "demanding",
      fitNote:
        "Stay outside the hull. The bow slope reaches past 30 m, so this is an Advanced Open Water and Deep specialty dive.",
      // DAN puts the bow rising from about 110 ft (34 m) to 80 ft; other guides say 90 to 100 ft. The deeper figure is taken, and the sand lies at the bottom of that slope. Mooring depths: 50 ft (stern), 80 ft (bow and midships).
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Forward and stern guns",
          kind: "wreckFeature",
          note: "Gun emplacements fore and aft, unusual on a wreck donated by a government.",
        },
        {
          name: "Stern deck",
          kind: "wreckFeature",
          note: "The shallowest part, near 14 m (45 ft), with dense sponges along the railings.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "hawksbill-turtle",
        "lionfish",
        "yellow-tube-sponge",
      ],
    },
  },
  // Denominator row: Grunt Valley
  {
    slug: "grunt-valley-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/cayman-brac/",
    ],
    briefing: {
      name: "Grunt Valley",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.7002,
      forecastLongitude: -79.8743,
      description:
        "High-profile coral heads between 8 and 11 m (25 to 35 ft), crowded with Bermuda chub, grunts and schoolmaster snapper. A good place for a photographer who likes schooling fish.",
      marineLife: "Bermuda chub · grunts · schoolmaster snapper · lobster",
      marineLifeDescription:
        "The schools move together over the heads, and lobster hide in the reef beneath.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 11,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Shallow coral heads and plenty of fish.",
      creatureSlugs: ["bermuda-chub", "french-grunt", "schoolmaster-snapper", "spiny-lobster"],
    },
  },
  // Denominator row: Angel Reef
  // Depth: the plan floor is 18 m; the corals lie at 12 to 15 m and no source gives a drop-off depth.
  {
    slug: "angel-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/cayman-brac/",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
    ],
    briefing: {
      name: "Angel Reef",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.6815,
      forecastLongitude: -79.8745,
      description:
        "A south-side reef with a large stand of pillar coral and some elkhorn. The best of it lies between 12 and 15 m (40 to 50 ft).",
      marineLife: "Pillar coral · elkhorn coral · Nassau grouper",
      marineLifeDescription: "Nassau grouper show up among the corals.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Stay on the reef between 12 and 15 m, and hold no deeper than 18 m (60 ft). The wall beyond is a separate, deeper dive.",
      fitTone: "welcoming",
      fitNote: "Easy reef diving among the corals. The wall beyond is a separate, deeper dive.",
      // Mooring is in 30 ft (9 m); DAN swam the corals at 40 to 50 ft. Brac Scuba Shack lists the site as a wall dive, but no source gives a drop-off depth.
      creatureSlugs: ["pillar-coral", "elkhorn-coral", "nassau-grouper", "common-sea-fan"],
    },
  },
  // Denominator row: Inside Out
  {
    slug: "inside-out-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scuba-diving-smiles.com/cayman-brac-diving.html",
    ],
    briefing: {
      name: "Inside Out",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.6887,
      forecastLongitude: -79.8442,
      description:
        "A section of south-side wall with sand chutes and large sponges. The mooring sits on a coral head, in 15 to 20 m (50 to 65 ft) by two accounts. You can stay there or cross to the wall for a deeper dive. A swim-through on the wall is overhead; stay out of it.",
      marineLife: "Large sponges · sand chutes",
      marineLifeDescription: "Sponges dominate the wall.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day. Carry an SMB.",
      divePlan:
        "Down the mooring to about 15 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Shallow on the coral head or deeper on the wall, which drops past the plan floor.",
      // The only describing report reached 96 ft (29 m) here and put the mooring at 50 ft; the DoE mooring is in 65 ft. The plan floor is 30 m. The swim-through is overhead and not part of the plan.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "yellow-tube-sponge",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Ken's Mountain (Bluff Wall)
  {
    slug: "kens-mountain-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Ken's Mountain",
      locationName: "South-east bluff, Cayman Brac",
      forecastLatitude: 19.7142,
      forecastLongitude: -79.7685,
      description:
        "A bluff-run wall at the east end of the south side, easternmost of three with Son of Rock Monster and Rock Monster Chimney. The wall begins near 18 m (60 ft) with giant sand canyons. Overgrown crevices form swim-through tunnels along it; they are overhead, so stay out of them. Visibility can pass 45 m (150 ft).",
      marineLife: "Wall sponges · reef fish",
      marineLifeDescription: "The wall is the show; look out into the blue as you drift along it.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "There may be more current here than on the west side of the island. Drift the wall, carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "A wall that begins at 18 m (60 ft), with overhead tunnels to stay out of. The mooring is at 60 ft. Ask the crew about current.",
      // The wall begins at about 60 ft (18 m) per DAN. The mooring is in 60 ft.
      // DAN describes this group of bluff sites together (by name) and says overgrown crevices provide swim-through tunnels along the wall, so it is beyond a cavern card: no gate, and the prose says to stay out.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "yellow-tube-sponge",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Son of Rock Monster
  {
    slug: "son-of-rock-monster-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
    ],
    briefing: {
      name: "Son of Rock Monster",
      locationName: "South-east bluff, Cayman Brac",
      forecastLatitude: 19.7139,
      forecastLongitude: -79.7706,
      description:
        "A bluff-run wall at the east end of the south side, the middle of three with Ken's Mountain and Rock Monster Chimney. The wall begins near 18 m (60 ft) with giant sand canyons. Overgrown crevices form swim-through tunnels along it; they are overhead, so stay out of them. Visibility can pass 45 m (150 ft).",
      marineLife: "Wall sponges · reef fish",
      marineLifeDescription: "The wall is the show; look out into the blue as you drift along it.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "There may be more current here than on the west side of the island. Drift the wall, carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "A wall that begins at 18 m (60 ft), with overhead tunnels to stay out of. The mooring is at 62 ft (19 m). Ask the crew about current.",
      // The wall begins at about 60 ft (18 m) per DAN. The mooring is in 62 ft.
      // DAN describes this group of bluff sites together (by name) and says overgrown crevices provide swim-through tunnels along the wall, so it is beyond a cavern card: no gate, and the prose says to stay out.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "yellow-tube-sponge",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Rock Monster Chimney
  {
    slug: "rock-monster-chimney-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Rock Monster Chimney",
      locationName: "South-east bluff, Cayman Brac",
      forecastLatitude: 19.7136,
      forecastLongitude: -79.7741,
      description:
        "A bluff-run wall at the east end of the south side, westernmost of three with Ken's Mountain and Son of Rock Monster. The wall begins near 18 m (60 ft) with giant sand canyons. Overgrown crevices form swim-through tunnels along it; they are overhead, so stay out of them. Visibility can pass 45 m (150 ft).",
      marineLife: "Wall sponges · reef fish",
      marineLifeDescription: "The wall is the show; look out into the blue as you drift along it.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "There may be more current here than on the west side of the island. Drift the wall, carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "The mooring is at 55 ft (17 m), above the wall that begins at 18 m. Stay out of the overhead tunnels. Ask the crew about current.",
      // The wall begins at about 60 ft (18 m) per DAN. The mooring is in 55 ft.
      // DAN describes this group of bluff sites together (by name) and says overgrown crevices provide swim-through tunnels along the wall, so it is beyond a cavern card: no gate, and the prose says to stay out.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "yellow-tube-sponge",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Barracuda Bight
  {
    slug: "barracuda-bight-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=1",
    ],
    briefing: {
      name: "Barracuda Bight",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6798,
      forecastLongitude: -80.0915,
      description:
        "Coral fingers reach out from the wall, with crevices and overhangs underneath. Lobsters, spider crabs and nurse sharks turn up beneath them. It is the next to last site in Bloody Bay.",
      marineLife: "Nurse sharks · lobsters · morays · sailfin blennies",
      marineLifeDescription:
        "Sailfin blennies and juvenile fish fill the shallows, and morays either hide in the overhangs or swim free.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 9 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Fingers and overhangs on the way to a wall. Hold the 30 m floor.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nurse-shark",
        "spiny-lobster",
        "green-moray",
        "sailfin-blenny",
        "spotted-moray",
      ],
    },
  },
  // Denominator row: Bus Stop
  {
    slug: "bus-stop-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=2",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
      "https://www.underwaterphotography.com/Dive-Sites/Dive-Site.aspx?ID=2856",
    ],
    briefing: {
      name: "Bus Stop",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6888,
      forecastLongitude: -80.0708,
      description:
        "Named for the wreck of a school bus on the shore. A sand chute opened in the wall in a December 1989 northwester, and it drops into the deep. The chute is a dark, elbowed passage and overhead; stay out of it. Barrel sponges and Blue Chromis fill the shallow mooring area.",
      marineLife: "Blue chromis · eagle rays · turtles · barrel sponges",
      marineLifeDescription:
        "Check the vase sponges for goby cleaners, crinoids and arrow crabs. Eagle rays, turtles and sharks pass in the blue.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 11 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "The chute is a dark overhead passage. Stay out of it and dive the open wall.",
      // The chute is described as a dark tunnel that elbows and opens on the wall near 100 ft (30 m); the plan floor is 30 m.
      // Sources describe tunnels or enclosed passages through the wall, so it is beyond a cavern card: no gate, and the prose says to stay out. They are optional; the plan itself stops at 30 m.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "blue-chromis",
        "giant-barrel-sponge",
        "spotted-eagle-ray",
        "green-sea-turtle",
        "arrow-crab",
      ],
    },
  },
  // Denominator row: Blacktip Blvd.
  {
    slug: "blacktip-boulevard-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=4",
    ],
    briefing: {
      name: "Blacktip Boulevard",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6863,
      forecastLongitude: -80.0749,
      description:
        "Named for blacktip sharks, which are seen here only now and then. The mooring sits at the inner edge of the wall reef, which slopes gently to the drop-off, with sand grooves between. Caribbean reef sharks and eagle rays are the likelier sightings.",
      marineLife: "Caribbean reef sharks · eagle rays · garden eels · lobsters",
      marineLifeDescription:
        "Squirrelfish and lobsters sit in the deep crevices, and garden eels retreat into the sand as you approach.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Sharks are possible, not promised. The mooring is already at 18 m (60 ft).",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "spotted-eagle-ray",
        "garden-eel",
        "spiny-lobster",
        "squirrelfish",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Coconut Wall
  {
    slug: "coconut-wall-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=5",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
    ],
    briefing: {
      name: "Coconut Wall (Coconut Walk)",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6808,
      forecastLongitude: -80.0898,
      description:
        "Toward the west end of the Bloody Bay Wall, a smaller wall split in two: a mini wall at 9 m (30 ft) and the main wall at 18 m (60 ft). A large stand of pillar coral draws turtles and stingrays. Tunnels cut through the outcroppings and are overhead; stay out of them. Large barrel sponges grow past 18 m (60 ft).",
      marineLife: "Pillar coral · turtles · stingrays · angelfish",
      marineLifeDescription:
        "Gray, queen and French angelfish and parrotfish work the mini wall. Reef sharks cruise off the main wall.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 9 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "The pillar coral is slow growing and delicate, so keep your fins clear. The tunnels are overhead; stay out of them.",
      // The older Little Cayman Beach Resort page describes many tunnels through the outcroppings, so it is beyond a cavern card: no gate, and the prose says to stay out.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "pillar-coral",
        "green-sea-turtle",
        "southern-stingray",
        "french-angelfish",
        "giant-barrel-sponge",
        "caribbean-reef-shark",
      ],
    },
  },
  // Denominator row: Cascades
  {
    slug: "cascades-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=13",
      "https://blog.padi.com/best-dive-sites-in-the-cayman-islands/",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
    ],
    briefing: {
      name: "Cascades",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6964,
      forecastLongitude: -80.0687,
      description:
        "The first and most northern site in the Jackson Point area, a long way out. Mini walls step down toward an area called La La Land, with coral heads like small mountain ranges. The last wall starts near 22 m (75 ft) and drops far past the plan.",
      marineLife: "Turtles · sharks · eagle rays · stingrays",
      marineLifeDescription:
        "Conch sit on the sand, and the coral heads suit wide-angle photographs.",
      difficultyLevel: "advanced",
      depthMinMeters: 17,
      maxDepthMeters: 30,
      currentNote:
        "The deeper wall is often paired with a current. Carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 17 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "A long ride out, and a deep wall that often carries current. The mooring is already at 17 m (55 ft).",
      // PADI puts the last wall at 22 m (75 ft) and deeper, often with a current, and tells divers to hold the Advanced certificate.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "caribbean-reef-shark",
        "spotted-eagle-ray",
        "southern-stingray",
        "queen-conch",
      ],
    },
  },
  // Denominator row: Mike's Mountain
  {
    slug: "mikes-mountain-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=17",
    ],
    briefing: {
      name: "Mike's Mountain",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6928,
      forecastLongitude: -80.0691,
      description:
        "A site with history: a small cannon, and many anchors that have taken on the look of the reef. Tunnels run through the wall to the deep and are overhead; stay out of them. A second cannon lies in the shallows.",
      marineLife: "Sharks · turtles · eagle rays · queen triggerfish",
      marineLifeDescription:
        "Friendly queen triggerfish and French angelfish keep company, and groupers show up too.",
      difficultyLevel: "advanced",
      depthMinMeters: 8,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 8 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Look for the cannon and anchors. Stay out of the tunnels.",
      // Sources describe tunnels or enclosed passages through the wall, so it is beyond a cavern card: no gate, and the prose says to stay out. They are optional; the plan itself stops at 30 m.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Cannons and anchors",
          kind: "pointOfInterest",
          note: "A small cannon, a second in the shallows, and several anchors overgrown to blend in.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-shark",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "queen-triggerfish",
        "french-angelfish",
        "nassau-grouper",
      ],
    },
  },
  // Denominator row: Sarah's Set
  {
    slug: "sarahs-set-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=18",
    ],
    briefing: {
      name: "Sarah's Set",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6874,
      forecastLongitude: -80.0726,
      description:
        "A site for deep or shallow diving: follow the drop-off, or wander the canyons and sand flats behind it. Tunnels open onto the wall and are overhead; stay out of them.",
      marineLife: "French angelfish · queen triggerfish · eagle rays · sharks",
      marineLifeDescription:
        "Jawfish and sand tilefish live in the rubble, and sharks, rays and turtles pass from time to time.",
      difficultyLevel: "advanced",
      depthMinMeters: 8,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 8 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "You choose how deep to go. Hold the 30 m floor.",
      // Sources describe tunnels or enclosed passages through the wall, so it is beyond a cavern card: no gate, and the prose says to stay out. They are optional; the plan itself stops at 30 m.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "french-angelfish",
        "queen-triggerfish",
        "spotted-eagle-ray",
        "southern-stingray",
        "yellowhead-jawfish",
        "sand-tilefish",
      ],
    },
  },
  // Denominator row: The Meadows
  {
    slug: "the-meadows-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=19",
      "https://www.scubadiving.com/10-reasons-why-scuba-divers-love-little-cayman",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
    ],
    briefing: {
      name: "The Meadows",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6926,
      forecastLongitude: -80.0685,
      description:
        "Deep or shallow, your choice. Canyons and sand flats lie behind the drop-off, and tunnels open onto the wall; they are overhead, so stay out of them. The shallow part bottoms out near 11 m (35 ft), with coral heads, razorfish, garden eels and rays.",
      marineLife: "French angelfish · queen triggerfish · razorfish · rays",
      marineLifeDescription:
        "Jawfish and sand tilefish live in the rubble, and garden eels sink into the sand as you approach.",
      difficultyLevel: "advanced",
      depthMinMeters: 8,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 8 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A shallow garden in front of a wall. Stay in the garden for a relaxed tank.",
      // The shallow part bottoms out near 35 ft (11 m) per Scuba Diving magazine; Little Cayman Beach Resort also describes the drop-off, so the range runs to the 30 m plan floor.
      // Sources describe tunnels or enclosed passages through the wall, so it is beyond a cavern card: no gate, and the prose says to stay out. They are optional; the plan itself stops at 30 m.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "french-angelfish",
        "queen-triggerfish",
        "green-razorfish",
        "garden-eel",
        "southern-stingray",
        "yellowhead-jawfish",
      ],
    },
  },
  // Denominator row: Joy's Joy
  {
    slug: "joys-joy-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=10",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
    ],
    briefing: {
      name: "Joy's Joy",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6788,
      forecastLongitude: -80.093,
      description:
        "The last Bloody Bay site, with coral fingers and a mini wall that starts near 8 m (25 ft) and slopes to the drop-off. Nooks and crannies hold lobsters and morays. Caverns and swim-throughs along the wall are overhead; stay out of them.",
      marineLife: "Spiny lobster · eagle rays · morays · snapper",
      marineLifeDescription:
        "Spiny, rock and slipper lobsters hide here, and yellowtail snapper and bluestriped grunts school over the fingers.",
      difficultyLevel: "advanced",
      depthMinMeters: 8,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 8 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A gentle start that leads to a wall with overhead caverns. Stay out of them.",
      // Sources describe tunnels or enclosed passages through the wall, so it is beyond a cavern card: no gate, and the prose says to stay out. They are optional; the plan itself stops at 30 m.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spiny-lobster",
        "slipper-lobster",
        "spotted-eagle-ray",
        "green-moray",
        "yellowtail-snapper",
        "bluestriped-grunt",
      ],
    },
  },
  // Denominator row: Paul's Anchor
  {
    slug: "pauls-anchor-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com:80/html_docs/dive-sites.htm",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
    ],
    briefing: {
      name: "Paul's Anchors",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6944,
      forecastLongitude: -80.0694,
      description:
        "A gently sloping drop-off with rubble and many anchors. One stands about 3 m (10 ft) tall with a large rope ring at the top.",
      marineLife: "Turtles · sharks · green morays · eagle rays",
      marineLifeDescription:
        "Sand tilefish, octopus and yellowhead jawfish live in the rubble around the anchors.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 12 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Come for the anchors, which make a fine photo backdrop.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The anchors",
          kind: "pointOfInterest",
          note: "Several old anchors, one about 3 m (10 ft) tall with a large rope ring at the top.",
        },
      ],
      creatureSlugs: [
        "sand-tilefish",
        "yellowhead-jawfish",
        "green-moray",
        "spotted-eagle-ray",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Jackson Reef & Wall
  {
    slug: "jackson-reef-and-wall-little-cayman",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/LITTLE-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/2026/http://littlecayman.com/divesites/index.php?id=16",
      "https://web.archive.org/web/2026/https://www.littlecayman.com/blog/find-out-why-these-are-some-of-our-staffs-favorite-dives/",
      "https://activecaribbeantravel.com/cayman-islands-diving-little-cayman-dive-sites/",
    ],
    briefing: {
      name: "Jackson's Reef and Wall",
      locationName: "Bloody Bay Marine Park, Little Cayman",
      forecastLatitude: 19.6907,
      forecastLongitude: -80.0694,
      description:
        "On the north side off Jackson's Point in Jackson's Bight. The reef lies in 8 to 14 m (25 to 45 ft), and the wall below has its top near 15 m (50 ft), with wide views. Swim-throughs off the deeper wall are overhead; stay out of them.",
      marineLife: "Turtles · stingrays · horse-eye jacks · garden eels",
      marineLifeDescription:
        "Tarpon, eagle rays and sometimes sharks pass the wall, with moray eels, jawfish and, at night, octopus around the rubble.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 6 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "A kind reef in front of a real wall. The floor is the plan's; skip the swim-throughs.",
      // The mooring is in 20 ft (6 m); the reef is described at 25 to 45 ft and the wall top near 50 ft.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "southern-stingray",
        "horse-eye-jack",
        "garden-eel",
        "spotted-eagle-ray",
        "green-moray",
      ],
    },
  },
  // Denominator row: Tarpon Reef
  {
    slug: "tarpon-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
      "https://dtmag.com/thelibrary/cayman-brac-a-caribbean-favorite/",
    ],
    briefing: {
      name: "Tarpon Reef",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.6798,
      forecastLongitude: -79.8891,
      description:
        "A medium-depth spur and groove reef where a few dozen tarpon hang in groups among the crevices by day. A knoll of pillar coral stands close by, with elkhorn and star coral. Sand gullies run to about 15 m (50 ft) between ridges whose crests come within 6 m (20 ft) of the surface.",
      marineLife: "Tarpon · pillar coral · nurse sharks · parrotfish",
      marineLifeDescription:
        "Move toward the tarpon slowly and they stay put. Nurse sharks sometimes sit in the undercuts, and a barracuda may pass.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 15,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Visibility here varies, so ask the crew on the day.",
      creatureSlugs: [
        "tarpon",
        "pillar-coral",
        "elkhorn-coral",
        "great-star-coral",
        "nurse-shark",
        "great-barracuda",
      ],
    },
  },
  // Denominator row: Gilimbo Wall (Gillembo)
  {
    slug: "gilimbo-wall-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Gilimbo Wall (Gillembo)",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.7025,
      forecastLongitude: -79.8101,
      description:
        "A south-side wall named for the local word for the super-male rainbow parrotfish. The mooring is in 18 to 20 m (60 to 65 ft). South of it the wall drops sheer toward the Cayman Trench, and to the north a clean reef sits at 12 to 14 m (40 to 45 ft).",
      marineLife: "Rainbow parrotfish · sponges · gorgonians",
      marineLifeDescription: "The reef north of the mooring is a calmer alternative to the wall.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "There may be more current at the east end of the island than the west. Carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A sheer wall that falls well past the plan. Hold 30 m, or take the north reef.",
      // The mooring is 60 ft (Brac Reef) or 65 ft (DoE); the deeper figure is taken.
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "rainbow-parrotfish",
        "common-sea-fan",
        "giant-barrel-sponge",
        "yellow-tube-sponge",
      ],
    },
  },
  // Denominator row: Treehouse Reef
  {
    slug: "treehouse-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
      "https://dan.org/alert-diver/article/cayman-brac/",
    ],
    briefing: {
      name: "Treehouse Reef",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.7101,
      forecastLongitude: -79.8437,
      description:
        "A wide spur and groove reef in Stake Bay. Two pinnacles beneath the boat rise to about 4.5 m (15 ft), and the reef forms a bowl with a wide sandy area.",
      marineLife: "Green moray · Nassau grouper · nurse sharks",
      marineLifeDescription:
        "Ledges hold groupers, eels and nurse sharks. A green moray swims free and can be bold with divers.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 10,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Shallow, structured and calm.",
      // The pinnacles reach about 15 ft; the DoE mooring is in 32 ft (9.8 m).
      creatureSlugs: ["green-moray", "nassau-grouper", "nurse-shark", "common-sea-fan"],
    },
  },
  // Denominator row: Lynn's Reef
  {
    slug: "lynns-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Lynn's Reef",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.7138,
      forecastLongitude: -79.8366,
      description:
        "A spur and groove reef in Stake Bay, running from 8 to 18 m (25 to 60 ft). A good place for gorgonians and soft corals.",
      marineLife: "Juvenile spotted drums · reef squid · gorgonians",
      marineLifeDescription:
        "Juvenile spotted drums hide in the coral, and squid school over the reef.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A shallow reef with soft coral cover.",
      creatureSlugs: [
        "spotted-drum",
        "caribbean-reef-squid",
        "common-sea-fan",
        "encrusting-gorgonian",
      ],
    },
  },
  // Denominator row: Tombstone
  {
    slug: "tombstone-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Tombstone",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6946,
      forecastLongitude: -79.8817,
      description:
        "A shallow spot starting at 8 m (25 ft), in front of Scott's Cemetery. A sand plain beyond the mooring is loaded with rays and garden eels, and a patch under the boat called the Lobster Hotel holds four or five spotted lobsters.",
      marineLife: "Southern stingrays · eagle rays · garden eels · lobsters",
      marineLifeDescription:
        "The sand plain is the show. Keep a respectful distance from the eels.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 11,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Easy and shallow.",
      creatureSlugs: [
        "southern-stingray",
        "spotted-eagle-ray",
        "garden-eel",
        "spotted-spiny-lobster",
      ],
    },
  },
  // Denominator row: Snapper Point
  {
    slug: "snapper-point-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.scubago.com/en/explore/destination/cayman-brac-9750202",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Snapper Point",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.681,
      forecastLongitude: -79.8972,
      description:
        "A finger-formation reef past the western point, with a mini wall and isolated coral heads. The tops of the fingers lie near 9 m (30 ft), sand channels run between them, and the deepest point is about 21 m (70 ft).",
      marineLife: "Soft corals · parrotfish · Nassau grouper",
      marineLifeDescription:
        "Blue and midnight parrotfish favor the mini wall, and the outer coral heads hold Nassau groupers.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 21,
      currentNote:
        "There is often current here. Carry an SMB and ask the boat crew about it on the day.",
      fitTone: "demanding",
      fitNote: "Current and a floor past 18 m make this a step up from the shallow reefs.",
      // Sources give a maximum of 70 ft (21 m) and often current, so the site is gated Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["blue-parrotfish", "midnight-parrotfish", "nassau-grouper", "common-sea-fan"],
    },
  },
  // Denominator row: Bert Brothers Boulders
  {
    slug: "bert-brothers-boulders-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divein.com/diving/destination/cayman-islands/",
      "https://bracbeachhouse.com/shore-diving--snorkeling.html",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
      "https://blog.padi.com/best-dive-sites-in-the-cayman-islands/",
    ],
    briefing: {
      name: "Bert Brothers Boulders",
      locationName: "North-east end, Cayman Brac",
      forecastLatitude: 19.7582,
      forecastLongitude: -79.7409,
      description:
        "Closely packed ridges form large coral heads between the shore and the reef wall. Elkhorn coral tops the ridges, with gorgonians, tube sponges and hard corals in the gullies. Swim-throughs and undercuts let sunlight fall to the sand; they are overhead, so stay out of them. A large green moray has long lived here.",
      marineLife: "Flamingo tongues · flying gurnards · green moray · lobsters",
      marineLifeDescription:
        "Flamingo tongues sit on the sea fans in the shallows. Flying gurnards turn up near 5.5 m (18 ft), and jewfish in the ridges and gullies.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote:
        "Check the entry and the sea first; the east end is exposed to surf and may carry more current than the west. Carry an SMB.",
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. Check conditions with the guide before entering. Shallow ridges and gullies, with more surf at the east end.",
      // The mooring is in 20 ft; sources reach 60 ft toward the wall, with an average of 40 ft (12 m).
      creatureSlugs: [
        "flamingo-tongue",
        "green-moray",
        "spiny-lobster",
        "elkhorn-coral",
        "yellow-tube-sponge",
      ],
    },
  },
  // Denominator row: Greenhouse Reef
  {
    slug: "greenhouse-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
      "https://bracbeachhouse.com/shore-diving--snorkeling.html",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://www.divein.com/diving/destination/cayman-islands/",
    ],
    briefing: {
      name: "Greenhouse Reef",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.7203,
      forecastLongitude: -79.8283,
      description:
        "A spur and groove reef with ledges and overhangs, also called Screensaver Reef. The mooring is in about 6 m (20 ft), and the reef runs toward the wall to 18 m (60 ft).",
      marineLife: "Flamingo tongues · morays · turtles · squid",
      marineLifeDescription:
        "Flamingo tongues sit on purple sea fans at 6 to 9 m (20 to 30 ft). Schooling squid hover near the mooring, and schoolmaster snapper sit under the ledges.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A medium-depth reef with lots to see.",
      creatureSlugs: [
        "flamingo-tongue",
        "arrow-crab",
        "caribbean-reef-squid",
        "green-sea-turtle",
        "schoolmaster-snapper",
      ],
    },
  },
  // Denominator row: Radar Reef
  {
    slug: "radar-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://bracbeachhouse.com/shore-diving--snorkeling.html",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Radar Reef",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.7159,
      forecastLongitude: -79.8339,
      description:
        "A spur and groove reef off Stake Bay, interesting between 12 and 15 m (40 to 50 ft) and shallower. The reef reaches 18 to 20 m (60 to 65 ft). An artist's sculpture city called Atlantis lies in the sand nearby.",
      marineLife: "Lettuce sea slugs · coral banded shrimp · arrow crabs · eagle rays",
      marineLifeDescription:
        "A cable along the sand carries small animals, and rays and squid feed in the sand at night.",
      difficultyLevel: "intermediate",
      depthMinMeters: 8,
      maxDepthMeters: 20,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Easy navigation on spurs, shallow and rich in small life.",
      // Shore-entry description (BBH) and the Brac Reef list are used for the reef; the DoE mooring is in 25 ft.
      landmarks: [
        {
          name: "Atlantis",
          kind: "underwaterMonument",
          note: "A set of sculptures in the sand beside the reef, in about 12 to 15 m (40 to 50 ft).",
        },
      ],
      creatureSlugs: [
        "lettuce-sea-slug",
        "banded-coral-shrimp",
        "arrow-crab",
        "spotted-eagle-ray",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: Charlie's Reef
  {
    slug: "charlies-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://bracbeachhouse.com/shore-diving--snorkeling.html",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
      "https://xray-mag.com/content/cayman-brac-best-shore-diving-caribbean",
    ],
    briefing: {
      name: "Charlie's Reef",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6973,
      forecastLongitude: -79.8777,
      description:
        "A shallow spur and groove reef at 12 to 15 m (40 to 50 ft), beside a wall that starts fairly close to shore. A large Nassau grouper named Charlie moves between this reef and the Kissimmee.",
      marineLife: "Nassau grouper · eagle rays · juveniles",
      marineLifeDescription:
        "Nassau grouper and eagle rays work the reef, with juveniles in the coral.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Stay on the reef at 12 to 15 m and hold no deeper than 18 m (60 ft). The wall nearby is a separate, deeper dive.",
      fitTone: "welcoming",
      fitNote: "Shallow reef diving. The wall nearby is a separate, deeper dive.",
      // The moorings reach a maximum of 60 ft (18 m).
      creatureSlugs: ["nassau-grouper", "spotted-eagle-ray", "common-sea-fan", "bluehead-wrasse"],
    },
  },
  // Denominator row: Cemetery Wall
  {
    slug: "cemetery-wall-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://bracbeachhouse.com/shore-diving--snorkeling.html",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://web.archive.org/web/20130615204627/http://www.bracreef.com/diveSites.html",
    ],
    briefing: {
      name: "Cemetery Wall",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6985,
      forecastLongitude: -79.878,
      description:
        "A wall east of the jetty near Scott's Cemetery, a spur and groove system with wide sand channels. The wall begins around 18 m (60 ft) and then drops away.",
      marineLife: "Reef fish · wall sponges",
      marineLifeDescription: "Wide sand channels lead out to the edge of the wall.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote:
        "Shore entry near the jetty: check the sea and the ironshore before you enter. Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 15 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A wall that begins at 18 m (60 ft). Hold the plan floor.",
      // The wall drops past 30 m; the plan holds a floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "yellow-tube-sponge",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Kissimmee (wreck)
  {
    slug: "kissimmee-wreck-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.bracscubashack.com/scuba-diving/wall-diving/",
      "https://dan.org/alert-diver/article/caymans-sister-islands/",
      "https://bracbeachhouse.com/shore-diving--snorkeling.html",
      "https://xray-mag.com/content/cayman-brac-best-shore-diving-caribbean",
    ],
    briefing: {
      name: "Kissimmee",
      locationName: "North side, Cayman Brac",
      forecastLatitude: 19.6959,
      forecastLongitude: -79.8802,
      description:
        "A retired tug sunk in 1982 to add to the reef. She lies nearly upside down on the sand near 12 to 14 m (40 to 45 ft). The wall nearby is a separate, deeper dive.",
      marineLife: "Eagle rays · turtles · cleaner fish",
      marineLifeDescription:
        "Eagle rays and turtles pass around the wreck, and cleaning stations hold small animals.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Stay at the wreck and on the sand beside it, and hold no deeper than 18 m (60 ft). Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "Stay outside the hull. The wreck lies near 12 to 14 m (40 to 45 ft) and the moorings here reach about 18 m (60 ft).",
      creatureSlugs: [
        "spotted-eagle-ray",
        "green-sea-turtle",
        "cleaning-goby",
        "spotted-cleaner-shrimp",
      ],
    },
  },
  // Denominator row: Public Beach Reef
  // Depth: the plan floor is 18 m; the sources put most of the dive at 9 to 14 m and say the tiers run past 30 m, so the ceiling is 30 m.
  {
    slug: "public-beach-reef-cayman-brac",
    version: 1,
    area: "cayman-sister-islands",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/CAYMAN-BRAC-PUBLIC-MOORINGS-2023.xlsx",
      "https://bracbeachhouse.com/shore-diving--snorkeling.html",
      "https://xray-mag.com/content/cayman-brac-best-shore-diving-caribbean",
    ],
    briefing: {
      name: "Public Beach Reef",
      locationName: "South side, Cayman Brac",
      forecastLatitude: 19.6902,
      forecastLongitude: -79.845,
      description:
        "A south-shore reef reached through a cut in front of the picnic cabanas. Spur and groove coral, with most of the dive between 9 and 14 m (30 to 45 ft). The reef steps down in tiers to over 30 m (100 ft), deeper beyond the plan.",
      marineLife: "Juvenile fish · lobsters · eels · stingrays",
      marineLifeDescription: "A good place for juveniles, lobsters, crabs, eels and stingrays.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 30,
      currentNote:
        "Shore entry through a cut across the surf zone: check the sea first and plan to exit at the same cut. Current not documented; ask the crew on the day.",
      divePlan:
        "Stay in the shallow tiers, most of the dive between 9 and 14 m, and hold no deeper than 18 m (60 ft). The tiers continue deeper beyond the plan, to over 30 m.",
      fitTone: "unknown",
      fitNote:
        "Check conditions with the guide before entering. Entry is across the surf zone, so check the sea first.",
      // BBH says a diver can do 'anything from 10 ft on up', with most of the dive in 30 to 45 ft. Xray-mag says the tiers run to over 30 m (100 ft), so maxDepthMeters is 30 and the site stays ungated at the ceiling; the plan stays in the shallow tiers.
      creatureSlugs: ["spiny-lobster", "southern-stingray", "green-moray", "common-sea-fan"],
    },
  },
];
