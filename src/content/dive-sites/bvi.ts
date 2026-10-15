// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** British Virgin Islands. */
export const BVI: DiveSiteTemplate[] = [
  {
    slug: "diamond-reef-great-camanoe",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-diamond-reef.html",
      "https://bvi-dive-map.com/site/diamond-reef/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      name: "Diamond Reef",
      locationName: "Great Camanoe, British Virgin Islands",
      forecastLatitude: 18.4664,
      forecastLongitude: -64.5257,
      description:
        "A small, friendly reef off Great Camanoe, a short boat ride from Scrub Island. A low wall about 200 yards long, with a colony of garden eels on the sand beside it.",
      marineLife: "Garden eels · sergeant majors · blue tang · sea fans",
      marineLifeDescription:
        "Watch the garden eels from a little distance and they stay out of their burrows. The reef is also dived at night.",
      difficultyLevel: "beginner",
      depthRange: "3–12 m (10–40 ft)",
      maxDepthMeters: 12,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the wall along its length, then ease out to the sand to watch the garden eels without crowding them. Night: go with a guide and carry a primary and a backup light.",
      fitTone: "welcoming",
      fitNote: "Shallow and compact, a good first dive. At night, a guide and two lights.",
      landmarks: [
        {
          name: "The small wall",
          kind: "reefFormation",
          note: "A low wall about 200 yards long, with the garden eel colony on the sand beside it.",
        },
      ],
      creatureSlugs: [
        "garden-eel",
        "sergeant-major",
        "blue-tang",
        "queen-parrotfish",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "brewers-bay-pinnacles-tortola",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-brewers-bay-pinnacles.html",
      "https://bvi-dive-map.com/site/brewers-pinnacle/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The pin is the west pinnacle marker; the east pinnacles lie about 750 m to the east.
      // Gated AOW + Deep: Cuan Law gives 25–110 ft (33 m); the map marker says 100 ft.
      name: "Brewers Bay Pinnacles",
      locationName: "Brewers Bay, Tortola",
      forecastLatitude: 18.4449,
      forecastLongitude: -64.66,
      description:
        "A group of granite pinnacles off the western tip of Brewers Bay, rising steeply from the sea floor, some to within 30 ft of the surface. Too far from the beach for a shore dive, and best in summer when there is no north swell.",
      marineLife: "Eagle rays · turtles · jacks · tarpon",
      marineLifeDescription:
        "Big jacks, eagle rays and turtles pass the pinnacles, and tarpon gather in summer when the baitfish are thick.",
      difficultyLevel: "advanced",
      depthRange: "8–34 m (25–110 ft)",
      maxDepthMeters: 34,
      currentNote:
        "A north swell spoils the site, so it is a summer dive. The gaps between the pinnacles are a maze of dead ends and narrow passages: stay out of them. Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring, around the outside of the pinnacles, and back up the line with reserve gas. Keep out of the narrow gaps.",
      fitTone: "demanding",
      fitNote:
        "Deep granite pinnacles with a confusing layout. Advanced Open Water and Deep, with good buoyancy.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The pinnacles",
          kind: "reefFormation",
          note: "Steep granite pinnacles of different heights, the tallest within about 30 ft of the surface, covered in sea fans and gorgonians.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "hawksbill-turtle",
        "horse-eye-jack",
        "tarpon",
        "queen-angelfish",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "mountain-point-virgin-gorda",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-mountain-point-bvi.html",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/mountain-point/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: the sources give 70 ft (21 m) and the map says 74 ft; the moorings nearer the shore are shallower (about 12 m). Ungated: Dive BVI and the map rate it novice and Cuan Law novice to intermediate, and no source names a current.
      name: "Mountain Point (Cow’s Mouth)",
      locationName: "Mahoe Bay, Virgin Gorda",
      forecastLatitude: 18.5048,
      forecastLongitude: -64.4167,
      description:
        "Below the peak of Virgin Gorda, a reef of big coral heads and overhangs. The moorings nearer land are shallower, while the Cow’s Mouth side drops into deeper water and a steep slope.",
      marineLife: "Tarpon · jacks · barracuda · garden eels",
      marineLifeDescription:
        "Tarpon sweep through the baitfish in summer, and a colony of garden eels lives on the sand on the Cow’s Mouth side.",
      difficultyLevel: "intermediate",
      depthRange: "6–21 m (20–70 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Watch the surge in the shallows. The Cow’s Mouth is a narrow cut between rock formations and the bedrock has caves and grottoes: overhead; stay out of them. Current not documented; ask the crew on the day.",
      divePlan:
        "Pick the shallow mooring for the coral heads, or the deeper one at 21 m (70 ft) for the slope, and keep the Cow’s Mouth cut out of the plan.",
      fitTone: "welcoming",
      fitNote: "The deeper mooring is 21 m (70 ft); Open Water divers use the shallow moorings.",
      landmarks: [
        {
          name: "Cow’s Mouth",
          kind: "pointOfInterest",
          note: "A narrow cut between two rock formations inside the headland. Overhead; stay out of it.",
        },
      ],
      creatureSlugs: [
        "tarpon",
        "horse-eye-jack",
        "great-barracuda",
        "garden-eel",
        "french-grunt",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "the-aquarium-virgin-gorda",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-the-aquarium.html",
      "https://bvi-dive-map.com/site/the-aquarium/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      name: "The Aquarium",
      locationName: "Between Spanish Town and the Baths, Virgin Gorda",
      forecastLatitude: 18.4321,
      forecastLongitude: -64.4445,
      description:
        "A small shoal of reef between Spanish Town and the Baths, piled with rocks and ledges. Pillar coral and big schools of reef fish for the size of the site.",
      marineLife: "French grunts · sergeant majors · blue tang · nurse sharks",
      marineLifeDescription:
        "Sergeant majors, blue tang and chromis fill the water above the rocks, and nurse sharks nap under the larger ledges.",
      difficultyLevel: "beginner",
      depthRange: "5–11 m (15–35 ft)",
      maxDepthMeters: 11,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Circle the shoal slowly, once wide for the shape and once close to the rocks. The gaps between the rocks are overhead; stay out. One tank is enough.",
      fitTone: "welcoming",
      fitNote: "Shallow and compact, a good second dive of the day.",
      landmarks: [
        {
          name: "Pillar coral",
          kind: "reefFormation",
          note: "Pillar coral formations on the shoal.",
        },
      ],
      creatureSlugs: [
        "french-grunt",
        "sergeant-major",
        "blue-tang",
        "nurse-shark",
        "pillar-coral",
        "spotted-moray",
      ],
    },
  },
  {
    slug: "the-invisibles-virgin-gorda",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/the-invisibles/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Gated AOW: Dive BVI rates it advanced, and the map and Sunchaser name strong currents and rough seas at an exposed pinnacle.
      name: "The Invisibles",
      locationName: "North of Virgin Gorda, British Virgin Islands",
      forecastLatitude: 18.5273,
      forecastLongitude: -64.3406,
      description:
        "A submerged pinnacle that rises to within 4 ft of the surface, north of Virgin Gorda. Heavy sponge and soft coral growth, and a lot of fish drawn by the moving water.",
      marineLife: "Reef fish · sponges · soft corals · schooling jacks",
      marineLifeDescription:
        "Moving water brings in big volumes of fish, and the sponges and soft corals are some of the most colorful in the islands.",
      difficultyLevel: "advanced",
      depthRange: "5–20 m (15–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Washed by strong currents and prone to rough seas, and the site sits in unsheltered water north of Virgin Gorda. Carry an SMB and stay with the group. A wave-cresting swim-through at the finish is overhead: stay out of it.",
      divePlan:
        "Down the mooring to the pinnacle, along it with the current, and up the line before the group’s gas gets low. Keep out of the swim-through.",
      fitTone: "demanding",
      fitNote:
        "Strong current and exposed water. For divers who have drift-dived and carry their own SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "queen-angelfish",
        "french-grunt",
        "common-sea-fan",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "the-chimney-great-dog",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-the-chimney.html",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/the-chimney/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The map marker reads 51 ft; four operator pages read 45 ft.
      name: "The Chimney",
      locationName: "Great Dog, British Virgin Islands",
      forecastLatitude: 18.4813,
      forecastLongitude: -64.4616,
      description:
        "On the west side of Great Dog, a protected bay with big coral heads under the mooring, then canyons and a large arch around the northern point. The Chimney itself is a slot between two boulders, named for the climbing term.",
      marineLife: "Yellowtail snapper · sergeant majors · parrotfish · moray eels",
      marineLifeDescription:
        "The coral heads under the mooring hold plenty of fish, and the canyons beyond them hide eels and small invertebrates.",
      difficultyLevel: "beginner",
      depthRange: "5–14 m (15–45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Protected bay on the west side of the island. Current not documented; ask the crew on the day.",
      divePlan:
        "Start over the coral heads under the mooring, then follow the canyons north along the shore with your guide. The slot and the arch are narrow: look from outside, and keep to the open canyons.",
      fitTone: "welcoming",
      fitNote: "A sheltered, shallow dive that suits a guided first reef dive.",
      landmarks: [
        {
          name: "The Chimney",
          kind: "reefFormation",
          note: "A narrow slot between two large rocks, rising toward the surface. Narrow and overhead in places; stay with your guide and out of the slot.",
        },
      ],
      creatureSlugs: [
        "yellowtail-snapper",
        "sergeant-major",
        "queen-parrotfish",
        "green-moray",
        "orange-cup-coral",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "coral-gardens-sharkplaneo-great-dog",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-airplane-wreck-coral-gardens-bvi.html",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/coral-gardens-airplane-wreck/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      name: "Coral Gardens and Sharkplaneo",
      locationName: "Great Dog, British Virgin Islands",
      forecastLatitude: 18.4802,
      forecastLongitude: -64.4568,
      description:
        "A quiet coral reef on the south side of Great Dog, with mounds of star and brain coral. A short swim away on the sand, three aircraft have been shaped into shark sculptures for the Beyond the Reef artificial reef project.",
      marineLife: "Lobster · stingrays · turtles · barracuda",
      marineLifeDescription:
        "Lobster and spotted drums sit under the coral overhangs, stingrays work the sand, and turtles pass now and then.",
      difficultyLevel: "beginner",
      depthRange: "5–15 m (15–50 ft)",
      maxDepthMeters: 15,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Swim slowly over the coral mounds, then cross to the sand patch for the aircraft sculptures. They are wrecks: stay outside the hull of each one.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, calm and good for slow looking. A local non-profit asks a small donation from divers visiting the sharks.",
      landmarks: [
        {
          name: "Sharkplaneo",
          kind: "wreckFeature",
          note: "Three aircraft shaped as sharks on the sand, about 40 ft down. Stay outside the hull of each.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "spotted-drum",
        "southern-stingray",
        "hawksbill-turtle",
        "great-barracuda",
        "boulder-star-coral",
      ],
    },
  },
  {
    slug: "the-visibles-cockroach-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-visibles-bvi.html",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/the-visibles/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The operators place the dive off the west and southwest of the islet; the marker is about 600 m east of it.
      // Gated AOW: Cuan Law and Dive BVI rate it advanced for current; the neighbouring POS dive reads 85 ft but is not briefed here.
      name: "The Visibles",
      locationName: "Cockroach Island, British Virgin Islands",
      forecastLatitude: 18.492,
      forecastLongitude: -64.4584,
      description:
        "A pinnacle off Cockroach Island that comes within a dozen feet of the surface, with a slope of big gorgonians and sea fans going down to a line of ledges and small caves. Rays, turtles and sharks pass in the open water.",
      marineLife: "Barracuda · eagle rays · bigeyes · angelfish",
      marineLifeDescription:
        "A large barracuda holds the top of the pinnacle, and the ledges below hold schools of bigeyes, highhats and snappers.",
      difficultyLevel: "advanced",
      depthRange: "3–24 m (10–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Swept by variable and sometimes strong current, and the site can only be dived when the current allows. Carry an SMB and stay close to the guide. The shallows are a maze of alleyways, tunnels and arches: overhead; stay out of them.",
      divePlan:
        "Down to the pinnacle, along the slope with the current to the ledges, and back up the pinnacle for the stop. Keep out of the alleyways in the shallows.",
      fitTone: "demanding",
      fitNote:
        "Strong, variable current at an exposed pinnacle. For divers comfortable drifting with an SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "spotted-eagle-ray",
        "highhat",
        "queen-angelfish",
        "blackbar-soldierfish",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "bronco-billy-george-dog",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-bronco-billys.html",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/bronco-billy/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Ratings differ: Dive BVI and Sail Caribbean say novice, Cuan Law says advanced (surge). Cuan Law's rating is taken: gated AOW, with surge sourced.
      name: "Bronco Billy",
      locationName: "George Dog, British Virgin Islands",
      forecastLatitude: 18.493,
      forecastLongitude: -64.4601,
      description:
        "At the northwest tip of George Dog, ridges of coral and the canyons between them, with two arches and a large steep-walled box canyon. Stands of pillar coral grow along the ridges.",
      marineLife: "Pillar coral · staghorn coral · soft corals · sponges",
      marineLifeDescription:
        "Pillar coral and encrusting sponges color the canyon walls, with staghorn coral at the arches.",
      difficultyLevel: "intermediate",
      depthRange: "5–15 m (15–50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Surge can be strong in the canyons, and the site is at its worst in winter swell. The arches are short swim-throughs: overhead; stay out of them. Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the canyons around the tip, look at the arches from outside, and swing wider on the way back to the mooring.",
      fitTone: "demanding",
      fitNote: "Shallow but surgy in the canyons. Best on calm days, with a guide who knows them.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The arches",
          kind: "reefFormation",
          note: "Two coral archways that open into canyons. Overhead; stay out of them.",
        },
      ],
      creatureSlugs: [
        "pillar-coral",
        "staghorn-coral",
        "queen-angelfish",
        "french-grunt",
        "orange-cup-coral",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "seal-dog-rocks-bvi",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-seal-dogs-bvi.html",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/seal-dogs-east/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The pin is the Seal Dogs East marker, northeast of the two islands where the breaking rock lies.
      // Depth: Sunchaser gives 85 ft; the map marker for West Seal Dog reads 91 ft, so maxDepthMeters covers it.
      // Gated AOW: the site is open to the ocean and Cuan Law rates it advanced.
      name: "Seal Dog Rocks",
      locationName: "Seal Dog Islands, British Virgin Islands",
      forecastLatitude: 18.5075,
      forecastLongitude: -64.4308,
      description:
        "Two small islands and a breaking rock at the northeast edge of the group, open to the Atlantic. Boulders, canyons and swim-throughs under the cliffs, a slope of soft sponges, and the open blue beside it.",
      marineLife: "Pelagic jacks · mackerel · eagle rays · butterflyfish",
      marineLifeDescription:
        "Plankton-rich water brings in passing jacks and mackerel, an eagle ray or two, and shoals of butterflyfish that follow divers.",
      difficultyLevel: "advanced",
      depthRange: "6–26 m (20–85 ft)",
      maxDepthMeters: 28,
      currentNote:
        "Exposed to the ocean and its currents. Carry an SMB. The swim-throughs and tiny caves in the boulders are overhead: stay out of them.",
      divePlan:
        "The bottom under the mooring is about 8 m and slopes away. Follow the cliff base and the boulder canyons, stay clear of the breaking rock (do not go to it), and come back up the line with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "Open-ocean exposure, depth to 26 m and current. For divers who like their blue-water diving.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "cero",
        "spotted-eagle-ray",
        "foureye-butterflyfish",
        "black-durgon",
        "blue-tang",
      ],
    },
  },
  {
    slug: "ledges-dolphin-rocks-george-dog",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/dolphin-rocks/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: Dive BVI gives 20–50 ft and Sunchaser 30–65 ft with a stingray cleaning station at 75 ft; the deeper figure sets the range. Gated AOW: Dive BVI rates it novice, but the sources call it a calm-day site because it is open to swell, so it runs only in calm conditions with a guide.
      name: "Ledges and Dolphin Rocks",
      locationName: "George Dog, British Virgin Islands",
      forecastLatitude: 18.4957,
      forecastLongitude: -64.4546,
      description:
        "Wash rocks off George Dog with deep ledges cut into the pinnacles that break the surface. A dive for calm days, best in summer, when baitfish gather and the big predators follow.",
      marineLife: "Barracuda · mackerel · tarpon · southern stingrays",
      marineLifeDescription:
        "Baitfish at the wash rocks bring barracuda, mackerel and large tarpon, and a southern stingray cleaning station sits in the deeper north end.",
      difficultyLevel: "intermediate",
      depthRange: "6–23 m (20–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Only in calm conditions with the guide: the wash rocks are exposed to the open sea and swell, and swell washes over the rocks. Current not documented; ask the crew on the day. Carry an SMB.",
      divePlan:
        "Down the mooring to the ledges and along them, and to the stingray station in the deeper north end only if the crew confirms the day.",
      fitTone: "demanding",
      fitNote:
        "Open to swell, so it runs only in calm conditions with a guide. The ledges reach about 23 m (75 ft) in the deeper north end.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "tarpon",
        "southern-stingray",
        "cero",
        "horse-eye-jack",
        "blue-tang",
      ],
    },
  },
  {
    slug: "wall-to-wall-west-dog",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-wall-to-wall-bvi.html",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/wall-2-wall/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The Joe's Cave marker is about 110 m away; both are published points.
      // Gated AOW: Cuan Law rates it advanced and Dive BVI intermediate to advanced; no source names a current.
      name: "Wall to Wall",
      locationName: "West Dog, British Virgin Islands",
      forecastLatitude: 18.4812,
      forecastLongitude: -64.4741,
      description:
        "On the southwest corner of West Dog, a sand patch under the mooring ringed by ledges and overhangs, and a rock finger running down a slope to boulders. Named for the fish: the shallows can be wall to wall with them.",
      marineLife: "Porkfish · grunts · squirrelfish · nurse sharks",
      marineLifeDescription:
        "Porkfish, bluestriped grunts and squirrelfish crowd the boulders around 14 m, and nurse sharks sleep under the ledges.",
      difficultyLevel: "advanced",
      depthRange: "5–24 m (15–80 ft)",
      maxDepthMeters: 24,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Look under the ledges at the sand patch first, then follow the rock finger down the slope to the boulders at about 14 m, and return along the shallows.",
      fitTone: "demanding",
      fitNote: "Advanced Open Water, with a guide who knows the rock finger and the boulders.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "porkfish",
        "bluestriped-grunt",
        "longjaw-squirrelfish",
        "nurse-shark",
        "spiny-lobster",
        "caribbean-reef-octopus",
      ],
    },
  },
  {
    slug: "joes-cave-west-dog",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/joes-cave/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The Wall to Wall marker is about 110 m away; both are published points.
      // The cave is not part of the plan: it is described as a passage under the island, so it is overhead and marked stay out.
      name: "Joe’s Cave",
      locationName: "West Dog, British Virgin Islands",
      forecastLatitude: 18.4814,
      forecastLongitude: -64.4751,
      description:
        "Boulders up to 25 ft high pile against West Dog, with canyons and ledges between them. A scenery dive more than a marine life dive, with a cave in the island wall that is not part of the dive.",
      marineLife: "Spiny lobster · French grunts · blue tang · banded coral shrimp",
      marineLifeDescription:
        "The boulders are the draw, with lobsters and schools of grunts and blue tang along the canyons.",
      difficultyLevel: "intermediate",
      depthRange: "5–14 m (15–45 ft)",
      maxDepthMeters: 14,
      currentNote: "Surge in the shallows. Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the boulders and canyons along the island wall, then shallow up the mooring line for the safety stop. The cave is overhead; stay out.",
      fitTone: "welcoming",
      fitNote: "Scenic and shallow, with a cave you leave alone.",
      creatureSlugs: [
        "spiny-lobster",
        "banded-coral-shrimp",
        "blue-tang",
        "french-grunt",
        "orange-cup-coral",
      ],
    },
  },
  {
    slug: "the-flintstones-west-dog",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/flintstones/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: Dive BVI and the map read 70 ft and 65 ft (21 m). Ungated: Dive BVI rates it intermediate and no source names a current.
      name: "The Flintstones",
      locationName: "West Dog, British Virgin Islands",
      forecastLatitude: 18.4852,
      forecastLongitude: -64.4735,
      description:
        "Rocky outcroppings on the west side of West Dog, said to resemble the Flintstones’ Bedrock, with boulders continuing underwater into ledges and overhangs. Lobsters and fish shelter in the gaps.",
      marineLife: "Lobsters · nurse sharks · eagle rays · reef fish",
      marineLifeDescription:
        "Lobsters stand in for Fred and Barney in the crevices, nurse sharks rest on the boulders, and an eagle ray may pass in the deeper water.",
      difficultyLevel: "intermediate",
      depthRange: "9–21 m (30–70 ft)",
      maxDepthMeters: 21,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Thread through the boulder field at 9 to 18 m, look under the ledges, and come back shallower along the outcrop.",
      fitTone: "unknown",
      fitNote:
        "Less visited than its neighbors. Boulders and ledges run from 9 to 21 m (30 to 70 ft).",
      creatureSlugs: [
        "spiny-lobster",
        "nurse-shark",
        "spotted-eagle-ray",
        "french-grunt",
        "blackbar-soldierfish",
        "orange-cup-coral",
      ],
    },
  },
  {
    slug: "ginger-steps-ginger-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-ginger-steps.html",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/ginger-steps/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // The sand beneath the last step reads 100 ft (30 m); the plan holds 30 m. Ungated: Dive BVI rates it novice to intermediate and Cuan Law intermediate, and the map says the site is protected from aggressive currents and swells.
      name: "Ginger Steps",
      locationName: "Ginger Island, British Virgin Islands",
      forecastLatitude: 18.3871,
      forecastLongitude: -64.4809,
      description:
        "Wide rock ledges step down from the shallows to white sand along Ginger Island, tucked against the tip of South Bay for a calmer dive. Tube sponges and sea fans edge the steps, and the corals are in good shape.",
      marineLife: "Sea fans · tube sponges · snappers · sleeping rays",
      marineLifeDescription:
        "Schools of grunts and pale snappers gather in the hollows, and southern rays sleep in the sand below the steps.",
      difficultyLevel: "intermediate",
      depthRange: "11–30 m (35–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "The site is tucked against South Bay, which gives some shelter from ocean swell. Current not documented; ask the crew on the day.",
      divePlan: "Down the mooring, then work along the steps, no deeper than 30 m (100 ft).",
      fitTone: "unknown",
      fitNote:
        "Healthy reef and good visibility. The steps run to 30 m (100 ft), so Open Water divers stay on the upper steps, no deeper than 18 m.",
      creatureSlugs: [
        "common-sea-fan",
        "yellow-tube-sponge",
        "southern-stingray",
        "french-grunt",
        "schoolmaster-snapper",
        "queen-angelfish",
      ],
    },
  },
  {
    slug: "alice-in-wonderland-ginger-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-alices-wonderland.html",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/alices-wonderland/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: Sunchaser gives 40–85 ft; Cuan Law has the sand starting at about 80 ft. Ungated: Cuan Law rates it intermediate and Dive BVI novice to intermediate.
      name: "Alice in Wonderland",
      locationName: "Ginger Island, British Virgin Islands",
      forecastLatitude: 18.3864,
      forecastLongitude: -64.4845,
      description:
        "Off the south shore of Ginger Island, a spur-and-groove reef with huge mushroom-shaped coral heads, rocky ridges and sandy canyons that you can wind up through. Clear blue water, and the reef drops away over three steps.",
      marineLife: "Eagle rays · turtles · nurse sharks · pufferfish",
      marineLifeDescription:
        "Visibility often exceeds 100 ft. Spotted eagle rays, southern rays and hawksbill turtles pass, and the ridges hide lobsters and sleeping nurse sharks.",
      difficultyLevel: "intermediate",
      depthRange: "9–26 m (30–85 ft)",
      maxDepthMeters: 26,
      currentNote:
        "Open-ocean exposure, so the surface can be rolly. Current not documented; ask the crew on the day.",
      divePlan:
        "Moored at 18 m (60 ft), the Open Water limit, wind up the canyons toward the island to the shallow ridge at about 11 m (35 ft). Open Water divers keep to the shallower ridge.",
      fitTone: "unknown",
      fitNote:
        "A reef in open water with a rolly surface. The reef falls away over three steps to 26 m (85 ft).",
      creatureSlugs: [
        "spotted-eagle-ray",
        "southern-stingray",
        "hawksbill-turtle",
        "nurse-shark",
        "spiny-lobster",
        "boulder-brain-coral",
      ],
    },
  },
  {
    slug: "carvel-rock-bvi",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-carvel-rock.html",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://bvi-dive-map.com/site/carval-rock/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Gated AOW: Cuan Law, Dive BVI and the map rate it advanced, and the rock stands in open water exposed to current.
      name: "Carvel Rock",
      locationName: "Between Cooper and Ginger Islands, British Virgin Islands",
      forecastLatitude: 18.3728,
      forecastLongitude: -64.4918,
      description:
        "A large rock facing open water outside the gap between Cooper and Ginger Islands, shaped like a sailing ship. Ledges fall away from it into a jumble of huge boulders, with schooling fish in the shadows.",
      marineLife: "Sennet · barracuda · green moray eels · sharks and rays",
      marineLifeDescription:
        "Schools of sennet shelter at the rock, and larger fish pass in the open water. Green morays and lobsters live along the ledges.",
      difficultyLevel: "advanced",
      depthRange: "5–27 m (15–90 ft)",
      maxDepthMeters: 27,
      currentNote:
        "Open to current flows and best on calm days. Carry an SMB. The site is large, and the guides do not recommend circling the whole rock.",
      divePlan:
        "Down the mooring to the ledges, along the rocky reef and canyons on one side, and back the same way with reserve gas.",
      fitTone: "demanding",
      fitNote: "Open-water rock with current and depth. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "green-moray",
        "spiny-lobster",
        "whitespotted-filefish",
        "queen-triggerfish",
        "french-grunt",
        "southern-sennet",
      ],
    },
  },
  {
    slug: "dry-rocks-east-cooper-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-dry-rocks-east.html",
      "https://bvi-dive-map.com/site/dry-rocks-east/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Gated AOW: Cuan Law rates it advanced for rough conditions and occasionally strong currents, and the map says the currents are usually overwhelming.
      name: "Dry Rocks East",
      locationName: "Cooper Island, British Virgin Islands",
      forecastLatitude: 18.3844,
      forecastLongitude: -64.503,
      description:
        "A barely breaking ridge just east of Cooper Island, jutting into the channel toward Ginger Island and drawing fish like a crossroads. A car-sized boulder sits at the foot of the mooring line.",
      marineLife: "Jacks · permit · barracuda · highhats",
      marineLifeDescription:
        "Schools of big jacks and permit sweep past in the blue, and highhats shelter under the boulder at the foot of the mooring.",
      difficultyLevel: "advanced",
      depthRange: "8–26 m (25–85 ft)",
      maxDepthMeters: 26,
      currentNote:
        "An exposed ridge with rough surface conditions and occasionally strong current. Pay close attention to the guide, and carry an SMB.",
      divePlan:
        "Down the mooring to the boulder, along the rock face and scattered boulders, and no deeper than 26 m (85 ft). Back up the line.",
      fitTone: "demanding",
      fitNote: "Exposed, with current and depth to 26 m. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "permit-fish",
        "great-barracuda",
        "highhat",
        "coney",
        "black-durgon",
      ],
    },
  },
  {
    slug: "markoe-point-cooper-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-markoe-point.html",
      "https://bvi-dive-map.com/site/markoe-point/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: Dive BVI reads 80 ft (24 m) at the cliff base and Cuan Law 60 ft; the deeper figure sets the range. Gated AOW: Cuan Law rates it advanced and says waves break hard on the cliff; Dive BVI rates it intermediate.
      name: "Markoe Point",
      locationName: "Cooper Island, British Virgin Islands",
      forecastLatitude: 18.3833,
      forecastLongitude: -64.4713,
      description:
        "The southeast tip of Cooper Island, jutting into the open Caribbean. A gully runs along the point between a sheer cliff and an undercut coral ridge, and the cliff drops to a sand and rock plain.",
      marineLife: "Black durgon · snappers · groupers · lobsters",
      marineLifeDescription:
        "Schools of black durgon and snapper work the open water, and big solitary snappers and groupers patrol the base of the cliff.",
      difficultyLevel: "intermediate",
      depthRange: "9–24 m (30–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Usually protected from the wind, but waves break hard on the cliff above. Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the gully around the point, cruise along the cliff base, and turn at the tall fissure, no deeper than 24 m (80 ft).",
      fitTone: "demanding",
      fitNote:
        "A sheer cliff and a gully, with waves breaking hard above. The cliff base lies at 24 m (80 ft).",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-durgon",
        "yellowtail-snapper",
        "black-grouper",
        "spiny-lobster",
        "blackbar-soldierfish",
        "french-grunt",
      ],
    },
  },
  {
    slug: "wreck-alley-cooper-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://bluewaterdiversbvi.com/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://reefsmartguides.com/wreck-alley/",
    ],
    briefing: {
      // Position: ReefSmart Guides' GPS 18°22.18'N 64°30.66'W; the bvi-dive-map marker is within 200 m.
      // Depth: ReefSmart gives 85–90 ft and Sunchaser 45–90 ft; the deeper figure sets the range. Gate: Advanced Open Water, because Sail Caribbean rates it advanced; Dive BVI rates it intermediate.
      name: "Wreck Alley",
      locationName: "Cooper Island, British Virgin Islands",
      forecastLatitude: 18.3697,
      forecastLongitude: -64.511,
      description:
        "Four small wrecks in a row on a sandy bottom beside a natural reef slope, off Cooper Island: the Marie L, the Pat, the Beata and the Island Seal. Sunk on purpose as artificial reefs, and now covered in growth.",
      marineLife: "Garden eels · southern stingrays · angelfish · conch",
      marineLifeDescription:
        "A bed of garden eels grows on the sand, stingrays glide through the group, and big angelfish stand guard on the hulls.",
      difficultyLevel: "intermediate",
      depthRange: "14–27 m (45–90 ft)",
      maxDepthMeters: 27,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the southern wrecks, along the line of hulls and the slope, and back up the reef. Stay outside the hull of each wreck.",
      fitTone: "demanding",
      fitNote: "Four small wrecks on sand, from 14 to 27 m (45 to 90 ft).",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The four wrecks",
          kind: "wreckFeature",
          note: "The Marie L and Pat lie side by side at the south end, with the Beata and Island Seal beyond. Stay outside the hull of each.",
        },
      ],
      creatureSlugs: [
        "garden-eel",
        "southern-stingray",
        "queen-angelfish",
        "queen-conch",
        "spotted-moray",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "cistern-point-cooper-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-cistern-point.html",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/cistern-point/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. Dive BVI lists it under Cooper Island and Sail Caribbean under Salt Island; Cuan Law places it at the south end of Manchioneel Bay, on Cooper.
      name: "Cistern Point",
      locationName: "Manchioneel Bay, Cooper Island",
      forecastLatitude: 18.3801,
      forecastLongitude: -64.517,
      description:
        "A rocky point carpeted with life, at the south end of Manchioneel Bay. Cistern-like holes in the reef, a ridge of blue tang and anemones, and craters on the far side.",
      marineLife: "Queen angelfish · sergeant majors · tarpon · nurse sharks",
      marineLifeDescription:
        "Tarpon and eels lurk in the cisterns, thick schools of sergeant majors and chromis line the point, and nurse sharks rest in the craters.",
      difficultyLevel: "beginner",
      depthRange: "3–15 m (10–50 ft)",
      maxDepthMeters: 15,
      // Traffic: Manchioneel Bay is the Cooper Island anchorage and mooring field (the sources place the point at the bay's south end); the line is a conservative caution rather than a sourced hazard.
      currentNote:
        "Boats and dinghies use the Manchioneel Bay mooring field: listen for engines, carry an SMB and surface close to the point. Some current can build as you go deeper, so stay on the shoreline side of the point.",
      divePlan:
        "Swim around the point along the shore, over the ridge, and across the craters on the far side.",
      fitTone: "unknown",
      fitNote: "Shallow, lit and varied, with some current deeper along the point.",
      creatureSlugs: [
        "queen-angelfish",
        "sergeant-major",
        "tarpon",
        "nurse-shark",
        "blue-tang",
        "spotted-moray",
      ],
    },
  },
  {
    slug: "vanishing-rock-bvi",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-vanishing-rock-bvi.html",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/vanishing-rock/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Gated AOW: Dive BVI rates it beginner to intermediate and Cuan Law intermediate, but the sources describe a strong current sweeping the passage, so the gate follows the current.
      name: "Vanishing Rock (Dry Rocks West)",
      locationName: "Between Cooper Island and Salt Island, British Virgin Islands",
      forecastLatitude: 18.3777,
      forecastLongitude: -64.5207,
      description:
        "A pinnacle that barely breaks the surface, with one of the biggest stands of pillar coral in the islands. A healthy reef ridge runs to either side, pocked with ledges and undercuts.",
      marineLife: "Pillar coral · sergeant majors · eels · squid",
      marineLifeDescription:
        "Sergeant majors shelter inside the pillar coral, and eels and squid are regular.",
      difficultyLevel: "intermediate",
      depthRange: "5–15 m (15–50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Current sweeps through the passage between Cooper and Salt Islands, strong enough to make the site undivable at times. Carry an SMB, and skip the dive if the current is running.",
      divePlan:
        "Down the slope from the boat, across the sandy patch among the rocks, and along the ridge to the pinnacle, only if the current is gentle.",
      fitTone: "demanding",
      fitNote:
        "Shallow, but a strong current at times can make the site undivable. Skip it on those days.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "pillar-coral",
        "sergeant-major",
        "spotted-moray",
        "caribbean-reef-squid",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "rms-rhone-salt-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://bluewaterdiversbvi.com/dive-sites/",
      "https://www.sunchaserscuba.com/diving",
      "https://bvi-dive-map.com/site/rms-rhone/",
      "https://web.archive.org/web/20140323170330/http://www.bvinationalparkstrust.org:80/index.php/parks-programs/extensions1282393572/mooring-buoy-system",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: bvi-dive-map gives 90 ft, Sunchaser and Sail Caribbean 85 ft and Blue Water 80 ft; the deepest figure, 90 ft (27 m), sets the range, and the bow is the deepest section.
      // Gated AOW: Blue Water calls it an advanced dive and Sail Caribbean lists it as beginner to advanced; the bow lies on its side in the deeper water.
      name: "RMS Rhone",
      locationName: "Salt Island, British Virgin Islands",
      forecastLatitude: 18.3709,
      forecastLongitude: -64.5343,
      description:
        "The Royal Mail steamship that went down in the October 1867 hurricane, off Black Rock Point on Salt Island. Her bow lies on its side in the deeper water, and the broken stern, boilers and propeller are spread across the shallows. Two dives cover her, and the film The Deep was shot here.",
      marineLife: "Barracuda · sea turtles · stingrays · angelfish",
      marineLifeDescription:
        "Schools of sennet and a large barracuda meet you at the bow. Turtles, stingrays and snappers move over the stern, and orange cup corals cover the holds.",
      conservationNote:
        "The Rhone lies in a British Virgin Islands National Parks Trust marine park. Boats tie to a Trust mooring buoy; ask the operator what permit applies today. Take nothing from the wreck.",
      difficultyLevel: "advanced",
      depthRange: "3–27 m (10–90 ft)",
      maxDepthMeters: 27,
      currentNote:
        "Dive boats and snorkelers share the site, and the stern is shallow enough to snorkel. Listen for engines, surface with an SMB, and expect other boats on the buoys. Current is not documented; ask the crew on the day.",
      divePlan:
        "One dive on the deeper bow section, then a second on the shallower middle and stern sections. Stay outside the hull. The hold and cabins are overhead.",
      fitTone: "demanding",
      fitNote:
        "A large wreck with depth to 27 m. Advanced Open Water; staff confirm the diver’s log before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Bow section",
          kind: "wreckFeature",
          note: "The prow, mast and lifeboat davits, lying on its side in the deeper water. Stay outside the hull.",
        },
        {
          name: "Stern and propeller",
          kind: "wreckFeature",
          note: "The broken stern, drive train and the large shallow propeller, spread across the bottom.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "green-sea-turtle",
        "southern-stingray",
        "french-angelfish",
        "yellowtail-snapper",
        "orange-cup-coral",
        "southern-sennet",
      ],
    },
  },
  {
    slug: "blonde-rock-bvi",
    version: 1,
    area: "bvi",
    sources: [
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://bluewaterdiversbvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-the-blonde-rock.html",
      "https://bvi-dive-map.com/site/blonde-rock/",
    ],
    briefing: {
      // Gated AOW: Cuan Law and the map rate it advanced, and Cuan Law calls the open-water pinnacles occasionally current-swept.
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The marker lies midway between Dead Chest and Salt Island, as the operators describe.
      name: "Blonde Rock",
      locationName: "Between Dead Chest and Salt Island, British Virgin Islands",
      forecastLatitude: 18.3691,
      forecastLongitude: -64.5504,
      description:
        "A pair of pinnacles in the open Salt Island Passage, rising from about 60 ft to within 15 ft of the surface, with the dive starting in an amphitheater. Coral-covered ledges, overhangs and swim-throughs sit on a gorgonian plateau.",
      marineLife: "Turtles · jacks · barracuda · sharks and rays",
      marineLifeDescription:
        "The only large feature in the passage draws turtles, schools of jacks, cobia and barracuda, and the occasional shark.",
      difficultyLevel: "advanced",
      depthRange: "3–20 m (10–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Occasionally current-swept, and the pinnacles sit in open water between the islands. Carry an SMB. Some swim-throughs are overhead: stay out of them.",
      divePlan:
        "Down to the amphitheater, along the plateau and around the two peaks, and up the nearer peak for the stop.",
      fitTone: "demanding",
      fitNote: "Exposed pinnacles in open water. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "hawksbill-turtle",
        "horse-eye-jack",
        "cobia",
        "great-barracuda",
        "nurse-shark",
        "fire-coral",
      ],
    },
  },
  {
    slug: "painted-walls-dead-chest",
    version: 1,
    area: "bvi",
    sources: [
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://bluewaterdiversbvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-painted-walls.html",
      "https://bvi-dive-map.com/site/painted-walls/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: bvi-dive-map gives 60 ft; Sail Caribbean, Blue Water and Cuan Law give 40–50 ft. The deeper figure sets the range.
      name: "Painted Walls",
      locationName: "Dead Chest Island, British Virgin Islands",
      forecastLatitude: 18.3617,
      forecastLongitude: -64.5603,
      description:
        "Where two underwater valleys meet at Dead Chest, ridges and canyons are plastered in encrusting sponges and soft and hard corals. Three fingers of reef run out from the island, with a patch of pillar coral on the southern ridge.",
      marineLife: "Nurse sharks · hawksbill turtles · barracuda · lobsters",
      marineLifeDescription:
        "Nurse sharks and hawksbill turtles rest in the passages, and banded shrimp live under the ledges.",
      difficultyLevel: "intermediate",
      depthRange: "3–18 m (10–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Some swell in the canyons. Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the ridges and canyons out from the island. The arch at the end of one of the canyons is a short swim-through. Overhead; stay out.",
      fitTone: "welcoming",
      fitNote: "Colorful, close in and shallow, with some swell in the canyons.",
      landmarks: [
        {
          name: "The arch",
          kind: "reefFormation",
          note: "An arch at the end of a canyon, leading to a shallow pool. Sources differ on which canyon, so ask the crew. Overhead; stay out.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "hawksbill-turtle",
        "great-barracuda",
        "spiny-lobster",
        "banded-coral-shrimp",
        "pillar-coral",
      ],
    },
  },
  {
    slug: "santa-monica-rock-norman-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://bluewaterdiversbvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-santa-monica-rock.html",
      "https://bvi-dive-map.com/site/santa-monica-rock/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The marker lies about 600 m south of Norman Island's coast.
      // A pinnacle that rises from deep water: the plan holds the operators' 100 ft (30 m); the map marker reads 102 ft.
      name: "Santa Monica Rock",
      locationName: "Norman Island, British Virgin Islands",
      forecastLatitude: 18.3048,
      forecastLongitude: -64.6303,
      description:
        "An offshore pinnacle south of Norman Island that rises from the depths to within 20 ft of the surface. A sink hole drops about 25 ft to sand, the south side is a wall of sea fans and gorgonians, and the top is craggy fire coral.",
      marineLife: "Sharks · turtles · eagle rays · barracuda",
      marineLifeDescription:
        "Pelagic fish and sharks pass the pinnacle, with turtles, eagle rays and Atlantic spadefish on the walls.",
      difficultyLevel: "advanced",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Open water, and only diveable on calm days. Carry an SMB. The small cave and the sink hole are overhead or confined: stay out of them.",
      divePlan:
        "Down to the summit, a slow circuit of the pinnacle starting on the south side, no deeper than 30 m (100 ft), and back up the pinnacle with reserve gas.",
      fitTone: "demanding",
      fitNote: "Open-water pinnacle that falls away below the plan. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "hawksbill-turtle",
        "spotted-eagle-ray",
        "great-barracuda",
        "atlantic-spadefish",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "the-indians-norman-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://bluewaterdiversbvi.com/dive-sites/",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.bvidiving.com/diving-the-indians.html",
      "https://bvi-dive-map.com/site/the-indians/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The marker lies beside Pelican Island, off the north end of Norman Island.
      name: "The Indians",
      locationName: "Off Norman Island, British Virgin Islands",
      forecastLatitude: 18.3311,
      forecastLongitude: -64.6282,
      description:
        "Four rock pinnacles that rise from a sandy bottom to the surface, off Norman Island, with ledges, steep walls and a shallow pool between two of them. Coral gardens and an abundance of reef fish.",
      marineLife: "Hawksbill turtles · queen angelfish · reef fish · nudibranchs",
      marineLifeDescription: "Turtles on the deeper sections and nudibranchs in the pond.",
      difficultyLevel: "intermediate",
      depthRange: "3–18 m (10–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Snorkelers share the pinnacles. Surface with an SMB and listen for engines. Current not documented; ask the crew on the day.",
      divePlan:
        "Circle the pinnacles from the sandy bottom, keeping the walls on one side. The tunnel and the cave are overhead; stay out.",
      fitTone: "welcoming",
      fitNote: "Shallow pinnacles that snorkelers share. One tank covers it.",
      landmarks: [
        {
          name: "The tunnel and cave",
          kind: "reefFormation",
          note: "A tunnel through the rock and a cave on the east side. Overhead; stay out of both.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "queen-angelfish",
        "spiny-lobster",
        "french-grunt",
        "orange-cup-coral",
      ],
    },
  },
  {
    slug: "angelfish-reef-norman-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://bluewaterdiversbvi.com/dive-sites/",
      "https://www.bvidiving.com/diving-angelfish-reef.html",
      "https://bvi-dive-map.com/site/angelfish-reef/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: Blue Water gives 30–80 ft, Cuan Law 20–45 ft and the map 90 ft; the deepest figure sets the range. Ungated: Cuan Law and the map rate it novice.
      name: "Angelfish Reef",
      locationName: "Norman Island, British Virgin Islands",
      forecastLatitude: 18.3103,
      forecastLongitude: -64.6282,
      description:
        "Rocky canyons and ridges on the lee side of Norman Island, fingering out onto a bright sandy bottom. Exposed to the open Caribbean, so the water brings in eagle rays and southern stingrays.",
      marineLife: "Eagle rays · southern stingrays · moray eels · lobsters",
      marineLifeDescription:
        "Snake eels and morays on the sand, anemones with tiny crabs and shrimp, and big lobsters in the ridges. The reef comes alive at night.",
      difficultyLevel: "intermediate",
      depthRange: "6–27 m (20–90 ft)",
      maxDepthMeters: 27,
      currentNote:
        "Exposed to the open Caribbean, with swell at times. Current not documented; ask the crew on the day.",
      divePlan:
        "Work out along the canyons from the mooring, look to the sand for the rays, and return along the shallower ridges. Stay out of any covered gap between the rocks.",
      fitTone: "unknown",
      fitNote:
        "Good for macro and wide-angle. The canyons and sand reach 27 m (90 ft); Open Water divers keep to the shallower ridges, no deeper than 18 m.",
      creatureSlugs: [
        "spotted-eagle-ray",
        "southern-stingray",
        "spotted-moray",
        "spiny-lobster",
        "nurse-shark",
        "sharptail-eel",
      ],
    },
  },
  {
    slug: "carrot-shoal-peter-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://www.bvidiving.com/diving-carrot-shoal.html",
      "https://bvi-dive-map.com/site/carrot-shoal/",
    ],
    briefing: {
      // Gated AOW: Sail Caribbean rates it advanced and names strong currents at an open-water shoal.
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km. The marker lies off the south end of Peter Island, the side the operators describe.
      name: "Carrot Shoal",
      locationName: "South Peter Island, British Virgin Islands",
      forecastLatitude: 18.3266,
      forecastLongitude: -64.5784,
      description:
        "An open-water shoal off the southwest tip of Peter Island, shaped like a train on an underwater platform. A ridge rises straight to the surface from a platform at about 40 ft, with orange sponges and corals along it.",
      marineLife: "Green moray eels · lobsters · fairy basslets · big fish",
      marineLifeDescription:
        "Large green morays and tiny fairy basslets under the ledge on the platform’s edge, and spiny lobsters in the cuts.",
      difficultyLevel: "advanced",
      depthRange: "5–21 m (15–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Strong currents are possible at this open-water site. Carry an SMB, and watch your gas while looking for small animals.",
      divePlan:
        "Down to the platform, along the ledge below the ridge, and back up the ridge. Make the safety stop on an SMB line, not up the ridge to the surface.",
      fitTone: "demanding",
      fitNote: "Open water with current. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-moray",
        "spiny-lobster",
        "spotted-moray",
        "great-barracuda",
        "black-durgon",
        "french-grunt",
      ],
    },
  },
  {
    slug: "willy-t-wreck-peter-island",
    version: 1,
    area: "bvi",
    sources: [
      "https://divebvi.com/dive-sites/",
      "https://www.sailcaribbeandivers.com/more-info/dive-sites/",
      "https://bvi-dive-map.com/site/fearless-willy-t/",
    ],
    briefing: {
      // Position: bvi-dive-map.com marker (no operator publishes coordinates); the operator pages place the site at the same island or point, within about 1 km.
      // Depth: Dive BVI and Sail Caribbean give 65 ft with the crow's nest at 35 ft. Ungated: Sail Caribbean rates it beginner.
      name: "The Willy T",
      locationName: "Peter Island, British Virgin Islands",
      forecastLatitude: 18.3627,
      forecastLongitude: -64.5859,
      description:
        "The William Thornton, the old floating bar from the Bight at Norman Island, sunk as an artificial reef off Key Bay on Peter Island in 2019. Dressed as a pirate ship, with figures on the decks.",
      marineLife: "Reef fish · parrotfish · snappers · barracuda",
      marineLifeDescription:
        "Fish shelter all over the decks and in the crow’s nest, and the wreck draws a steady flow of reef species.",
      difficultyLevel: "intermediate",
      depthRange: "11–20 m (35–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Current not documented; ask the crew on the day. Dive and snorkel boats visit often, so listen for engines.",
      divePlan:
        "Down the line to the decks, around the ship from outside, and up past the crow’s nest. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "A relatively shallow wreck, with the crow's nest at 11 m (35 ft) and the seabed at 20 m (65 ft).",
      landmarks: [
        {
          name: "The crow’s nest",
          kind: "wreckFeature",
          note: "The top of the mast, about 35 ft down, with fish sheltering in it.",
        },
      ],
      creatureSlugs: [
        "french-grunt",
        "queen-parrotfish",
        "yellowtail-snapper",
        "great-barracuda",
        "sergeant-major",
        "blue-tang",
      ],
    },
  },
];
