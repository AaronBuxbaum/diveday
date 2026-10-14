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
      depthRange: "5–16 m (15–54 ft)",
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
      depthRange: "9–30 m (30–100 ft)",
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
      depthRange: "4–16 m (12–54 ft)",
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
      depthRange: "3–15 m (10–50 ft)",
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
      depthRange: "1–5 m (3–16 ft)",
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
      depthRange: "2–8 m (5–26 ft)",
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
];
