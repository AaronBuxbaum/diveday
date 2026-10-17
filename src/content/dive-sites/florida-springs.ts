// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Freshwater: the springs. */
export const FLORIDA_SPRINGS: DiveSiteTemplate[] = [
  {
    slug: "devils-den",
    version: 2,
    area: "florida-springs",
    sources: [
      "https://www.devilsden.com/",
      "https://www.florida-guidebook.com/devils-den-spring/",
      "https://floridanaturecoast.org/County/Levy/DevilsDen/DevilsDen.aspx",
    ],
    briefing: {
      name: "Devil's Den",
      locationName: "Williston, Florida",
      forecastLatitude: 29.407,
      forecastLongitude: -82.4762,
      description:
        "A spring inside a collapsed limestone karst dome, entered down a staircase through a hole in the ground. Water at 22 °C all year, and shafts of light coming through the opening above.",
      marineLife: "Freshwater — no marine life",
      marineLifeDescription:
        "Nothing swims here to speak of. The dive is the light, the rock, and the fossil beds in the walls.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 16,
      currentNote: "No current. Confined and calm; the only variable is how many divers are in it.",
      divePlan:
        "Circle the basin at depth, then come up into the light column and spend the end of the dive shallow under the opening. The only way up is through the opening, so keep the light column in sight the whole dive.",
      fitTone: "welcoming",
      fitNote:
        "Warm, still, and enclosed — the training site half of north Florida certified in. Overhead is limited to the open dome; there is no cave diving here without cave training.",
      fieldGuideTipsHeading: "Look at the rock, not for fish",
      landmarks: [
        {
          name: "The light column",
          kind: "pointOfInterest",
          note: "Sun through the hole in the roof, best in the middle of the day. The reason people come.",
        },
        {
          name: "Fossil beds",
          kind: "pointOfInterest",
          note: "Pleistocene bone has come out of this basin. What is left in the walls stays in the walls.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "blue-grotto",
    version: 2,
    area: "florida-springs",
    sources: [
      "https://www.padi.com/dive-site/united-states-of-america-usa/blue-grotto/",
      "https://floridanaturecoast.org/County/Levy/BlueGrotto/BlueGrotto.aspx",
    ],
    briefing: {
      name: "Blue Grotto",
      locationName: "Williston, Florida",
      forecastLatitude: 29.3879,
      forecastLongitude: -82.4857,
      description:
        "A clear-water cavern dive: a basin dropping to 30 m with a guideline through the cavern zone and an air bell partway down, at 22 °C year round.",
      marineLife: "Freshwater — turtles and a resident eel",
      marineLifeDescription:
        "Softshell turtles, bream, and Virgil, the resident softshell turtle, who has been here longer than most of the instructors.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote: "No current at all. Depth and the overhead are what the plan is about.",
      divePlan:
        "Down the basin wall to the platform, along the guideline within the cavern zone only, and back up with light in hand.",
      fitTone: "demanding",
      fitNote:
        "Clear and calm, but it is deep and it is overhead. Stay inside the daylight zone and on the line unless you hold a cavern or cave card.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The air bell",
          kind: "pointOfInterest",
          note: "A pocket of breathable air partway down the cavern. A curiosity, not an exit.",
        },
        {
          name: "The guideline",
          kind: "navigationMark",
          note: "Follow it, keep it in sight, and turn where it says. That is the whole rule here.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "ginnie-springs",
    version: 2,
    area: "florida-springs",
    sources: [
      "https://scubadiverlife.com/dive-site-ginnie-springs-florida",
      "https://en.wikipedia.org/wiki/Ginnie_Springs",
    ],
    briefing: {
      name: "Ginnie Springs",
      locationName: "High Springs, Florida",
      forecastLatitude: 29.836,
      forecastLongitude: -82.7,
      description:
        "Gin-clear spring water flowing into the tannic Santa Fe River, with the Ginnie Ballroom — a genuinely large open cavern — at the head of it. 22 °C all year.",
      marineLife: "Freshwater — gar, bream, turtles",
      marineLifeDescription:
        "Longnose gar hang at the line where the clear spring meets the dark river water. Worth the wait.",
      difficultyLevel: "beginner",
      depthMinMeters: 4,
      maxDepthMeters: 16,
      currentNote:
        "Spring outflow pushes against you on the way in and carries you out. After heavy rain the river backs into the basin and the visibility goes; the park closes the springs when that happens, so call first.",
      divePlan:
        "Into the Ballroom against the flow, one circuit inside the daylight zone, and let the spring run push you back out to the basin.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, warm and astonishingly clear. The Ballroom is grated beyond the cavern — everything past that grate needs cave training.",
      landmarks: [
        {
          name: "The Ballroom",
          kind: "pointOfInterest",
          note: "A cavern big enough to lose a group in. Daylight fades past about 9 m, so carry a light.",
        },
        {
          name: "The tannic line",
          kind: "pointOfInterest",
          note: "Where the clear spring run meets tea-colored river water. Both are fresh water. Outside the basin you are in a river with tubers and boats on it, so stay on the flag.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "morrison-springs",
    version: 2,
    area: "florida-springs",
    sources: [
      "https://www.mywaltonfl.gov/Facilities/Facility/Details/Morrison-Springs-29",
      "https://blogs.ifas.ufl.edu/waltonco/2018/01/18/morrison-springs-park-walton-county-florida",
    ],
    briefing: {
      name: "Morrison Springs",
      locationName: "Walton County, Florida",
      forecastLatitude: 30.6577,
      forecastLongitude: -85.9046,
      description:
        "A wide, second-magnitude spring basin in a cypress swamp, with a 15 m cavern at the bottom. A Walton County park, with boardwalks and a dive dock at the water.",
      marineLife: "Freshwater — bass, bream, turtles",
      marineLifeDescription:
        "Largemouth bass hang at the edge of the clear water where it meets the swamp.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 15,
      currentNote:
        "Gentle outflow. Visibility drops fast after heavy rain when the swamp pushes back in.",
      divePlan:
        "Down the basin, a look at the cavern entrance from outside it, and a slow shallow circuit under the cypress.",
      fitTone: "welcoming",
      fitNote:
        "Easy, shallow, and a genuinely lovely place to be. The cavern is for cavern-trained divers only.",
      landmarks: [
        {
          name: "The cavern entrance",
          kind: "pointOfInterest",
          note: "Three openings at the base of the basin. Look in from the daylight; do not go in without the card.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "three-sisters-springs",
    version: 2,
    area: "florida-springs",
    sources: [
      "https://www.fws.gov/refuge/crystal-river/visit-us/activities/scuba-diving",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+like+%27THREE+SISTERS%25%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Three Sisters Springs",
      locationName: "Crystal River, Florida",
      forecastLatitude: 28.89,
      forecastLongitude: -82.5894,
      description:
        "Clear, warm spring water inside the Crystal River refuge. It is a summer dive: scuba is allowed only from 1 April to 14 November. In winter the manatees move in and the spring closes to scuba.",
      marineLife: "Mullet · blue crabs",
      marineLifeDescription:
        "The dive is the water and the vents. Manatees crowd in during winter, when scuba is not allowed here.",
      difficultyLevel: "beginner",
      depthMinMeters: 1,
      maxDepthMeters: 5,
      currentNote:
        "Gentle spring flow. Refuge rules change with the season, so check them before the dive.",
      divePlan:
        "Boats stay in the canal, so swim in. A slow, shallow circuit of the spring, staying off the bottom so the sand stays down. Keep out of any roped-off sanctuary area, and if a manatee comes to you, hang still: no touching, chasing or feeding, at any time of year.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and easy. What it asks for is good buoyancy: a fin on the bottom clouds the whole spring.",
      landmarks: [
        {
          name: "The spring vents",
          kind: "pointOfInterest",
          note: "Where the warm water comes up through the bottom. Hover above them, never in them.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "rainbow-river",
    version: 2,
    area: "florida-springs",
    sources: [
      "https://en.wikipedia.org/wiki/Rainbow_River",
      "https://floridasprings.org/outstanding-florida-springs-rainbow-spring-group/",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+like+%27RAINBOW%25%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
      "https://www.underwaterjournal.com/diving-floridas-rainbow-river/",
      "https://www.ocalamarion.com/directory/kp-hole-park/",
    ],
    briefing: {
      name: "Rainbow River",
      locationName: "KP Hole Park, Dunnellon, Florida",
      forecastLatitude: 29.0869,
      forecastLongitude: -82.4297,
      description:
        "A first-magnitude spring run dived as a slow downstream drift over white sand and eelgrass, in 22 °C water clear enough to read the bottom from a boat.",
      marineLife: "Freshwater — turtles, gar, bass, otters",
      marineLifeDescription:
        "Softshell turtles work the grass beds, and the sand boils where the spring vents push up through the bottom.",
      difficultyLevel: "beginner",
      depthMinMeters: 2,
      maxDepthMeters: 8,
      currentNote:
        "A steady downstream drift, so this is a one-way dive. The river is busy with boats, kayaks and tubers all day: every group tows a dive flag and surfaces beside it, never in the channel.",
      divePlan:
        "Go up the river from KP Hole Park, drop in about 1.5 km upstream, and drift back down to the park, staying off the eelgrass. Diving is not allowed in the state park's headspring area, so do not start any higher than the signs allow.",
      fitTone: "welcoming",
      fitNote:
        "Warm, shallow, effortless. Ideal for a first drift and for anyone who wants an hour of doing nothing beautifully.",
      landmarks: [
        {
          name: "The sand boils",
          kind: "pointOfInterest",
          note: "Spring vents pushing up through white sand, boiling it like water in a pan.",
        },
        {
          name: "The eelgrass beds",
          kind: "pointOfInterest",
          note: "Hover above them. A fin-print in a grass bed lasts for months.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Devil's Spring System — Devil's Eye, Devil's Ear, Little Devil (Ginnie Springs; open-water divers in the basins with no lights, only cavern/cave-certified divers may carry lights)"
  {
    slug: "devils-eye-and-ear",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://ginniespringsoutdoors.com/dive/devils-spring-system/",
      "https://dan.org/alert-diver/article/diving-floridas-springs/",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+like+%27%25DEVIL%25%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Devil's Eye and Devil's Ear",
      locationName: "Ginnie Springs, High Springs, Florida",
      forecastLatitude: 29.8347,
      forecastLongitude: -82.6967,
      description:
        "Three small springs along a short run into the Santa Fe River at Ginnie Springs. Devil's Eye is a round window about 6 m deep, Little Devil a narrow crack in the rock you can look straight up out of, and Devil's Ear pours out where the clear spring meets the tea-colored river.",
      marineLife: "Turtles · small freshwater fish",
      marineLifeDescription:
        "Turtles ride the run, and where the tannic river slides over the clear water the light turns to stained glass.",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      maxDepthMeters: 15,
      currentNote:
        "Strong outflow from the cave opening at the bottom of the Ear, and a layer of dark tannic river water often sits over the basin. After heavy rain the Santa Fe floods the springs and the park closes them, so call first.",
      divePlan:
        "Open Water divers dive the three basins with no lights at all: Ginnie Springs allows lights in this system only for cavern- and cave-certified divers. Look into the cave openings from the daylight and never go past them. Outside the basins you are in a river with tubers and boats on it, so tow a dive flag and surface beside it.",
      fitTone: "demanding",
      fitNote:
        "Shallow, but every opening here leads into a cave system that runs for miles. The no-lights rule exists to keep untrained divers out of it.",
      landmarks: [
        {
          name: "Devil's Eye",
          kind: "pointOfInterest",
          note: "A round opening about 6 m across and 6 m deep, with a small cavern entrance at the bottom. Look in; going in needs cave training.",
        },
        {
          name: "Little Devil",
          kind: "pointOfInterest",
          note: "A fissure barely more than a meter wide and nearly 15 m deep. From the bottom you look up at the sky.",
        },
        {
          name: "Devil's Ear",
          kind: "pointOfInterest",
          note: "Where the spring run meets the Santa Fe. Water surges out of the cave below with real force; stay above it.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Alexander Springs (Ocala National Forest; the only scuba site in the forest; certified divers, open water)"
  {
    slug: "alexander-springs",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.fs.usda.gov/r08/florida/recreation/alexander-springs-recreation-area",
      "https://www.seminolescuba.com/florida-springs.htm",
      "https://www.padi.com/dive-site/united-states-of-america-usa/alexander-springs/",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+like+%27ALEXANDER%25%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Alexander Springs",
      locationName: "Ocala National Forest, Florida",
      forecastLatitude: 29.0813,
      forecastLongitude: -81.5759,
      description:
        "A first-magnitude spring pool about 90 m across, and the only place in the Ocala National Forest where scuba is allowed. White sand slopes gently down to a limestone ledge at the vent, in 22 °C water.",
      marineLife: "Small freshwater fish · spring grasses",
      marineLifeDescription:
        "Little fish dart over the sand, and native grasses wave in the outflow near the vent.",
      difficultyLevel: "beginner",
      depthMinMeters: 1,
      maxDepthMeters: 8,
      currentNote:
        "Strong flow straight out of the vent; the rest of the pool is calm. It is also the forest's favorite swimming hole, so expect swimmers overhead on a warm day.",
      divePlan:
        "Down the sand slope to the ledge at the vent, a look at the small cavern opening from outside it, and a slow circuit back through the grass. Anything overhead past the mouth of the vent needs cavern training.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, clear and gently sloped: a natural first spring dive. The day-use area keeps set hours, so check them and the fees before you drive out.",
      landmarks: [
        {
          name: "The vent ledge",
          kind: "pointOfInterest",
          note: "A tall limestone ledge beside the vent, the deepest part of the pool. Feel the flow from beside it, not in front of it.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Blue Spring State Park (Orange City; open water to 60 ft, no lights; 32-diver cap; spring run closed Nov 15 – Mar 15 for manatees)"
  {
    slug: "blue-spring-orange-city",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.floridastateparks.org/parks-and-trails/blue-spring-state-park/experiences-amenities",
      "https://www.seminolescuba.com/florida-springs.htm",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+%3D+%27VOLUSIA+BLUE+SPRING%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Blue Spring",
      locationName: "Blue Spring State Park, Orange City, Florida",
      forecastLatitude: 28.9475,
      forecastLongitude: -81.3396,
      description:
        "The largest spring on the St. Johns River and a winter refuge for manatees. From spring to autumn the run is open to divers, with the deep blue vent at its head.",
      marineLife: "Freshwater fish · turtles",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      // Capped at the park's 60 ft limit for Open Water divers; the vent drops far deeper, into cave.
      maxDepthMeters: 18,
      currentNote:
        "Strong outflow at the boil, enough to push a diver up and out; the run below it is gentle. The spring and run close to all water activity from 15 November to at least mid-March, and stay closed longer if the manatees stay.",
      divePlan:
        "Park rules: Open Water divers carry no lights and go no deeper than 18 m (60 ft), though the vent keeps going; dive only in the designated areas, at least two to a party, with no more than 32 divers in the water at once, and finish an hour before sunset. If a manatee is still in the run, keep 15 m (50 ft) away: no touching, chasing or feeding.",
      landmarks: [
        {
          name: "The vent",
          kind: "pointOfInterest",
          note: "Where the spring rises at the head of the run. It drops away past the 18 m limit; the deeper part is for cavern- and cave-trained divers with lights.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Troy Spring State Park (Branford; open water only, certification shown, no solo, no lights; Madison steamboat wreck in the run)"
  {
    slug: "troy-spring",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.floridastateparks.org/parks-and-trails/troy-spring-state-park/experiences-amenities",
      "https://map.mysuwanneeriver.com/district-springs/troy-spring-23",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+like+%27TROY%25%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Troy Spring",
      locationName: "Troy Spring State Park, Branford, Florida",
      forecastLatitude: 30.006,
      forecastLongitude: -82.9975,
      description:
        "A 21 m spring bowl on the Suwannee River, ringed by high limestone banks. The bottom ribs of the steamboat Madison, scuttled here in 1863 to keep her out of Union hands, lie in the shallow run.",
      marineLife: "Freshwater fish · turtles",
      marineLifeDescription: "Fish and turtles gather in the run between the spring and the river.",
      difficultyLevel: "intermediate",
      depthMinMeters: 1,
      maxDepthMeters: 21,
      currentNote:
        "Calm in the bowl. When the Suwannee runs high, dark river water backs into the spring and the visibility can vanish, so call the park first. Past the end of the run you are on the river, with boats on it: tow a dive flag.",
      divePlan:
        "Down the switchback ramp to the dock, a circuit of the bowl, and finish shallow over the Madison. Park rules: open water diving only, card shown or left on the dashboard, no solo diving, no lights, no scooters, and out of the water an hour before sunset.",
      fitTone: "welcoming",
      fitNote:
        "A training favorite, but the bowl is deeper than an Open Water card's 18 m; set the depth before the dive.",
      landmarks: [
        {
          name: "The Madison",
          kind: "wreckFeature",
          note: "What is left of the hull after salvagers took the rest: the bottom ribs, in shallow water. A historic site; touch nothing.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Manatee Springs main spring (Manatee Springs State Park, Chiefland; open water; register, card on dashboard, done 1 h before sunset)"
  {
    slug: "manatee-springs",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.floridastateparks.org/parks-and-trails/manatee-springs-state-park/experiences-amenities",
      "https://extreme-exposure.com/manatee-springs/",
      "https://en.wikipedia.org/wiki/Manatee_Springs_State_Park",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+%3D+%27MANATEE+SPRING%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Manatee Springs",
      locationName: "Manatee Springs State Park, Chiefland, Florida",
      forecastLatitude: 29.4896,
      forecastLongitude: -82.9768,
      description:
        "A first-magnitude spring that boils up blue among the cypress and runs a short way into the Suwannee. In winter manatees come up the run for the warm water, which is how the park got its name.",
      marineLife: "Manatees in winter · fish · turtles",
      difficultyLevel: "intermediate",
      depthMinMeters: 2,
      maxDepthMeters: 12,
      currentNote:
        "Very strong outflow at the vent, and divers' bubbles stir up the iron bacteria that cut the visibility. In winter the park closes the run to boats and can keep divers out of the headspring while manatees are in it. The run opens onto the Suwannee: tow a flag past the swimming area.",
      divePlan:
        "Register in person (no reservations, whole party present) by three hours before sundown, card on the dashboard, and out of the water an hour before sundown. Open Water divers carry no lights; the cave below the vent is for cave divers only. A manatee met in the spring: hang still and keep 15 m (50 ft) away, with no touching, chasing or feeding.",
      fitNote:
        "Shallow, but the flow at the vent is serious. The park takes 18 Open Water and cavern divers at a time across this spring and the Catfish Hotel.",
      landmarks: [
        {
          name: "The vent",
          kind: "pointOfInterest",
          note: "The boil at the head of the run, where the cave system breathes out. Stay above it and out of the opening.",
        },
      ],
      creatureSlugs: ["manatee"],
    },
  },
  // Denominator row: "Catfish Hotel (Manatee Springs State Park; open water and cavern; no free diving or swimming)"
  {
    slug: "catfish-hotel",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.floridastateparks.org/parks-and-trails/manatee-springs-state-park/experiences-amenities",
      "https://extreme-exposure.com/manatee-springs/",
      "https://en.wikipedia.org/wiki/Manatee_Springs_State_Park",
      "https://www.openstreetmap.org/way/400874147",
    ],
    briefing: {
      name: "Catfish Hotel",
      locationName: "Manatee Springs State Park, Chiefland, Florida",
      forecastLatitude: 29.4887,
      forecastLongitude: -82.976,
      description:
        "A duckweed-covered sinkhole a few steps from the Manatee Springs headspring, and a window into the cave system beneath the park. Under the green mat the water opens into a clear basin, lit from above as divers' bubbles part the weed.",
      marineLife: "Freshwater fish · turtles",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      // The cavern zone runs to about 21 m; that part is for cavern-certified divers.
      maxDepthMeters: 21,
      currentNote:
        "Little flow in the open basin, which sits off to the side of the cave; very strong flow on the siphon side. Fine silt on the bottom, so fin carefully. Scuba only: no swimming or free diving here.",
      divePlan:
        "Open Water divers stay in the open basin with no lights. The cavern zone is for cavern-certified divers with lights, and only within the daylight; past it is cave. The only way up is the opening you came in through. Never try to swim underwater to the main spring: that is a cave traverse.",
      fitTone: "demanding",
      fitNote:
        "A sinkhole with cave in every direction. Easy water, but it rewards divers who stay exactly where their card allows.",
      landmarks: [
        {
          name: "The duckweed",
          kind: "pointOfInterest",
          note: "A green mat over the whole surface. It clears where the bubbles rise, and it will be all over you when you climb out.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Fanning Springs State Park (open water in the designated swimming area, 18–21 ft; register, no reservations)"
  {
    slug: "fanning-springs",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.floridastateparks.org/parks-and-trails/fanning-springs-state-park/experiences-amenities",
      "https://travel.padi.com/dive-site/united-states-of-america-usa/fanning-springs-state-park/",
      "https://floridanaturecoast.org/County/Levy/FanningSpringsStatePark/FanningSpringsStatePark.aspx",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+%3D+%27FANNING+SPRINGS%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Fanning Springs",
      locationName: "Fanning Springs State Park, Fanning Springs, Florida",
      forecastLatitude: 29.5876,
      forecastLongitude: -82.9353,
      description:
        "A shallow, clear spring a short run from the Suwannee River, where divers can settle beside the boil and watch the aquifer pour up out of the sand. 22 °C all year.",
      marineLife: "Musk turtles · bass · manatees in winter",
      marineLifeDescription:
        "Turtles work the limestone and fallen cypress logs, and in the cold months manatees come up from the river.",
      difficultyLevel: "beginner",
      depthMinMeters: 1,
      maxDepthMeters: 7,
      currentNote:
        "Gentle except right at the boil. Diving is in the designated swimming area only. When the Suwannee runs high, call ahead about the visibility.",
      divePlan:
        "Register with park staff by three hours before sunset (first come, first served, no holding spots), card on the dashboard, and finish an hour before sunset. Open Water divers carry no lights; 15 divers at a time. A manatee in the spring: keep 15 m (50 ft) away, with no touching, chasing or feeding.",
      fitTone: "welcoming",
      fitNote: "Shallow and easy. A good first spring, and good for checking out a new diver.",
      landmarks: [
        {
          name: "The boil",
          kind: "pointOfInterest",
          note: "Where the water comes up out of the Floridan aquifer. Hover beside it and watch the sand dance.",
        },
      ],
      creatureSlugs: ["manatee"],
    },
  },
  // Denominator row: "Orange Grove Sink (Wes Skiles Peacock Springs State Park; the only basin open-water divers may use, no lights)"
  {
    slug: "orange-grove-sink",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.floridastateparks.org/parks-and-trails/wes-skiles-peacock-springs-state-park/experiences-amenities",
      "https://extreme-exposure.com/peacock-springs/",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+%3D+%27ORANGE+GROVE%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Orange Grove Sink",
      locationName: "Wes Skiles Peacock Springs State Park, Live Oak, Florida",
      forecastLatitude: 30.1273,
      forecastLongitude: -83.1308,
      description:
        "A duckweed-covered sinkhole in Peacock Springs State Park, and the only basin in the park Open Water divers may use. Below the green mat, beams of light fall into a clear basin over the doorway to one of Florida's great underwater caves.",
      marineLife: "Freshwater fish · turtles",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      // Capped at the open basin's floor; the cavern zone below, to 30 m, is gated by card.
      maxDepthMeters: 21,
      currentNote:
        "No real current in the open basin. Summer algae blooms can cloud it; on those days open water diving is not worth it.",
      divePlan:
        "Sign in, show your card or leave it on the dashboard, and dive in pairs or more: no solo diving and no lights for Open Water divers. Stay in the open basin. The cavern zone slopes away on the downstream side to 30 m and needs cavern certification, and everything past it needs cave training. The only way up is the opening above you. Out an hour before sundown.",
      fitTone: "demanding",
      fitNote:
        "The water is easy; the setting is not. This is a cave diver's park, and the open basin is the whole of an Open Water diver's dive.",
      landmarks: [
        {
          name: "The north wall",
          kind: "pointOfInterest",
          note: "The deeper, steeper edge of the basin; the rest slopes gently in from the woods.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Ichetucknee Blue Hole (Jug Hole) (Ichetucknee Springs State Park; scuba only here, not in the river; cavern/cave cert to enter the vent)"
  {
    slug: "ichetucknee-blue-hole",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.floridastateparks.org/parks-and-trails/ichetucknee-springs-state-park/experiences-amenities",
      "https://www.floridastateparks.org/learn/snorkel-blue-hole",
      "https://florida-guidebook.com/?p=531",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+like+%27BLUE+HOLE+SPRING+%28COLUMBIA%29%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Blue Hole (Jug Spring)",
      locationName: "Ichetucknee Springs State Park, Fort White, Florida",
      forecastLatitude: 29.9809,
      forecastLongitude: -82.7592,
      description:
        "The only first-magnitude spring in Ichetucknee Springs State Park: a deep blue pool where a limestone shaft drops about 12 m to the mouth of a cave. 22 °C all year.",
      marineLife: "Turtles · freshwater fish",
      difficultyLevel: "intermediate",
      depthMinMeters: 2,
      maxDepthMeters: 12,
      currentNote:
        "A powerful outflow: about 67 million gallons a day push up the shaft, more than most swimmers can make headway against. Scuba is allowed here only, never in the river or the other springs.",
      divePlan:
        "Open Water divers stay in the pool and the open top of the shaft. Going in through the spring vent needs cavern or cave certification. Dive in pairs at least, finish an hour before sunset, and keep 15 m (50 ft) from any manatee. It is about half a mile of trail from the parking lot, so bring a cart for the gear.",
      fitTone: "demanding",
      fitNote:
        "Short and spectacular, but the flow is strong and the cave starts where the shaft ends. A dive for divers comfortable in current.",
      landmarks: [
        {
          name: "The shaft",
          kind: "pointOfInterest",
          note: "A limestone chimney dropping about 12 m to the cave entrance. The current comes straight up it and will carry you up faster than a safe ascent: dump gas early, hold the wall or the line, and watch your rate.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Cherokee Sink (Edward Ball Wakulla Springs State Park; open-water certified, register at the main entrance; no scuba in Wakulla Spring itself)"
  {
    slug: "cherokee-sink",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.floridastateparks.org/parks-and-trails/edward-ball-wakulla-springs-state-park/experiences-amenities",
      "https://visittallahassee.com/blog/the-resurrection-of-cherokee-sink/",
      "https://lists.fsu.edu/pipermail/art-mfastudio/2019-August/000031.html",
      "https://www.openstreetmap.org/way/312368967",
    ],
    briefing: {
      name: "Cherokee Sink",
      locationName: "Wakulla Springs State Park, Wakulla County, Florida",
      forecastLatitude: 30.2131,
      forecastLongitude: -84.3043,
      description:
        "A sinkhole lake about 75 m across and 23 m deep in the woods of Wakulla Springs State Park, for decades the local swimming hole. Restored since the park took it in, it is now a quiet, green-water window into the aquifer.",
      marineLife: "Turtles · freshwater fish",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      maxDepthMeters: 23,
      currentNote:
        "Still water, no current. The sink sits at the end of a trail of about 2 km from the trailhead on Highway 61, so plan how the gear gets there.",
      divePlan:
        "Check in at the main park entrance station before heading to the sink, and call the park ahead: the number of divers is limited. Open Water certification is the minimum. Scuba is not allowed in Wakulla Spring itself or its swimming area. The only way up is the surface of the sink.",
      fitNote:
        "Deeper than an Open Water card's 18 m at its bottom, so agree the depth before the dive.",
      creatureSlugs: [],
    },
  },
  // Denominator row: "Paradise Springs (Ocala; private cavern, call ahead; operators require Advanced Open Water and lights)"
  {
    slug: "paradise-springs",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.americanprodiving.com/pages/paradise-springs-scuba-dive-trip",
      "https://www.ocalamarion.com/directory/paradise-springs/",
      "https://grottomap.org/en/entrance/Rw74m_I4/paradise_springs_cave",
    ],
    briefing: {
      name: "Paradise Springs",
      locationName: "Ocala, Florida",
      forecastLatitude: 29.0981,
      forecastLongitude: -82.0793,
      description:
        "A privately owned cavern south of Ocala, entered down a shaft into a dark amphitheater of limestone. Fossils are set all through the walls.",
      marineLife: "Freshwater · fossils in the walls",
      marineLifeDescription: "Little lives here. The dive is the rock and the fossils in it.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 32,
      currentNote:
        "No current, but this is an overhead dive in the dark: a primary and a backup light are required. The passage continues past the cavern as cave, for cave-trained divers only.",
      divePlan:
        "A guided dive, booked ahead: the site is private and keeps its own schedule. Down the entry shaft to the amphitheater and back out the way you came; the only way up is the opening.",
      fitTone: "demanding",
      fitNote:
        "Deep, dark and roofed over the whole way. Operators take Advanced divers with lights, and only with a guide.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep", "cavern"],
      creatureSlugs: [],
    },
  },
  // Denominator row: "Vortex Spring (Ponce de Leon; private dive park, open in 2026 as Vortex Spring Adventures; open-water basin to 50 ft, gated cave)"
  {
    slug: "vortex-spring",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://vortexspring.com/",
      "https://www.emeraldcoastmagazine.com/?p=43876",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+%3D+%27VORTEX+SPRING%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "Vortex Spring",
      locationName: "Ponce de Leon, Florida",
      forecastLatitude: 30.7706,
      forecastLongitude: -85.9483,
      description:
        "A private dive park in the Panhandle built around a clear spring basin that bottoms out at 15 m at the mouth of a cavern. 20 °C all year, cooler than the springs further south.",
      marineLife: "Freshwater fish",
      difficultyLevel: "beginner",
      depthMinMeters: 2,
      maxDepthMeters: 15,
      currentNote:
        "Gentle flow out of the cavern. The water is cool for a spring, so most divers wear a 5–7 mm suit. Bring proof of certification.",
      divePlan:
        "Open Water divers stay in the basin. The cavern beyond the mouth at 15 m needs cavern certification, and the locked gate at 35 m, about 90 m back, needs full cave certification.",
      fitTone: "welcoming",
      fitNote: "A clear, easy basin with a dive shop on site, used for open water training.",
      landmarks: [
        {
          name: "The cavern mouth",
          kind: "pointOfInterest",
          note: "At the bottom of the basin, 15 m down. Look in from the daylight; in is for cavern-certified divers.",
        },
      ],
      creatureSlugs: [],
    },
  },
  // Denominator row: "King Spring (Kings Bay, Crystal River NWR; boat access; scuba year-round, only in the buoyed keyhole Nov 15 – Mar 31)"
  {
    slug: "king-spring",
    version: 1,
    area: "florida-springs",
    sources: [
      "https://www.fws.gov/refuge/crystal-river/visit-us/activities/scuba-diving",
      "https://www.flsprings.com/kings-spring/",
      "https://floridacaves.com/crystalriver.htm",
      "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/SPRINGS/MapServer/1/query?where=SPRING_NAME+%3D+%27KING+SPRING+%28CITRUS%29%27&outFields=SPRING_NAME,LAT_DD,LON_DD,MAGNITUDE&f=json",
    ],
    briefing: {
      name: "King Spring",
      locationName: "Kings Bay, Crystal River, Florida",
      forecastLatitude: 28.8818,
      forecastLongitude: -82.5952,
      description:
        "A first-magnitude spring off the south side of Banana Island in Kings Bay, inside the Crystal River refuge, reached by boat. Its boil shows on the surface over a basin about 60 m across, with cavern openings at the bottom.",
      marineLife: "Manatees · fish",
      marineLifeDescription: "Manatees come to the warm water here, most of all in winter.",
      difficultyLevel: "intermediate",
      depthMinMeters: 2,
      maxDepthMeters: 20,
      currentNote:
        "Strong flow at the vent, and bay water sometimes clouds the visibility. Kings Bay is busy with boats: tow a dive flag and surface beside it.",
      divePlan:
        "Scuba is allowed all year, but from 15 November to 31 March the manatee sanctuaries close to all activity and divers stay inside the buoyed keyhole or outside the sanctuary. If a manatee comes to you, hang still: no touching, chasing or feeding, at any time of year. The cavern openings are for cavern-trained divers.",
      fitNote:
        "Popular and often crowded. Check the refuge's current rules and the sanctuary buoys before you drop in.",
      landmarks: [
        {
          name: "The keyhole",
          kind: "navigationMark",
          note: "The buoyed area where diving is allowed while the sanctuary is closed, 15 November to 31 March.",
        },
      ],
      creatureSlugs: ["manatee"],
    },
  },
];
