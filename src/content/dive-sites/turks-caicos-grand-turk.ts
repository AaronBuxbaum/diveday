// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts

import type { DiveSiteTemplate } from "./types";

/** Grand Turk, Salt Cay and South Caicos. */
export const TURKS_CAICOS_GRAND_TURK: DiveSiteTemplate[] = [
  {
    slug: "the-anchor-grand-turk",
    version: 1,
    area: "turks-caicos-grand-turk",
    sources: [
      "https://www.google.com/maps/d/kml?mid=zXPPTPRcaXrU.k_tLjR6p4Jrg&forcekml=1",
      "https://blue-velvet-exploring-the-world.blogspot.com/2019/01/diving-in-grand-turk.html",
      "https://www.grandturkscuba.com/grand-turk-diving/",
    ],
    briefing: {
      // Approximate pin: the operator's map gives a printed latitude and a map pin that differ by up to 350 m; this point averages them and sits 457 m (500 yards) off the western shore, where Undercurrent puts the wall. Good to about 300 m.
      // Gated AOW at an 18 m plan floor: the anchor lies at about 11 m on top of the wall and the drop-off starts near 9 m (the operator's map; a blog by two Open Water divers who dived it to 18 m). No operator source rates it as an Open Water dive, so the walls rule applies; the wall drops beyond the plan.
      name: "The Anchor",
      locationName: "Columbus Landfall National Park, Grand Turk",
      forecastLatitude: 21.4775,
      forecastLongitude: -71.1539,
      description:
        "An old anchor lies on the sand at the top of the wall, close to the mooring, with a chain running west over the edge. The reef around it is busy with fish, and the wall drops off beyond the plan.",
      marineLife: "Blue chromis · green turtles · garden eels · barrel sponges",
      marineLifeDescription:
        "Clouds of blue chromis hang over the reef, and a field of garden eels sits on a sandy clearing near the anchor.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "Little to no current is typical, most of all in summer; it can change, so carry an SMB.",
      divePlan:
        "Down the mooring to the anchor at about 11 m (35 ft), along the top of the wall no deeper than 18 m (60 ft), then back up the mooring line for the safety stop. The wall drops beyond this plan.",
      fitTone: "demanding",
      fitNote:
        "A dive on top of a wall that drops past the plan. The edge is close; stay above your floor.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The anchor",
          kind: "pointOfInterest",
          note: "An old anchor of the type used by British naval ships, with a chain that runs over the wall and fades into the coral near 18 m. It is heavily covered in coral and sponge.",
        },
      ],
      creatureSlugs: ["blue-chromis", "green-sea-turtle", "garden-eel", "giant-barrel-sponge"],
    },
  },
  {
    slug: "the-library-grand-turk",
    version: 1,
    area: "turks-caicos-grand-turk",
    sources: [
      "https://www.google.com/maps/d/kml?mid=zXPPTPRcaXrU.k_tLjR6p4Jrg&forcekml=1",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://blue-velvet-exploring-the-world.blogspot.com/2019/01/diving-in-grand-turk.html",
      "https://www.grandturkscuba.com/grand-turk-diving/",
    ],
    briefing: {
      // Approximate pin: the operator's map gives a printed latitude and a map pin that differ by up to 350 m; this point averages them and sits 457 m (500 yards) off the western shore, where Undercurrent puts the wall. Good to about 300 m.
      // Ungated: the shallowest site on the wall, starting at 6 m with a shelf at 9 to 11 m and described as a popular second or third dive (the operator's map); the plan floor is 18 m and the wall drops beyond it.
      name: "The Library",
      locationName: "Columbus Landfall National Park, Grand Turk",
      forecastLatitude: 21.4696,
      forecastLongitude: -71.1519,
      description:
        "Named for its spot off the public library in town, this is one of the shallowest sites on the wall. A split crevice leads over the edge to a shelf, and small life rewards a slow look. Night dives show the cup corals in bloom.",
      marineLife: "Orange cup coral · sea fans · corallimorphs · grunts",
      marineLifeDescription:
        "Go slowly along the shelf; orange cup corals, nudibranchs and orange ball corallimorphs reward a close look.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote:
        "Do not dive while a ship is alongside or maneuvering. Tour and snorkel boats use this site, and cruise-ship days bring more traffic: listen for engines and surface with an SMB. Little to no current is typical, most of all in summer.",
      divePlan:
        "Down the mooring, over the crevice onto the shelf at 9 to 11 m (30 to 35 ft), and south along the wall no deeper than 18 m (60 ft). Make the safety stop on the mooring line. The wall drops beyond this plan.",
      fitTone: "welcoming",
      fitNote: "A shallow shelf and a gentle pace. Keep your depth well above the edge.",
      creatureSlugs: [
        "orange-cup-coral",
        "common-sea-fan",
        "bluestriped-grunt",
        "sergeant-major",
        "grooved-brain-coral",
      ],
    },
  },
  {
    slug: "black-forest-grand-turk",
    version: 1,
    area: "turks-caicos-grand-turk",
    sources: [
      "https://www.google.com/maps/d/kml?mid=zXPPTPRcaXrU.k_tLjR6p4Jrg&forcekml=1",
      "https://undercurrent.org/UCnow/dive_magazine/2006/GrandTurk200601.html",
      "https://www.afar.com/places/columbus-landfall-national-park-cockburn-town",
    ],
    briefing: {
      // Approximate pin: the operator's map gives a printed latitude and a map pin that differ by up to 350 m; this point averages them and sits 457 m (500 yards) off the western shore, where Undercurrent puts the wall. Good to about 300 m.
      // Advanced Open Water: a wall with a plan floor of 30 m; the black coral grows at 18 to 30 m (60 to 100 ft) and the wall drops far below.
      name: "Black Forest",
      locationName: "Columbus Landfall National Park, Grand Turk",
      forecastLatitude: 21.4799,
      forecastLongitude: -71.1533,
      description:
        "Under the boat the reef is only 11 m deep, and a few fin kicks lead to a wall that is undercut at one section. The shadow lets black coral grow far shallower than usual, at 18 to 30 m, with three kinds on the site. Wire coral and sponges cover the rest of the face.",
      marineLife: "Black coral · wire coral · nurse sharks · tiger grouper",
      marineLifeDescription:
        "View the black coral from the open side of the wall; nurse sharks rest on the sand patches and tiger groupers watch from ledges.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Little to no current is typical, most of all in summer; it can change, so carry an SMB.",
      divePlan:
        "Down the mooring to about 11 m (35 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. The undercut is overhead; stay out of it and view the coral from the open side of the wall.",
      fitTone: "demanding",
      fitNote: "The black coral is on the wall face. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["black-coral", "nurse-shark", "tiger-grouper", "hawksbill-turtle"],
    },
  },
  {
    slug: "amphitheatre-grand-turk",
    version: 1,
    area: "turks-caicos-grand-turk",
    sources: [
      "https://www.google.com/maps/d/kml?mid=zXPPTPRcaXrU.k_tLjR6p4Jrg&forcekml=1",
      "https://undercurrent.org/UCnow/dive_magazine/2006/GrandTurk200601.html",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Approximate pin: the operator's map gives a printed latitude and a map pin that differ by up to 350 m; this point averages them and sits 457 m (500 yards) off the western shore, where Undercurrent puts the wall. Good to about 300 m.
      // Advanced Open Water: a wall with a plan floor of 30 m; the V-shaped split opens at about 24 m (80 ft) and the wall drops far below.
      name: "Amphitheater",
      locationName: "Columbus Landfall National Park, Grand Turk",
      forecastLatitude: 21.4915,
      forecastLongitude: -71.1546,
      description:
        "A sandy slope falls from about 12 m to about 24 m, then drops steeply at a V-shaped split in the wall. Black coral, sea fans and tube sponges cover the wall around the bowl, with a hard-coral reef under the boat.",
      marineLife: "Queen angelfish · ocean triggerfish · jacks · black coral",
      marineLifeDescription: "Angelfish and triggerfish work the wall edge.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote:
        "Little to no current is typical, most of all in summer; it can change, so carry an SMB.",
      divePlan:
        "Down the mooring to about 9 m (30 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. Make the safety stop on the mooring line.",
      fitTone: "demanding",
      fitNote: "A sand slope into the wall. Keep your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["queen-angelfish", "ocean-triggerfish", "bar-jack", "black-coral"],
    },
  },
  {
    slug: "finbars-reef-grand-turk",
    version: 1,
    area: "turks-caicos-grand-turk",
    sources: [
      "https://www.google.com/maps/d/kml?mid=zXPPTPRcaXrU.k_tLjR6p4Jrg&forcekml=1",
      "https://undercurrent.org/UCnow/dive_magazine/2006/GrandTurk200601.html",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Approximate pin: the operator's map gives a printed latitude and a map pin that differ by up to 350 m; this point averages them and sits 457 m (500 yards) off the western shore, where Undercurrent puts the wall. Good to about 300 m.
      // Advanced Open Water: a wall with a plan floor of 30 m; the operator says it can be dived deep or shallow, and the plan holds the 30 m floor for the wall.
      name: "Finbar's Reef",
      locationName: "Columbus Landfall National Park, Grand Turk",
      forecastLatitude: 21.4851,
      forecastLongitude: -71.1547,
      description:
        "A sloping back reef runs to a broken wall with big outcrops and undercuts. The undercuts are overhead; stay out of them. Wire coral grows out from the face, a mound of red gorgonians sits in 24 m of water, and large Nassau groupers are common.",
      marineLife: "Nassau grouper · green moray · tiger grouper · hawksbill turtle",
      marineLifeDescription:
        "Ledges and wire coral hold groupers; the back reef near the boat is worth the slow return.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Little to no current is typical, most of all in summer; it can change, so carry an SMB.",
      divePlan:
        "Down the mooring to about 11 m (35 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. The undercuts are overhead; stay out.",
      fitTone: "demanding",
      fitNote: "A wall that can be dived deep or shallow. The plan floor is 30 m; hold it.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["nassau-grouper", "green-moray", "tiger-grouper", "hawksbill-turtle"],
    },
  },
  {
    slug: "mcdonalds-grand-turk",
    version: 1,
    area: "turks-caicos-grand-turk",
    sources: [
      "https://www.google.com/maps/d/kml?mid=zXPPTPRcaXrU.k_tLjR6p4Jrg&forcekml=1",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://www.atlasandboots.com/travel-blog/wall-diving-turks-and-caicos/",
    ],
    briefing: {
      // Approximate pin: the operator's map gives a printed latitude and a map pin that differ by up to 350 m; this point averages them and sits 457 m (500 yards) off the western shore, where Undercurrent puts the wall. Good to about 300 m.
      // Advanced Open Water: a wall with a plan floor of 30 m; the wall drops far below.
      // The pin is 133 m from Amphitheater's: both are the operator's own distinct points derived the same way, and no source supports a wider separation, so neither is moved.
      // Overhead: the coral arch is a stay-out; it exits over the wall at about 21 m (70 ft).
      name: "McDonald's",
      locationName: "Columbus Landfall National Park, Grand Turk",
      forecastLatitude: 21.4927,
      forecastLongitude: -71.1546,
      description:
        "Named for a living coral arch at the lip of the wall. The back reef slopes from about 9 m to a dip near 17 m, where the arch grows, and the wall falls away beyond it.",
      marineLife: "Nassau grouper · blue tang · queen angelfish",
      marineLifeDescription: "The arch is the landmark; the reef around it is busy with fish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote:
        "Little to no current is typical, most of all in summer; it can change, so carry an SMB.",
      divePlan:
        "Down the mooring to about 9 m (30 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. The arch is overhead; stay out of it and pass over the wall edge instead.",
      fitTone: "demanding",
      fitNote: "An arch you admire from outside. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The coral arch",
          kind: "reefFormation",
          note: "A living arch where the sand dips at the lip of the wall. It is a short swim-through and an overhead; stay out of it.",
        },
      ],
      creatureSlugs: ["nassau-grouper", "blue-tang", "queen-angelfish", "queen-triggerfish"],
    },
  },
  {
    slug: "coral-canyon-grand-turk",
    version: 1,
    area: "turks-caicos-grand-turk",
    sources: [
      "https://www.google.com/maps/d/kml?mid=zXPPTPRcaXrU.k_tLjR6p4Jrg&forcekml=1",
      "https://www.afar.com/places/columbus-landfall-national-park-cockburn-town",
    ],
    briefing: {
      // Approximate pin: the operator's map gives a printed latitude and a map pin that differ by up to 350 m; this point averages them and sits 457 m (500 yards) off the western shore, where Undercurrent puts the wall. Good to about 300 m. The map calls the site Coral Canyons.
      // Advanced Open Water: gated for the cruise-ship traffic at the Grand Turk Cruise Center to the south, a hazard depth cannot express. The canyon floor is 26 m, which on its own would not gate; a wide sand bed lies deeper still, outside the plan.
      name: "Coral Canyon",
      locationName: "Columbus Landfall National Park, Grand Turk",
      forecastLatitude: 21.4506,
      forecastLongitude: -71.1576,
      description:
        "A canyon cuts into the reef from about 18 m to about 26 m, then opens onto a wide sand bed far below the plan. The back reef is rich in hard coral, and nurse sharks rest under mushroom-shaped coral heads.",
      marineLife: "Hard corals · nurse sharks · reef fish",
      marineLifeDescription:
        "Hard coral covers the canyon walls; look under the big coral heads of the back reef for sleeping nurse sharks.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 26,
      currentNote:
        "Ships dock at the Grand Turk Cruise Center to the south, so do not dive while a ship is alongside or maneuvering, carry an SMB, and listen for engines. Little to no current is typical, most of all in summer.",
      divePlan:
        "Down the mooring at about 12 m (40 ft), north to the canyon, along it no deeper than 26 m (85 ft), and back along the shallow back reef. The sand bed lies well beyond the plan.",
      fitTone: "demanding",
      fitNote: "A canyon dive with a floor you set in advance. Hold it.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["nurse-shark", "nassau-grouper", "queen-angelfish", "blue-tang"],
    },
  },
];
