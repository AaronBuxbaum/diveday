// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/**
 * Martinique. Read in French. The Anses d'Arlet pins are the map positions the Martinique tourism
 * board (martinique-tour.com) publishes for each spot, checked against where the clubs place the
 * site (between named points and beaches) and against the OpenStreetMap coastline, so each is in
 * the water; Diamond Rock and La Perle take their positions from the rocks themselves, with the
 * pin in the water a few hundred meters off.
 * Where a site's sources run past recreational depth on a slope or plateau that clubs dive as an
 * Open Water outing, the plan is held at a stated floor and the comment says so.
 */
const OFE = "https://www.ofildeleau-martinique.fr/sites-plongee/";
const TOURISM_SPOTS =
  "https://www.martinique-tour.com/profiter/la-plongee-en-martinique/les-spots-de-plongee-des-anses-darlet/";
const TOURISM_TOP =
  "https://www.martinique-tour.com/profiter/la-plongee-en-martinique/top-des-spots-de-plongee/";
const EPM = "https://espaceplongee-martinique.com/le-club/";
const CCC = "https://corailclubcaraibes.com/le-centre/";

export const MARTINIQUE: DiveSiteTemplate[] = [
  {
    slug: "anse-dufour",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, EPM],
    briefing: {
      name: "Anse Dufour (Pointe Dufour)",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position for the spot, consistent with the clubs placing the
      // dive round Pointe Dufour.
      forecastLatitude: 14.5264,
      forecastLongitude: -61.0926,
      description:
        "Green turtles glide over a rubble plateau just off the beach, then a slope runs down past boulders where hawksbills take over. Moray eels, lobsters and French angelfish live in the rocks.",
      marineLife:
        "Green turtles · hawksbill turtles · French angelfish · porcupinefish · moray eels",
      marineLifeDescription:
        "Turtles are the headline. Look into the boulders for octopus and, with luck, a shy seahorse.",
      difficultyLevel: "intermediate",
      // Sources run the slope to 25 m (a stated foot, so maxDepthMeters is 25); clubs dive it as an
      // all-levels outing, so the plan holds an 18 m floor. The sources call the current light to
      // medium and never say how strong the drift runs, so the difficulty is intermediate rather
      // than beginner and the note says the strength is not documented.
      depthMinMeters: 0,
      maxDepthMeters: 25,
      currentNote:
        "Light to medium by the clubs' account, and the site suits a drift; how strong the drift runs is not documented. Carry an SMB and follow the crew's drift plan.",
      divePlan:
        "Start on the plateau, follow the boulder slope down to 18 m with the current, and finish in the shallows at 5 m to 10 m. The slope runs deeper than the plan's floor.",
      fitTone: "welcoming",
      fitNote:
        "A drift over a slope where turtles are common; ask the crew how the current runs that day.",
      creatureSlugs: [
        "green-sea-turtle",
        "hawksbill-turtle",
        "french-angelfish",
        "porcupinefish",
        "green-moray",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "anse-3-airs",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, EPM],
    briefing: {
      name: "Anse 3 Airs",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, in the cove behind Pointe Dufour as the clubs
      // describe it. Depth: 15 m (OFE) is the deepest of the clubs' 12 m and 15 m; the wreck lies
      // at 3 m to 11 m.
      forecastLatitude: 14.5231,
      forecastLongitude: -61.096,
      description:
        "A small, sheltered cove behind Pointe Dufour with rocks, coral and the remains of a little cargo boat in shallow water. A quiet first dive, often used for training.",
      marineLife: "Squid · octopus · French angelfish · moray eels",
      marineLifeDescription:
        "Squid hover over the sand and an octopus keeps house in the rocks. The wreck gives small fish somewhere to hide.",
      difficultyLevel: "beginner",
      depthMinMeters: 0,
      maxDepthMeters: 15,
      currentNote: "None reported. The cove is very sheltered.",
      divePlan:
        "Follow the rocks to the wreck, then loop back over the sand and urchin field. Stay outside the hull; its frame is broken apart.",
      fitTone: "welcoming",
      fitNote: "Calm and shallow, the kind of site where a first open-water dive goes well.",
      creatureSlugs: [
        "caribbean-reef-squid",
        "atlantic-common-octopus",
        "french-angelfish",
        "green-moray",
        "long-spined-urchin",
      ],
    },
  },
  {
    slug: "pointe-de-la-baleine",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, EPM],
    briefing: {
      name: "Pointe de la Baleine",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, off the point the wreck of the Nahoon faces.
      forecastLatitude: 14.5191,
      forecastLongitude: -61.0992,
      description:
        "Clear water over a gentle slope of scattered coral heads, gorgonians and sponges, with feather-duster worms everywhere. Turtles are so common here that the point is nicknamed Pointe Tortue.",
      marineLife: "Turtles · feather-duster worms · elkhorn coral · barracuda · moray eels",
      marineLifeDescription:
        "Turtles nest nearby and visit often, and worms open their crowns at the slightest current.",
      difficultyLevel: "beginner",
      // Sources run the slope to 28 m; clubs dive it as an all-levels outing, so the plan holds
      // an 18 m floor and the slope continues deeper beyond it.
      depthMinMeters: 0,
      maxDepthMeters: 28,
      currentNote: "None to occasional. Run as a drift from Anse 3 Airs, carry an SMB.",
      divePlan:
        "Down the gentle slope among the coral heads and boulders, no deeper than 18 m, then back up the slope. The slope continues deeper beyond the plan.",
      fitTone: "welcoming",
      fitNote: "Clear water and an easy slope, so turtles come to the patient.",
      creatureSlugs: [
        "green-sea-turtle",
        "hawksbill-turtle",
        "feather-duster-worm",
        "elkhorn-coral",
        "great-barracuda",
        "green-moray",
      ],
    },
  },
  {
    slug: "nahoon-wreck",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, EPM, CCC],
    briefing: {
      name: "Nahoon Wreck",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, which agrees with the clubs placing the wreck facing
      // Pointe de la Baleine, about 500 m west of that site's pin. Sunk 1993 (tourism board, OFE),
      // 1994 (EPM); described as a sailing collier (tourism board) and a buoy tender (OFE).
      forecastLatitude: 14.5201,
      forecastLongitude: -61.1039,
      description:
        "A three-masted former ship, sunk on purpose as a dive site (in 1993 or 1994) and standing upright on a sand plateau. Barracuda and schools of fish patrol the deck, and lobsters and morays shelter in the structure.",
      marineLife: "Barracuda · moray eels · lobster · jacks · snappers",
      marineLifeDescription:
        "Barracuda hold over the deck. Lobsters and morays shelter in the structure.",
      difficultyLevel: "advanced",
      maxDepthMeters: 36,
      currentNote:
        "Occasional current. Ascend on the mooring line or an SMB. Stay outside the hull.",
      divePlan:
        "Down the buoy line to the wreck, once around the outside of the hull and masts, and back up the line with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "An upright wreck on sand at the edge of recreational depth. For divers with the card and the gas for it.",
      // Sources give 34 m (CCC), 35 m (OFE, tourism board) and 36 m (EPM) for the sand; the deepest
      // figure is used. Deep wreck: Advanced Open Water and Deep; the clubs ask for level 2.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "green-moray",
        "spiny-lobster",
        "horse-eye-jack",
        "yellowtail-snapper",
      ],
    },
  },
  {
    slug: "anse-fortune",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS],
    briefing: {
      name: "Anse Fortune",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, between Pointe de la Baleine and Cap Salomon as the
      // clubs describe it.
      forecastLatitude: 14.5133,
      forecastLongitude: -61.099,
      description:
        "A cove reached only by sea, with a coral plateau cut by small canyons around coral heads. Seahorses and a spider crab sit in the sponges.",
      marineLife: "Squid · trumpetfish · seahorses · urchins · shrimp",
      marineLifeDescription:
        "Look at the sponges and anemones, not out into the blue. The small animals are the show.",
      difficultyLevel: "beginner",
      depthMinMeters: 0,
      maxDepthMeters: 15,
      currentNote: "Usually light; it can change, so carry an SMB.",
      divePlan:
        "Wander the canyons between the coral heads at 5 m to 12 m and turn when the gas says so.",
      fitTone: "welcoming",
      fitNote: "Shallow, protected and full of small things, a good place for a slow second dive.",
      creatureSlugs: [
        "longsnout-seahorse",
        "caribbean-reef-squid",
        "trumpetfish",
        "long-spined-urchin",
        "branching-vase-sponge",
      ],
    },
  },
  {
    slug: "piscine-de-salomon",
    version: 1,
    area: "martinique",
    sources: [OFE, EPM, TOURISM_SPOTS],
    briefing: {
      name: "Piscine de Salomon",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Approximate pin: the tourism board puts "la piscine" on the north side of Cap Salomon and
      // the clubs place it between Anse Fortune and the cape; placed in the water about 400 m north
      // of the tourism board's Cap Salomon position.
      forecastLatitude: 14.5105,
      forecastLongitude: -61.1025,
      description:
        "Turquoise water over pale rocks and sand, nicknamed the pool. Sergeant majors and damselfish crowd the rocks, and jacks, parrotfish and turtles pass through.",
      marineLife: "Sergeant majors · jacks · parrotfish · lobster · spider crabs",
      marineLifeDescription:
        "Sergeant majors and damselfish crowd the rocks, and jacks and turtles pass over the sand.",
      difficultyLevel: "advanced",
      // RULE 1: clubs give 20 m (OFE), 30 m (EPM) and 40 m (a third club's page title) for this
      // sloping reef, and no source says it continues past 40 m. The deepest sourced foot, 40 m, is
      // the maxDepthMeters, so the gate is Advanced Open Water with the Deep specialty; the plan holds
      // 20 m and says so.
      depthMinMeters: 0,
      maxDepthMeters: 40,
      currentNote:
        "Medium current along the coast; a small cave is overhead and off the plan. The site suits a drift and the current can carry you toward Cap Salomon, so carry an SMB.",
      divePlan:
        "Drift along the rocks and sand, holding 20 m as the plan's floor even though the slope reaches 40 m, and stay outside the cave.",
      fitTone: "unknown",
      fitNote: "Bright ground where the current does the work, over a slope that reaches 40 m.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "sergeant-major",
        "horse-eye-jack",
        "spiny-lobster",
        "green-sea-turtle",
        "stoplight-parrotfish",
      ],
    },
  },
  {
    slug: "cap-salomon",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, CCC],
    briefing: {
      name: "Cap Salomon",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position for Cap Salomon and its gardens.
      forecastLatitude: 14.5069,
      forecastLongitude: -61.1014,
      description:
        "Huge piled boulders slip gradually into the blue off the cape. Big turtles pass, snappers spawn here, and stingrays and spotted eagle rays rest in the rubble.",
      marineLife: "Turtles · snappers · stingrays · spotted eagle rays · porcupinefish",
      marineLifeDescription:
        "The boulders make a small diver feel smaller, and the animals use their gaps all the time.",
      difficultyLevel: "advanced",
      depthMinMeters: 0,
      maxDepthMeters: 30,
      currentNote:
        "Medium, and stronger below 30 m, beyond the plan. Run as a drift if the crew chooses, and carry an SMB.",
      divePlan:
        "Down the boulders to the gentle slope, no deeper than 30 m, the plan's floor, and back up the rocks. The reef slips into deeper, stronger water past the plan. Staff confirm the diver's log before boarding.",
      fitTone: "unknown",
      fitNote: "Big boulders that slip into the blue, held to a 30 m floor in medium current.",
      // RULE 2: the boulders slip into the blue with stronger current below 30 m, and no source says
      // operators run a shallow terrace as an Open Water dive (they call it easy-to-moderate), so the
      // gate is Advanced Open Water with the plan's 30 m floor as maxDepthMeters.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "yellowtail-snapper",
        "southern-stingray",
        "spotted-eagle-ray",
        "porcupinefish",
      ],
    },
  },
  {
    slug: "tombant-de-larbre-mort",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, EPM],
    briefing: {
      name: "Tombant de l'Arbre Mort",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, on the flank of Cap Salomon as the clubs describe it.
      forecastLatitude: 14.5056,
      forecastLongitude: -61.0963,
      description:
        "Three coral plateaus in three moods on the flank of Cap Salomon. The first is a field of sea plumes and sponges, the second a gentle stroll at 12 m to 15 m, and the third ends on a wall.",
      marineLife: "Moray eels · lobster · royal grammas · sea plumes",
      marineLifeDescription:
        "Bright, shallow and full of detail. It suits photographers and anyone who likes to look closely.",
      difficultyLevel: "beginner",
      // Sources run the third plateau onto a wall; clubs dive the gardens as an all-levels outing,
      // so the plan holds an 18 m floor and the wall lies beyond it.
      depthMinMeters: 0,
      maxDepthMeters: 30,
      currentNote: "Medium. The crew may run it as a drift; carry an SMB.",
      divePlan:
        "Work from the first garden to the second plateau at 12 m to 15 m, hold no deeper than 18 m, and finish on the plateau. The wall of the third plateau lies deeper, beyond the plan.",
      fitTone: "welcoming",
      fitNote:
        "Clear water and fine detail on shallow ground, good for beginners and for photographers.",
      creatureSlugs: ["green-moray", "spiny-lobster", "royal-gramma", "sea-plume", "trumpetfish"],
    },
  },
  {
    slug: "pointe-lezarde",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, EPM, CCC],
    briefing: {
      name: "Pointe Lézarde (Martinique)",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position for Pointe de la Lézarde; the neighboring Lézardette
      // lies 320 m east.
      forecastLatitude: 14.4982,
      forecastLongitude: -61.0904,
      description:
        "A coral cliff full of cracks, sheltered from current by Pointe Burgos. Lobsters, frogfish and seahorses live in the fissures, and squid gather near the surface.",
      marineLife: "Lobster · frogfish · seahorses · squid · nudibranchs",
      marineLifeDescription:
        "A site of small, strange animals and a colorful wall right beside the mooring.",
      difficultyLevel: "advanced",
      depthMinMeters: 0,
      maxDepthMeters: 40,
      currentNote:
        "Usually light, and the point blocks most of the current; it can change, so carry an SMB.",
      divePlan:
        "Up and down the wall near the mooring, with 18 m as the plan's floor even though the cliff reaches 40 m. Staff confirm the diver's log before boarding.",
      fitTone: "unknown",
      fitNote:
        "A sheltered cliff to look into, with cracks full of small animals and a foot at 40 m.",
      // RULE 1: sources give 30 m to 40 m for the cliff and none says it is bottomless, so
      // maxDepthMeters is 40 and the gate is Advanced Open Water with the Deep specialty; the plan
      // holds 18 m near the mooring wall and says so.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "spiny-lobster",
        "longlure-frogfish",
        "longsnout-seahorse",
        "caribbean-reef-squid",
        "lettuce-sea-slug",
      ],
    },
  },
  {
    slug: "grotte-aux-couleurs",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS],
    briefing: {
      name: "Grotte aux Couleurs",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, 250 m from Crique Abricot as the clubs describe the
      // neighboring sites.
      forecastLatitude: 14.4953,
      forecastLongitude: -61.0906,
      description:
        "A sheltered wall lined with orange tube coral, whose color shifts from yellow to red as the tentacles open, and with sponges. A coral garden at about 12 m draws fish, and turtles graze in the grass nearby.",
      marineLife: "Orange cup coral · frogfish · turtles · tube worms",
      marineLifeDescription:
        "The wall is the color. Frogfish sit disguised on the sponges for patient divers.",
      difficultyLevel: "beginner",
      depthMinMeters: 0,
      maxDepthMeters: 20,
      currentNote:
        "Light. The cavity at about 6 m that gives the site its name is overhead; stay out of it and enjoy the wall from outside.",
      divePlan:
        "Along the wall at 6 m, out to the coral garden at 12 m, and back along the wall. Stay out of the cavity.",
      fitTone: "welcoming",
      fitNote: "Sheltered, shallow and colorful, with a wall to look at slowly.",
      creatureSlugs: [
        "orange-cup-coral",
        "longlure-frogfish",
        "green-sea-turtle",
        "social-feather-duster",
      ],
    },
  },
  {
    slug: "crique-abricot",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, EPM],
    briefing: {
      name: "Crique Abricot",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, in the cove between Grande Anse and the village of
      // Les Anses-d'Arlet.
      forecastLatitude: 14.4932,
      forecastLongitude: -61.0915,
      description:
        "A small, clear cove protected from swell and current, with a reef wall and a nursery of young fish. It is also the usual starting point for the Jorasses or Pointe Burgos.",
      marineLife: "Octopus · surgeonfish · parrotfish · grunts · turtles",
      marineLifeDescription:
        "Octopus leave piles of crab and shell debris at the den entrance, and turtles feed over the reef. Barracuda pass sometimes.",
      difficultyLevel: "intermediate",
      // The wall is dived as an all-levels outing; the plan holds an 18 m floor and the reef
      // falls deeper toward open water, beyond it.
      depthMinMeters: 0,
      maxDepthMeters: 35,
      currentNote: "Usually light; it can change, so carry an SMB.",
      divePlan:
        "Follow the wall along the cove no deeper than 18 m, and turn back at the gas turn pressure. The reef falls to 35 m toward open water, past the plan.",
      fitTone: "unknown",
      // The reef falls to 35 m toward open water: a bounded foot a diver can reach, so it takes
      // Advanced Open Water and Deep; the plan itself holds 18 m.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      fitNote:
        "A protected cove with a plan floor of 18 m; the reef's 35 m foot needs Advanced Open Water and the Deep specialty.",
      creatureSlugs: [
        "atlantic-common-octopus",
        "blue-tang",
        "stoplight-parrotfish",
        "green-sea-turtle",
        "french-grunt",
      ],
    },
  },
  {
    slug: "petites-jorasses",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, EPM, CCC],
    briefing: {
      name: "Petites Jorasses",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position for the Jorasses. Only the Petites Jorasses are
      // briefed; the Grandes Jorasses go well past recreational depth and are left out.
      forecastLatitude: 14.4931,
      forecastLongitude: -61.0936,
      description:
        "Volcanic ridges stepping down in terraces like an alpine range, with bowls of white sand between. A big school of jacks sits over the edge, and turtles, mackerel and stingrays pass.",
      marineLife: "Jacks · turtles · barracuda · stingrays",
      marineLifeDescription:
        "A school of big-eyed jacks stays over the edge, and turtles and rays work the sand.",
      difficultyLevel: "advanced",
      depthMinMeters: 0,
      maxDepthMeters: 25,
      currentNote:
        "Exposed and far from shore; the current runs from light to steady. Carry an SMB. The Grandes Jorasses beyond are deeper and stronger and are not part of this plan.",
      divePlan:
        "Follow the ridges and sand bowls no deeper than 25 m, then drift back to the boat on an SMB.",
      fitTone: "demanding",
      fitNote:
        "Open water over ridges, with current that can build. For divers who are comfortable with a drift.",
      // The club rates the Petites Jorasses easy; the tourism board and the other club call the
      // site exposed to current and for confident divers, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["horse-eye-jack", "green-sea-turtle", "southern-stingray", "great-barracuda"],
    },
  },
  {
    slug: "pointe-burgos",
    version: 1,
    area: "martinique",
    sources: [
      OFE,
      TOURISM_SPOTS,
      TOURISM_TOP,
      "https://alphaplongee.com/spot-de-plongee-a-la-pointe-burgos/",
    ],
    briefing: {
      name: "Pointe Burgos",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, at the foot of Morne Champagne between Grande Anse
      // and the village beach.
      forecastLatitude: 14.4914,
      forecastLongitude: -61.0921,
      description:
        "A dome built by old basaltic lava flows. A shallow coral plateau of sea fans and sponges is crossed by schools of grunts, and turtles live among the fissures.",
      marineLife: "Turtles · sea fans · grunts · batfish · morays",
      marineLifeDescription:
        "Big schools of grunts and other reef fish move through the fissures. Finish with the safety stop at 5 m, on the line or an SMB.",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      maxDepthMeters: 18,
      currentNote: "Light to steady.",
      divePlan:
        "Along the plateau and the first slope no deeper than 18 m, and back for the safety stop. Stay above the wall edge; the wall drops off past the plan.",
      fitTone: "welcoming",
      fitNote:
        "A reef most people remember for the fish. Held to the plateau, it suits Open Water divers.",
      // RULE 2 terrace exception: clubs run the plateau (3 m to 12 m) as an Open Water outing, so it
      // stays ungated with an 18 m floor. The wall is a separate deeper dive (a mountain with its
      // summit at 30 m and its foot at 55 m) and lies beyond this plan; the prose says so.
      creatureSlugs: ["green-sea-turtle", "french-grunt", "common-sea-fan", "green-moray"],
    },
  },
  {
    slug: "petite-sirene",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_SPOTS, "https://alphaplongee.com/spot-de-plongee-a-la-petite-sirene/"],
    briefing: {
      name: "Petite Sirène",
      locationName: "Les Anses-d'Arlet, Martinique",
      // Pin: the tourism board's map position, next to Pointe Burgos as the clubs describe it.
      forecastLatitude: 14.4909,
      forecastLongitude: -61.0891,
      description:
        "A bright coral plateau at 3 m to 15 m, then a reef edge and a wall with fissures full of fish.",
      marineLife: "Turtles · grunts · schools of fish",
      marineLifeDescription: "Turtles graze the plateau and the fissures hold schooling fish.",
      difficultyLevel: "advanced",
      depthMinMeters: 3,
      maxDepthMeters: 35,
      currentNote:
        "Occasional. A small tunnel on the site is overhead; stay out of it and finish over the plateau.",
      divePlan:
        "Along the plateau and the reef edge, holding 18 m as the plan's floor although the wall below reaches 35 m. Stay out of the tunnel.",
      fitTone: "unknown",
      fitNote: "A plateau with fissures worth a slow look, above a wall that reaches 35 m.",
      // RULE 1: clubs give the site 35 m and no source calls the wall bottomless, so maxDepthMeters
      // is 35 with Advanced Open Water and the Deep specialty; the plan holds 18 m on the plateau.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["green-sea-turtle", "french-grunt", "common-sea-fan"],
    },
  },
  {
    slug: "rocher-du-diamant",
    version: 1,
    area: "martinique",
    sources: [
      OFE,
      TOURISM_TOP,
      "https://alphaplongee.com/spot-de-plongee-aux-rocher-du-diamant/",
      "https://en.wikipedia.org/wiki/Diamond_Rock",
    ],
    briefing: {
      name: "Rocher du Diamant",
      locationName: "Le Diamant, Martinique",
      // Pin: in the water about 250 m southwest of Diamond Rock, whose position (14.4433, -61.0392)
      // is the same in Wikipedia and OpenStreetMap and about 2 km off the Pointe du Diamant (the
      // rock covers about 100 m around that point, so the pin sits beyond its foot).
      forecastLatitude: 14.4418,
      forecastLongitude: -61.041,
      description:
        "A 175 m volcanic rock standing alone in the sea. Its walls and terraces are covered in large gorgonians, with turtles, morays and tropical fish.",
      marineLife: "Hawksbill turtles · moray eels · gorgonians · surgeonfish",
      marineLifeDescription:
        "Terraced rock, big gorgonians and hawksbills. The wall is the draw, not the surface.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote:
        "Open sea about 2 km from the coast and a boat ride of around 20 minutes. The current is light to medium and sometimes stronger; carry an SMB. A fissure through the rock is overhead; stay out of it. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Down the rock's terraces and walls no deeper than 30 m, along the outside of the rock, and back up with reserve gas on the line or an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "An offshore rock with current, walls and an overhead passage to leave alone. For divers who can hold a floor.",
      // Sources run the site from 6 m to 55 m (OFE) or 60 m (EPM) with current "light to medium,
      // sometimes stronger" and about a dozen routes, some for experienced divers only;
      // the rock is open sea and the wall continues past the plan, so the gate is Advanced Open
      // Water and the 30 m floor is the plan's.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "hawksbill-turtle",
        "green-moray",
        "blue-tang",
        "common-sea-fan",
        "sea-plume",
      ],
    },
  },
  {
    slug: "rocher-de-la-perle",
    version: 1,
    area: "martinique",
    sources: [OFE, TOURISM_TOP, EPM, "https://fr.wikipedia.org/wiki/Rocher_de_la_Perle"],
    briefing: {
      name: "Rocher de la Perle",
      locationName: "Le Prêcheur, Martinique",
      // Pin: in the water 100 m southwest of the islet, whose position (14.8419, -61.2278) is the
      // same in French Wikipedia and OpenStreetMap.
      forecastLatitude: 14.8414,
      forecastLongitude: -61.2284,
      description:
        "A lone volcanic rock about 2.8 km off the coast, with a plateau on top and a wall that circles it. Turtles, barracuda and jacks gather in the current among black gorgonians.",
      marineLife: "Turtles · barracuda · jacks · parrotfish · black gorgonians",
      marineLifeDescription:
        "Barracuda, jacks and turtles hold in the current among the black gorgonians.",
      difficultyLevel: "advanced",
      depthMinMeters: 16,
      maxDepthMeters: 30,
      currentNote:
        "Often strong, and it is a drift dive in open water. Carry an SMB. The wall continues past the plan, so the floor is the diver's to hold. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Down onto the plateau, around the wall no deeper than 30 m, and back up on the SMB with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "Remote, current-swept and rewarding. For experienced divers who drift well.",
      // The wall falls to 60 m; the 30 m floor is the plan's. Strong, often open-water current takes
      // the Advanced Open Water gate.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "great-barracuda",
        "horse-eye-jack",
        "black-sea-rod",
        "stoplight-parrotfish",
      ],
    },
  },
];
