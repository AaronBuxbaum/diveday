// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/**
 * Guadeloupe. Read in French. The Pigeon Islets sites have no published coordinates beyond
 * PADI Travel's Franjack and Jardin de Corail pins, so the rest are approximate pins placed in the
 * water from the islets, points and beaches the clubs name (OpenStreetMap maps the islets and the
 * points); each says so in a comment. Where sources run past recreational depth on a plateau or
 * slope clubs dive as an Open Water outing, the plan is held at a stated floor. La Piscine and
 * L'Aquarium are left out: no source states a depth for the dive itself.
 */
const HS_RESERVE = "https://www.heures-saines.com/spots-de-plongee/reserve-cousteau/";
const HS_WRECKS = "https://www.heures-saines.com/spots-de-plongee/exploration-epaves/";
const ANSE_CARAIBE =
  "https://www.plongee-guadeloupe-reserve-cousteau.fr/nos-sites-de-plongee/la-reserve-cousteau/";
const ANSE_WRECKS =
  "https://www.plongee-guadeloupe-reserve-cousteau.fr/nos-sites-de-plongee/la-plongee-sur-epaves/";
const ULTRAMARINA =
  "https://ultramarina.com/voyage-plongee-caraibes/guadeloupe/basse-terre-et-la-reserve-cousteau/la-reserve-cousteau";
const ATLANTIS =
  "https://www.atlantisformation-guadeloupe.com/Ou-plonger-en-Guadeloupe-les-spots-qu-il-ne-faut-surtout-pas-rater_a26.amp.html";
const PARK = "In or beside the reserve; confirm the zone.";

export const GUADELOUPE: DiveSiteTemplate[] = [
  {
    slug: "jardin-de-corail-pigeon",
    version: 1,
    area: "guadeloupe",
    sources: [
      HS_RESERVE,
      ANSE_CARAIBE,
      ULTRAMARINA,
      "https://www.padi.com/dive-site/the-guadeloupe-islands/jardin-de-corail/",
    ],
    briefing: {
      name: "Jardin de Corail",
      locationName: "Pigeon Islets, Bouillante, Guadeloupe",
      // Approximate pin: PADI Travel's position (16.1675, -61.7882) moved 85 m east into the water;
      // the clubs place the site along the east face of the Pigeon Islets (OpenStreetMap maps the
      // islets at 16.1683, -61.7898), so the pin is within 150 m of the landmark.
      forecastLatitude: 16.1675,
      forecastLongitude: -61.7874,
      description:
        "A broad stretch of coral on the east face of the Pigeon Islets, the reserve's reference site. Hawksbill turtles, big-eyed jacks and schools of tropical fish cover the reef, and a bust of Jacques Cousteau stands on a sand bank at 12 m.",
      marineLife: "Hawksbill turtles · big-eyed jacks · tropical reef fish",
      marineLifeDescription:
        "The reef is busy at every depth, and turtles are often on the way to the bust.",
      conservationNote: PARK,
      difficultyLevel: "beginner",
      depthRange: "3–18 m (10–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Busy with dive boats and snorkelers; carry an SMB and listen for engines. Current is light; check with the crew on the day.",
      divePlan:
        "Over the reef to the bust of Cousteau at 12 m, then back along the coral no deeper than 18 m. The wall beyond the reef drops off past the plan.",
      fitTone: "welcoming",
      fitNote: "Easy coral and a landmark to swim to.",
      // RULE 2 terrace exception: Atlantis lists the site from 3 m to 45 m and PADI Travel gives 40 m
      // (a wall); the clubs run the reef as an all-levels dive, so it stays ungated with an 18 m
      // floor and the prose says the wall drops off past the plan.
      landmarks: [
        {
          name: "Cousteau bust",
          kind: "underwaterMonument",
          note: "A bust of the commander on a sand bank at about 12 m.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "horse-eye-jack",
        "great-barracuda",
        "cero",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "pointe-carangue",
    version: 1,
    area: "guadeloupe",
    sources: [HS_RESERVE, ANSE_CARAIBE, ULTRAMARINA],
    briefing: {
      name: "Pointe Carangue",
      locationName: "Pigeon Islets, Bouillante, Guadeloupe",
      // Approximate pin: OpenStreetMap maps Pointe Carangue at the southeast of the Pigeon Islets
      // (16.1660, -61.7883), where the clubs place the site; moved 70 m southeast into the water.
      forecastLatitude: 16.1655,
      forecastLongitude: -61.7878,
      description:
        "A bright coral plateau of sponges and gorgonians that ends in a gentle slope with small cracks. Lobsters, porcupinefish and morays live in the cracks, and a school of jacks patrols the point.",
      marineLife: "Jacks · porcupinefish · morays · lobster · groupers",
      marineLifeDescription:
        "A big school of jacks is the picture. The cracks along the slope hold the smaller animals.",
      conservationNote: PARK,
      difficultyLevel: "advanced",
      depthRange: "8–40 m (25–130 ft)",
      maxDepthMeters: 40,
      currentNote: "The point is often swept by current. Carry an SMB.",
      divePlan:
        "Along the plateau and the first of the slope, holding 20 m as the plan's floor although the slope reaches 40 m, and ascend on the mooring line or an SMB.",
      fitTone: "demanding",
      fitNote: "A colorful plateau where current is the thing to read on the day.",
      // RULE 1: the slope reaches 40 m, so maxDepthMeters is 40 and the Deep specialty joins the
      // Advanced Open Water gate (which the often-swept point already earns). The plateau (8 m to
      // 20 m) is the plan, with a 20 m floor.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "horse-eye-jack",
        "porcupinefish",
        "green-moray",
        "spiny-lobster",
        "black-grouper",
      ],
    },
  },
  {
    slug: "pointe-barracuda-pigeon",
    version: 1,
    area: "guadeloupe",
    sources: [HS_RESERVE, ANSE_CARAIBE, ULTRAMARINA],
    briefing: {
      name: "Pointe Barracuda",
      locationName: "Pigeon Islets, Bouillante, Guadeloupe",
      // Approximate pin: OpenStreetMap maps Pointe Barracuda at the northwest of the Pigeon Islets
      // (16.16735, -61.79237), which is where the clubs place the site; moved 80 m west-northwest
      // so the pin is in the water off the point, over the top of the wall.
      forecastLatitude: 16.1676,
      forecastLongitude: -61.7931,
      description:
        "A wall that starts at 13 m, covered in coral and sponges, on the northwest point of the big islet. Barracuda, mackerel, angelfish and turtles use it.",
      marineLife: "Barracuda · mackerel · angelfish · turtles · triggerfish",
      marineLifeDescription:
        "The wall fish are the show, with barracuda along the top and turtles on the coral.",
      conservationNote: PARK,
      difficultyLevel: "advanced",
      depthRange: "13–25 m (43–80 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Current not documented; ask the crew on the day. The wall continues deeper than the plan, so the floor is the diver's to hold.",
      divePlan:
        "Down the mooring to the top of the wall at 13 m, along it no deeper than 25 m, and back up with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A wall with a floor you hold yourself. For divers who read their gauge.",
      // The wall falls well past recreational depth (profiles to 50 m are quoted; one club has the
      // wall ending in sand deeper still); the plan's floor is 25 m and the gate is Advanced Open
      // Water. The clubs call the 20 m zone the one to dive.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "cero",
        "queen-angelfish",
        "green-sea-turtle",
        "ocean-triggerfish",
      ],
    },
  },
  {
    slug: "pointe-malendure",
    version: 1,
    area: "guadeloupe",
    sources: [HS_RESERVE, ANSE_CARAIBE],
    briefing: {
      name: "Pointe Malendure",
      locationName: "Malendure, Bouillante, Guadeloupe",
      // Approximate pin: both clubs place the site along the Réserve Cousteau coast at Malendure;
      // placed in the water about 400 m west-northwest of Plage de Malendure (OpenStreetMap,
      // 16.1720, -61.7764), good to about 2 km.
      forecastLatitude: 16.174,
      forecastLongitude: -61.78,
      description:
        "A shallow run of coral ridges and small pinnacles on a sandy floor. Black gorgonians and azure vase sponges cover the rock, and turtles are frequent.",
      marineLife: "Turtles · reef fish · gorgonians · vase sponges",
      marineLifeDescription:
        "Gorgonians sway over the pinnacles, and turtles are often among them.",
      conservationNote: PARK,
      difficultyLevel: "beginner",
      depthRange: "Up to 18 m (60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Busy with dive boats and snorkelers; carry an SMB and listen for engines. Current not documented; ask the crew on the day.",
      divePlan: "Follow the coral ridges between the pinnacles and return along the sand edge.",
      fitTone: "welcoming",
      fitNote: "Shallow and varied, with ridges to follow at an easy pace.",
      creatureSlugs: ["green-sea-turtle", "azure-vase-sponge", "black-sea-rod", "common-sea-fan"],
    },
  },
  {
    slug: "jardin-japonais",
    version: 1,
    area: "guadeloupe",
    sources: [HS_RESERVE, ANSE_CARAIBE],
    briefing: {
      name: "Jardin Japonais",
      locationName: "Malendure, Bouillante, Guadeloupe",
      // Approximate pin: the clubs put the site off the Anse Négresse, north of Malendure beach
      // (OpenStreetMap maps Pointe à Négresse at 16.1791, -61.7838); placed in the water about
      // 450 m west-northwest of that point, good to about 2 km. Depth: the clubs give 20 m (wall)
      // and 25 m (the sec drops from 2 m); the deeper figure is used.
      forecastLatitude: 16.18,
      forecastLongitude: -61.788,
      description:
        "A small pinnacle that rises from about 25 m to within 2 m of the surface, rich and colorful, with lobsters sheltering in the rock.",
      marineLife: "Lobster · crustaceans · reef fish",
      marineLifeDescription:
        "Lobsters shelter in the rock and the pinnacle is crowded with small life.",
      conservationNote: PARK,
      difficultyLevel: "intermediate",
      // The pinnacle drops to about 25 m; the plan holds an 18 m floor and the lower part lies
      // beyond it.
      depthRange: "2–25 m (7–80 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Busy with dive boats and snorkelers; carry an SMB and listen for engines. Current not documented; ask the crew on the day. A natural arch on the pinnacle is overhead; stay out of it.",
      divePlan:
        "Spiral down the pinnacle to no deeper than 18 m, then back up the other side. The pinnacle continues deeper beyond the plan. Stay out of the arch.",
      fitTone: "welcoming",
      fitNote: "A compact pinnacle with a lot to see in a short dive.",
      creatureSlugs: ["spiny-lobster", "french-angelfish", "blue-tang", "common-sea-fan"],
    },
  },
  {
    slug: "franjack-wreck",
    version: 1,
    area: "guadeloupe",
    sources: [
      HS_WRECKS,
      "https://www.bleupassionguadeloupe.com/pages/activites/fundives.html",
      ANSE_WRECKS,
      "https://www.padi.com/dive-site/the-guadeloupe-islands/franjack/",
    ],
    briefing: {
      name: "Franjack",
      locationName: "Malendure, Bouillante, Guadeloupe",
      // Approximate pin: PADI Travel's position (16.16340, -61.78024), which agrees with Anse
      // Caraïbe placing the wreck southeast of Pointe Malendure, about 1 km from Plage de Malendure.
      // Depth: 23 m (two clubs, PADI), 24 m (a third); the deeper figure is used.
      forecastLatitude: 16.1634,
      forecastLongitude: -61.7802,
      description:
        "A 50 m sand carrier, damaged by Hurricane Hugo and sunk on purpose as an artificial reef. She sits on the sand and is covered in sponges, anemones and coral.",
      marineLife: "Barracuda · jacks · moray eels · shrimp",
      marineLifeDescription:
        "Barracuda and jacks hold above the deck, and morays and shrimp live in the encrusted frames.",
      conservationNote: PARK,
      difficultyLevel: "advanced",
      depthRange: "Up to 24 m (79 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Open water; current not documented. Ascend on the line or an SMB. Stay outside the hull.",
      divePlan:
        "Down the line to the bow, around the outside of the hull to the stern and propeller, and back up the line with reserve gas. The sand lies at 24 m.",
      fitTone: "unknown",
      fitNote: "A wreck on sand at 24 m, for a diver comfortable at that depth.",
      // Gate: the route runs to the stern and propeller on the 24 m sand and no source gives a
      // shallower deck depth for an Open Water route, so the conservative reading is Advanced Open
      // Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["great-barracuda", "horse-eye-jack", "green-moray", "banded-coral-shrimp"],
    },
  },
  {
    slug: "gustavia-wreck",
    version: 1,
    area: "guadeloupe",
    sources: [HS_WRECKS, ULTRAMARINA, ANSE_WRECKS, ATLANTIS],
    briefing: {
      name: "Gustavia",
      locationName: "Malendure, Bouillante, Guadeloupe",
      // Approximate pin: Anse Caraïbe places the wreck southeast of the Pigeon Islets
      // (OpenStreetMap, 16.1683, -61.7898) and Ultramarina about a mile from the Malendure rock;
      // the point is 600 m southeast of the islets and 1.1 km from Plage de Malendure, in the
      // water (a dive-site listing gives 16.1658, -61.7848). Good to about 2 km.
      forecastLatitude: 16.1658,
      forecastLongitude: -61.7848,
      description:
        "A 48 m cargo ship damaged by Hurricane Hugo and later sunk, standing upright on a sandy floor. She is covered in sponges and tropical fish. Barracuda are often seen around the wreck.",
      marineLife: "Barracuda · French angelfish · sponges",
      marineLifeDescription:
        "Barracuda gather around the wreck, with a pair of French angelfish patrolling the hull.",
      conservationNote: PARK,
      difficultyLevel: "advanced",
      depthRange: "Up to 40 m (131 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Open water; current not documented. Ascend on the line or an SMB. Stay outside the hull. The sand is at the limit of recreational depth, so the crew sets the turn pressure at the briefing.",
      divePlan:
        "Down the line to the sand, a slow spiral up the outside of the hull, and back up the line with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A deep wreck on sand at the limit of recreational diving. For divers with deep training.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "french-angelfish", "spiny-lobster"],
    },
  },
  {
    slug: "augustin-fresnel-wreck",
    version: 1,
    area: "guadeloupe",
    sources: [
      HS_WRECKS,
      "https://www.bleupassionguadeloupe.com/pages/activites/fundives.html",
      ANSE_WRECKS,
      ATLANTIS,
      "https://fr.wikipedia.org/wiki/Augustin_Fresnel_(%C3%A9pave)",
    ],
    briefing: {
      name: "Augustin Fresnel II",
      locationName: "Bouillante, Guadeloupe",
      // Pin: the position French Wikipedia gives for the wreck (16°06′08″ N, 61°46′41″ W), about
      // 3 km south of Pointe à Lézard; a dive-site listing's point lies 400 m northwest, and the
      // clubs place the wreck outside the national park, south of Malendure.
      forecastLatitude: 16.1022,
      forecastLongitude: -61.7781,
      description:
        "A 53 m lighthouse tender sunk on purpose as an artificial reef, standing on sand. Barracuda, jacks and morays use the outside, and the soft corals suit photographers.",
      marineLife: "Barracuda · jacks · morays · lobster · soft coral",
      marineLifeDescription: "Fish hold over the deck and lobsters and morays use the structure.",
      difficultyLevel: "advanced",
      depthRange: "Up to 35 m (115 ft)",
      maxDepthMeters: 35,
      currentNote:
        "Open water outside the park, reached by a longer boat ride. One listing reports a medium current of 1 to 2 knots; ascend on the line or an SMB. Stay outside the hull.",
      divePlan:
        "Down the line to the foredeck, around the outside of the hull, and back up the line with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep wreck off the usual routes. For divers with deep training.",
      // Sources give 28 m to 35 m for the wreck (the sand at 33 m by the club that dives it, 15 m to
      // 35 m by another); the deepest figure is used.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "horse-eye-jack", "green-moray", "spiny-lobster"],
    },
  },
  {
    slug: "sec-pate",
    version: 1,
    area: "guadeloupe",
    sources: [
      "https://www.heures-saines.com/spots-de-plongee/plongee-sur-sec-pate/",
      "https://www.lesilesdeguadeloupe.com/en/experiences/diving-in-guadeloupe/diving-spots-in-guadeloupe/",
      "https://www.wannadive.net/spot/Central_America/Guadeloupe/Sec_Pate/index.html",
    ],
    briefing: {
      name: "Sec Pâté",
      locationName: "Saintes Channel, Guadeloupe",
      // Approximate pin: wannadive.net position (15.9151, -61.6484); OpenStreetMap names Sec Pâté
      // at 15.9198, -61.6494, 520 m away, and the operators place the seamount in the middle of the
      // Saintes Channel (between Terre-de-Haut and Basse-Terre), well inside the 2 km tolerance.
      forecastLatitude: 15.9151,
      forecastLongitude: -61.6484,
      description:
        "A volcanic seamount in the Saintes Channel with three rock pinnacles that rise to about 17 m and fall into very deep water. Large turtles, morays, jacks and queen angelfish circle the pinnacles in open water.",
      marineLife: "Turtles · morays · queen angelfish · barracuda · jacks",
      marineLifeDescription:
        "Fish circle the pinnacles in open water, with turtles and spotted eagle rays among them.",
      difficultyLevel: "advanced",
      // The pinnacle tops lie at 15 m to 17 m and the base at 200 m to 400 m; the club has divers
      // between 20 m and 40 m, so the plan's floor is 40 m.
      depthRange: "17–40 m (56–131 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Open sea in the channel, about three hours of boat travel to reach it. Current not documented; carry an SMB. Some pinnacles have cavities you can swim through: overhead; stay out. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Descend on the shot line or the mooring, around the pinnacles between 20 m and 40 m; staff set a turn depth and time at the briefing. Ascend slowly on an SMB with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A remote seamount in open water. For experienced divers with deep training.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "green-sea-turtle",
        "green-moray",
        "queen-angelfish",
        "great-barracuda",
        "horse-eye-jack",
        "spotted-eagle-ray",
      ],
    },
  },
  {
    slug: "pointe-lezarde-guadeloupe",
    version: 1,
    area: "guadeloupe",
    sources: [HS_RESERVE, ANSE_CARAIBE, ATLANTIS],
    briefing: {
      name: "Pointe Lézarde (Guadeloupe)",
      locationName: "Bouillante, Guadeloupe",
      // Approximate pin: both clubs place the site at the Pointe à Lézard, at the south of the
      // reserve; OpenStreetMap maps the point at 16.1394, -61.7800, and the pin is 250 m west in the
      // water. The clubs give the wall as 40 m to 50 m, and the ridge at 12 m runs as a level 1
      // dive.
      forecastLatitude: 16.1394,
      forecastLongitude: -61.7824,
      description:
        "A quiet site at the south end of the reserve. A ridge of small pinnacles sits over a floor at 12 m, then a wall falls away. Hot springs rise through cracks, and turtles, lionfish and mackerel work the coast.",
      marineLife: "Turtles · lionfish · mackerel · giant gorgonians",
      marineLifeDescription: "A calm place to find turtles, with big gorgonians on the wall.",
      conservationNote: PARK,
      difficultyLevel: "intermediate",
      depthRange: "10–18 m (33–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Usually light; it can change, so carry an SMB. Hot water rises through some cracks; keep hands and gear clear.",
      divePlan:
        "Along the ridge at 12 m no deeper than 18 m, and back along it. The wall beyond falls well past the plan; stay above it.",
      fitTone: "welcoming",
      fitNote: "A calm ridge for Open Water divers, with a wall to look at from above.",
      // RULE 2 terrace exception: the clubs run the 12 m ridge as a level 1 dive, so it stays ungated
      // with an 18 m floor; the wall (40 m to 50 m) lies beyond the plan and the prose says so.
      creatureSlugs: ["green-sea-turtle", "lionfish", "cero", "common-sea-fan"],
    },
  },
];
