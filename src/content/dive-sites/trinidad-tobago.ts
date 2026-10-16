// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Tobago and Trinidad. */
export const TRINIDAD_TOBAGO: DiveSiteTemplate[] = [
  {
    slug: "arnos-vale-reef-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://rseadivers.com/dive-sites/",
      "https://www.tobagoscubadiving.com/diving.html",
      "https://world.dan.org/?p=26012",
    ],
    briefing: {
      // Approximate pin: R and Sea places the site north of Plymouth (geocoded 11.2200,-60.7738, OpenStreetMap Nominatim); pinned in the water about 800 m north-northwest of the village. Good to about 2 km. Depth: sources give 13 m, 14 m and 20 m (65 ft, DAN); the deepest is taken.
      name: "Arnos Vale Reef",
      locationName: "Plymouth, Tobago",
      forecastLatitude: 11.227,
      forecastLongitude: -60.779,
      description:
        "A shallow rocky shelf north of Plymouth on Tobago's Caribbean side, with small coral outcrops and plenty of young reef life among the rocks.",
      marineLife: "Spiny lobster · moray eels · stingrays · barracuda",
      marineLifeDescription:
        "Lobster and eels use the nooks between the rocks, and rays rest on the sand. Some of those rays are electric rays.",
      difficultyLevel: "intermediate",
      depthRange: "6–20 m (20–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Minimal on the Caribbean side. Electric rays rest in the sand and can shock a diver who touches the sand beside them, so keep hands and fins off it.",
      divePlan:
        "Work slowly along the rocks and outcrops, look into the gaps rather than over them, and stay out of the sand near resting rays.",
      fitTone: "welcoming",
      fitNote:
        "Calm and slow, and good for a diver who likes searching the rocks for small things.",
      creatureSlugs: [
        "spiny-lobster",
        "spotted-moray",
        "great-barracuda",
        "southern-stingray",
        "french-grunt",
      ],
    },
  },
  {
    slug: "kariwak-reef-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://divemagazine.com/scuba-diving-travel/tobagos-best-entry-level-dive-sites",
      "https://rseadivers.com/dive-sites/",
    ],
    briefing: {
      // The busy-beach line follows the domain review; the sources do not document traffic, so the conservative reading is written. Approximate pin: the reef lies off Store Bay (Divemag), about 35 m (120 ft) off; pinned in the water off the beach (geocoded 11.1560,-60.8399, OpenStreetMap Nominatim). Good to about 2 km. Entry (shore or boat) is as the source states.
      name: "Kariwak Reef",
      locationName: "Store Bay, Tobago",
      forecastLatitude: 11.156,
      forecastLongitude: -60.8412,
      description:
        "A colorful sloping reef off Store Bay at Tobago's south end, popular for training, night dives and photography.",
      marineLife: "Barracuda · eagle rays · groupers · moray eels",
      marineLifeDescription:
        "Groupers and eels use the reef, barracuda cruise the edge, and flying gurnards turn up on the sand.",
      difficultyLevel: "beginner",
      depthRange: "3–17 m (10–55 ft)",
      maxDepthMeters: 17,
      currentNote:
        "Busy beach: boats and snorkelers; no ascent without an SMB. Sources describe little or no current. Shore or boat entry; the sources name no entry hazard, so ask the crew about the entry on the day.",
      divePlan:
        "Follow the slope at your own pace, turn on the gas you set at the start, and take a safety stop in open water under your SMB. On a night dive, carry a primary and a backup light and a surface light for the SMB.",
      fitTone: "welcoming",
      fitNote: "Gentle, easy to navigate and good for new divers and night dives.",
      creatureSlugs: [
        "great-barracuda",
        "spotted-eagle-ray",
        "coney",
        "green-moray",
        "bluehead-wrasse",
        "flying-gurnard",
      ],
    },
  },
  {
    slug: "mv-maverick-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://www.discovertnt.com/articles/tobago/diving-kingdom-of-the-corals/",
      "https://www.tobagoscubadiving.com/diving.html",
      "https://world.dan.org/?p=26012",
      "https://rseadivers.com/dive-sites/",
    ],
    briefing: {
      // Approximate pin: the wreck lies off Mount Irvine (all sources; one says 100 ft off Mount Irvine Point); pinned about 350 m west of Mount Irvine Bay beach (geocoded 11.1936,-60.7955, OpenStreetMap Nominatim) and more than 400 m from the Mount Irvine pins. Good to about 2 km. Gate: more than 30 m, so Advanced Open Water and Deep. Sources say the wreck sits at 33 m and her sand is not described deeper.
      name: "MV Maverick",
      locationName: "Mount Irvine, Tobago",
      forecastLatitude: 11.1925,
      forecastLongitude: -60.799,
      description:
        "A former passenger and car ferry, the first on the Trinidad to Tobago run, sunk upright as a dive site in 1997. Her upper deck is at 18 m and the wreck rests at 33 m.",
      marineLife: "Snappers · rainbow runners · sweepers · jacks",
      marineLifeDescription:
        "Snappers and rainbow runners shelter around the car deck, and baitfish swirl over the upper deck. The car deck is overhead; stay out.",
      difficultyLevel: "advanced",
      depthRange: "18–33 m (60–100 ft)",
      maxDepthMeters: 33,
      currentNote: "Usually little, but it can pick up at depth. Carry an SMB.",
      divePlan:
        "The boat ties up at a mooring buoy, one of the few in Tobago. Descend the mooring line to the upper deck at about 18 m, go along the outside of the hull and back up with reserve gas. Watch time and depth. The car deck is overhead; stay out. Stay outside the hull. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep wreck dive that asks for depth control and tidy buoyancy.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "schoolmaster-snapper",
        "glassy-sweeper",
        "horse-eye-jack",
        "common-sea-fan",
        "orange-cup-coral",
        "rainbow-runner",
      ],
    },
  },
  {
    slug: "mount-irvine-wall-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://www.underseatobago.com/tobago-dive-sites/caribbean-coast/mt-irvine-wall",
      "https://rseadivers.com/dive-sites/",
      "https://world.dan.org/?p=26012",
      "https://divemagazine.com/scuba-diving-travel/tobagos-best-entry-level-dive-sites",
    ],
    briefing: {
      // Approximate pin: a rock outcrop between Mount Irvine and Stone Haven bays (Tropical Sky, Undersea Tobago); pinned in the water between the two bay beaches (geocoded 11.1936,-60.7955 and 11.2034,-60.7876, OpenStreetMap Nominatim). Good to about 2 km. Depth: sources give 5.5 to 15 m; R and Sea gives 18 m (60 ft), the deepest.
      name: "Mount Irvine Wall",
      locationName: "Mount Irvine Bay, Tobago",
      forecastLatitude: 11.2,
      forecastLongitude: -60.799,
      description:
        "A shallow wall of sponge and coral along the rocky outcrop in Mount Irvine Bay, with canyons, cracks and ledges that hold small animals.",
      marineLife: "Queen angelfish · seahorses · spiny lobster · moray eels",
      marineLifeDescription:
        "Cracks and ledges hold lobster, eels and shrimp, and queen angelfish patrol the face.",
      difficultyLevel: "beginner",
      depthRange: "8–18 m (25–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Little or none on the Caribbean side. Surge moves through the shallows above about 6 m, so stay low on the wall.",
      divePlan:
        "Swim along the wall at mid-depth, look into the cuts and ledges, and finish up the slope with a safety stop. Hold the stop at 5 m even in surge.",
      fitTone: "welcoming",
      fitNote: "A mellow wall with small things in every crack.",
      creatureSlugs: [
        "queen-angelfish",
        "longsnout-seahorse",
        "spiny-lobster",
        "spotted-moray",
        "banded-coral-shrimp",
      ],
    },
  },
  {
    slug: "mount-irvine-extension-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://www.underseatobago.com/tobago-dive-sites/caribbean-coast/mt-irvine-wall",
      "https://rseadivers.com/dive-sites/",
      "https://dan.org/?p=21155",
      "https://divemagazine.com/scuba-diving-travel/tobagos-best-entry-level-dive-sites",
    ],
    briefing: {
      // Approximate pin: the Extension begins where the Wall ends and curves west as it deepens (R and Sea); pinned about 350 m west of the Wall pin. Good to about 2 km. Depth: the Wall ends near 18 m (60 ft), and DAN says the reef levels to sand at 24 m (80 ft); Undersea Tobago calls the Extension the deeper section.
      name: "Mount Irvine Extension",
      locationName: "Mount Irvine Bay, Tobago",
      forecastLatitude: 11.1995,
      forecastLongitude: -60.8025,
      description:
        "The deeper reef that begins where Mount Irvine Wall ends. It curves west as it deepens, then levels to sand, with a big coral reef sheltering tarpon, eagle rays and hawksbill turtles.",
      marineLife: "Tarpon · spotted eagle rays · hawksbill turtles · yellowhead jawfish",
      marineLifeDescription:
        "Tarpon feed near the surface, jawfish live in the rubble, and rays and turtles pass over the coral. Black coral grows here and is protected.",
      difficultyLevel: "advanced",
      depthRange: "18–24 m (60–80 ft)",
      maxDepthMeters: 25,
      currentNote: "Little or none on the Caribbean side; visibility can drop in places.",
      divePlan:
        "Follow the reef west as it deepens, level off at the sand edge, and keep clear of the black coral. Finish with a safety stop and reserve gas.",
      fitTone: "demanding",
      fitNote: "A step deeper than the Wall, from 18 m down, with bigger animals.",
      // Advanced Open Water because the whole Extension lies at 18-24 m, below an 18 m Open Water turn.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "tarpon",
        "spotted-eagle-ray",
        "hawksbill-turtle",
        "yellowhead-jawfish",
        "black-coral",
      ],
    },
  },
  {
    slug: "the-sisters-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://www.underseatobago.com/tobago-dive-sites/caribbean-coast/the-sisters",
      "https://www.eric-tobago.org/dive-sites-and-species",
      "https://rseadivers.com/dive-sites/",
      "https://www.tropicalsky.co.uk/caribbean-holidays/tobago/the-best-dive-sites-in-tobago",
      "https://dan.org/?p=21155",
      "https://www.divein.com/diving/destination/diving-in-tobago/",
    ],
    briefing: {
      // Approximate pin: a line of rocks about 1.5 miles (2.4 km) off Englishman's Bay on the north coast (Tropical Sky, R and Sea, Undersea Tobago); pinned about 1.6 km offshore of the bay beach (geocoded 11.2901,-60.6710, OpenStreetMap Nominatim). Good to about 2 km. Gate: the pinnacles fall past recreational depth (Undersea gives 40 to 130 ft, ERIC over 40 m), so the plan holds a 30 m floor and the site is gated Advanced Open Water for the drop-off, the exposure and the surge, not for the depth figure.
      name: "The Sisters",
      locationName: "Englishman's Bay, Tobago",
      forecastLatitude: 11.305,
      forecastLongitude: -60.6715,
      description:
        "Rock pinnacles off Tobago's northwest coast. The north and west faces are sheer and fall away past recreational depth; the landward east side is a shallower coral reef.",
      marineLife:
        "Hammerhead sharks (seasonal) · hawksbill turtles · lobster · schooling reef fish",
      marineLifeDescription:
        "Hammerheads are seen most from December to March, and are not guaranteed. Brown chromis, creole wrasse and durgeons crowd the reef on the east side.",
      difficultyLevel: "advanced",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Exposed to swell and surge, with a rough surface and hazy water on some days; the force lessens a few meters down. Carry an SMB. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Stay on the east side reef or hold the faces at no deeper than 30 m (100 ft), whatever the sheer drop shows. If sharks appear, stay put, nothing dangling, no chasing or touching, group together and follow the crew's briefing. Safety stop under your SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "An exposed offshore dive with a drop-off beside you. For divers who keep their depth.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "scalloped-hammerhead",
        "hawksbill-turtle",
        "brown-chromis",
        "creole-wrasse",
        "black-durgon",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "divers-dream-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://www.underseatobago.com/tobago-dive-sites/south-coast/diver-s-dream",
      "https://rseadivers.com/dive-sites/",
      "https://www.tropicalsky.co.uk/caribbean-holidays/tobago/the-best-dive-sites-in-tobago",
      "https://www.discovertnt.com/articles/tobago/diving-kingdom-of-the-corals/",
    ],
    briefing: {
      // Approximate pin: south coast, about two miles beyond Crown Point (Tropical Sky), near the north tip of the Weather Bight plateau (Undersea Tobago); pinned south-east of Crown Point (geocoded 11.1589,-60.8346, OpenStreetMap Nominatim). Good to about 2 km. Depth: Undersea Tobago 50 to 70 ft; other sources are looser. Gate: Advanced Open Water for the strong current the sources call advanced.
      name: "Diver's Dream",
      locationName: "Crown Point, Tobago",
      forecastLatitude: 11.13,
      forecastLongitude: -60.815,
      description:
        "A rock reef on Tobago's south coast with ledges, overhangs and barrel sponges shaped by the current. Barracuda, rays and nurse sharks use the ledges.",
      marineLife: "Barracuda · nurse sharks · rays · barrel sponges",
      marineLifeDescription:
        "Big fish patrol the ledges and the current feeds the sponges. Look along the edge, not into the overhangs.",
      difficultyLevel: "advanced",
      depthRange: "15–21 m (50–70 ft)",
      maxDepthMeters: 22,
      currentNote:
        "Strong at times; the dive starts up-current of a shallow plateau and drifts. Carry an SMB. This is the south coast, not the Atlantic side.",
      divePlan:
        "Enter up-current as the crew briefs, drift along the rock edge at 15 to 21 m, and finish with a safety stop under your SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A current dive for experienced divers who carry their own marker.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "nurse-shark",
        "spotted-eagle-ray",
        "southern-stingray",
        "giant-barrel-sponge",
        "hawksbill-turtle",
      ],
    },
  },
  {
    slug: "flying-reef-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://www.underseatobago.com/tobago-dive-sites/south-coast/flying-reef",
      "https://divemagazine.com/scuba-diving-travel/tobagos-best-entry-level-dive-sites",
      "https://rseadivers.com/dive-sites/",
      "https://www.tropicalsky.co.uk/caribbean-holidays/tobago/the-best-dive-sites-in-tobago",
    ],
    briefing: {
      // Approximate pin: south coast near the airport and a short boat ride from Crown Point (Undersea Tobago, Tropical Sky); pinned about 1.5 km south of ANR Robinson airport (geocoded 11.1523,-60.8397, OpenStreetMap Nominatim). Good to about 2 km. Gate: the sources give 0 to 2 knots and say it can pick up, so Advanced Open Water is the conservative reading; a shop that finds it gentler on its day can lower it.
      name: "Flying Reef",
      locationName: "Crown Point, Tobago",
      forecastLatitude: 11.139,
      forecastLongitude: -60.83,
      description:
        "A long, straight reef edge on Tobago's south coast, dived as a drift. Plate corals, nurse sharks and stingrays line the base.",
      marineLife: "Nurse sharks · stingrays · green moray eels · Bermuda chub",
      marineLifeDescription:
        "Rays and nurse sharks rest where the reef meets the sand, and a soft wall of chub rides the current.",
      difficultyLevel: "intermediate",
      depthRange: "5–15 m (18–50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "0 to 2 knots; it can pick up. Carry an SMB. This is the south coast, not the Atlantic side.",
      divePlan:
        "Drift along the reef edge from east to west with the group, keep to the depth the crew sets, and do a safety stop under your SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A drift along a reef edge, with a marker and a crew who know the day's water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nurse-shark",
        "southern-stingray",
        "green-moray",
        "bermuda-chub",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "japanese-gardens-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://www.underseatobago.com/tobago-dive-sites/speyside/japanese-gardens",
      "https://www.eric-tobago.org/dive-sites-and-species",
      "https://www.tobagoscubadiving.com/diving.html",
      "https://visittobago.gov.tt/east-tobago-speyside-dive-sites",
    ],
    briefing: {
      // Approximate pin: on the fringes of Goat Island off Speyside (Tropical Sky, R and Sea); pinned in the water between Speyside (geocoded 11.2937,-60.5337, OpenStreetMap Nominatim) and Little Tobago. Good to about 2 km. Depth: the Tobago Tourism Agency gives 20 to 110 ft (6 to 34 m), the deepest figure (Undersea Tobago 40 to 80 ft, DAN 35 to 65 ft), so the cap is 34 m and the Deep specialty applies. Gate: Advanced Open Water and Deep, also for the Atlantic-side drift and the narrow cut.
      name: "Japanese Gardens",
      locationName: "Speyside, Tobago",
      forecastLatitude: 11.299,
      forecastLongitude: -60.515,
      description:
        "A sloping reef off Goat Island with orange elephant ear sponges, yellow tube sponges and bicolor damselfish. The reef ends at Kamikaze Cut, where the current speeds up.",
      marineLife: "Elephant ear sponges · tube sponges · nurse sharks · barracuda",
      marineLifeDescription:
        "Sponges cover the slope and the damselfish crowd it. Nurse sharks and barracuda hold near small caves, which are overhead; stay out.",
      difficultyLevel: "advanced",
      depthRange: "6–34 m (20–110 ft)",
      maxDepthMeters: 34,
      currentNote:
        "The cut accelerates the current. Move out over open reef before it and deploy the SMB in open water; the small caves are overhead; stay out. The Guyana Current can bring strong, cloudy water to the Atlantic side. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Drift down the slope with the group and hold the depth the crew sets. Move out over open reef before the cut, deploy the SMB in open water, and make the safety stop under it. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A Speyside drift where the cut ahead sets the plan: be out over open reef before it.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Kamikaze Cut (hazard)",
          kind: "reefFormation",
          note: "A narrow cut between two large rocks where the current accelerates. Not part of the plan: move out over open reef before it.",
        },
      ],
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "yellow-tube-sponge",
        "bicolor-damselfish",
        "nurse-shark",
        "great-barracuda",
        "green-moray",
      ],
    },
  },
  {
    slug: "kelleston-drain-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://world.dan.org/?p=26012",
      "https://www.eric-tobago.org/dive-sites-and-species",
      "https://visittobago.gov.tt/east-tobago-speyside-dive-sites",
      "https://rseadivers.com/dive-sites/",
    ],
    briefing: {
      // Approximate pin: on the south side of Little Tobago, about 3 km east of Speyside (Tropical Sky, ERIC, R and Sea); Little Tobago geocodes to 11.3008,-60.5013 (OpenStreetMap Nominatim) and the pin sits on its south side in the water. Good to about 2 km. Depth: the Tobago Tourism Agency gives 54 to 120 ft (16 to 37 m), the deepest figure, so the cap is 37 m and the Deep specialty applies; DAN puts the brain coral at about 18 m (60 ft) on a sandy slope, and the plan stays there. Gate: Advanced Open Water and Deep. Size: 3 m high by 5 m wide (Tropical Sky, press reports); the species is the symmetrical brain coral per Guinness World Records.
      name: "Kelleston Drain",
      locationName: "Little Tobago, Speyside, Tobago",
      forecastLatitude: 11.293,
      forecastLongitude: -60.501,
      description:
        "A drift past gorgonians and sea whips on the south side of Little Tobago, to a giant brain coral about 3 m high and 5 m wide. It stands out for its size, with nurse sharks resting in the recess beneath it. Do not go beneath it.",
      marineLife: "Giant brain coral · nurse sharks · barracuda · sea fans",
      marineLifeDescription:
        "The coral is the landmark; nurse sharks often rest under it. Manta rays are occasional visitors.",
      difficultyLevel: "advanced",
      depthRange: "16–37 m (54–120 ft)",
      maxDepthMeters: 37,
      currentNote:
        "A drift that is strong at times on the Atlantic side of Little Tobago. Carry an SMB so the boat can pick you up at the end of the drift. The Guyana Current can bring strong, cloudy water to the Atlantic side. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Drift with the group to the brain coral at about 18 m (60 ft) on the sandy slope and keep fins and hands off it. Do not go beneath it. If sharks are resting, stay put, keep nothing dangling, do not chase or touch them, group together and follow the crew's briefing. The slope runs deeper, so hold the depth the crew sets and do a safety stop under your SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A drift to one famous coral. Look from a body-length away and keep moving with the group.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The giant brain coral",
          kind: "reefFormation",
          note: "A single brain coral about 3 m high and 5 m wide at about 18 m (60 ft). Do not touch it or go beneath it.",
        },
      ],
      creatureSlugs: [
        "symmetrical-brain-coral",
        "nurse-shark",
        "great-barracuda",
        "common-sea-fan",
        "giant-manta-ray",
      ],
    },
  },
  {
    slug: "london-bridge-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://world.dan.org/?p=26012",
      "https://www.eric-tobago.org/dive-sites-and-species",
      "https://www.tobagoscubadiving.com/diving.html",
      "https://visittobago.gov.tt/northern-tobago-dive-sites",
    ],
    briefing: {
      // Approximate pin: a rock arch off the St Giles Islands at Tobago's north-east tip (Tobago Scuba Diving, Tropical Sky); St Giles did not geocode, so the pin is placed by hand off the north-east tip, about 4 km north-north-east of Charlotteville (geocoded 11.3223,-60.5473, OpenStreetMap Nominatim). Good to about 2 km. The Tobago Tourism Agency places it at Charlotteville, northern Tobago. Depth: the Tourism Agency gives 40 to 100 ft (12 to 30 m), the deepest figure; DAN gives 15 to 24 m. Gate: Advanced Open Water for the exposure, surge and current; the arch passage is overhead and is not part of the plan.
      name: "London Bridge",
      locationName: "St Giles Islands, Tobago",
      forecastLatitude: 11.35,
      forecastLongitude: -60.52,
      description:
        "A rock arch rising out of the sea off the St Giles Islands, on Tobago's exposed northeast tip. Brain corals, sponges and boulders sit around it, with tarpon, turtles and sharks seen nearby.",
      marineLife: "Tarpon · turtles · sharks · jacks",
      marineLifeDescription:
        "Tarpon, turtles and sharks are reported nearby, and jacks school over the boulders. Octopus tuck into holes in the rock face.",
      difficultyLevel: "advanced",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Surge and current run around the rocks, and swells hit the arch with a loud boom; some days the site is not dived. In surge keep well away from the arch. Carry an SMB so the boat can pick you up at the end of the drift. The passage under the arch is overhead; stay out. Medical care is far; confirm the boat's oxygen and plan. The Guyana Current can bring strong, cloudy water to the Atlantic side.",
      divePlan:
        "Stay on the open reef and boulders outside the arch, no deeper than 30 m (100 ft), and do a safety stop under your SMB. The arch passage is overhead; stay out of it. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "An exposed, surgy site for experienced divers. The arch is for looking at from outside.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The arch",
          kind: "pointOfInterest",
          note: "A rock arch that rises out of the water. The passage under it is overhead; stay out.",
        },
      ],
      creatureSlugs: [
        "tarpon",
        "nurse-shark",
        "horse-eye-jack",
        "atlantic-common-octopus",
        "boulder-brain-coral",
      ],
    },
  },
  {
    slug: "dutchmans-reef-tobago",
    version: 1,
    area: "trinidad-tobago",
    sources: [
      "https://visittobago.gov.tt/tobago-south-west-dive-sites",
      "https://rseadivers.com/dive-sites/",
    ],
    briefing: {
      // Approximate pin: a shore dive from Mount Irvine Beach (Tobago Tourism Agency) in Mount Irvine Bay (R and Sea); pinned in the water about 100 m off the beach (geocoded 11.1936,-60.7955, OpenStreetMap Nominatim) and more than 300 m from the other Mount Irvine pins. Good to about 2 km. Depth: 24 to 45 ft (7 to 14 m) from the Tourism Agency.
      name: "Dutchman's Reef",
      locationName: "Mount Irvine Bay, Tobago",
      forecastLatitude: 11.1938,
      forecastLongitude: -60.7962,
      description:
        "A shallow reef reached from the beach at Mount Irvine, where two cannons from a 17th-century Dutch wreck lie among soft corals and sponges. Bottles and pottery shards have turned up here.",
      marineLife: "Nurse sharks · lobster · rays · moray eels",
      marineLifeDescription:
        "Lobster and eels use the corals around the cannons, and rays and nurse sharks pass over the sand.",
      difficultyLevel: "beginner",
      depthRange: "7–14 m (24–45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Not documented. It is a shore entry from a beach, so ask the crew about the entry and the surf on the day.",
      divePlan:
        "Enter from the beach, swim out to the cannons, and circle the site slowly. Look, do not touch or lift anything, and finish with a safety stop and reserve gas. Stay outside any wreckage.",
      fitTone: "welcoming",
      fitNote: "Shallow, close to shore and a good first dive on Tobago's Caribbean side.",
      creatureSlugs: [
        "nurse-shark",
        "spiny-lobster",
        "southern-stingray",
        "spotted-moray",
        "common-sea-fan",
      ],
    },
  },
];
