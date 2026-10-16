// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Yucatán cenotes. */
export const MEXICO_CENOTES: DiveSiteTemplate[] = [
  // Denominator row: Chac Mool (Little Brother)
  // Position: OpenStreetMap and Scubago agree within 60 m. Depth: Pro Dive 12 m, Cancún Scuba Center 45 ft (14 m); taking 14 m. Cavern route: Tank-Ha describes the dives as cavern dives within sight of daylight, never more than a one-minute swim from the surface. Entry fee is paid in cash at the gate.
  // Pin re-checked against the OpenStreetMap sinkhole outline (center 20.5131, -87.2470), which the pin matches. Pro Dive says the entrance is about 100 m south of Puerto Aventuras; the pin lies about 0.7 km north of the town's map center, so the prose says only "near Puerto Aventuras". The OSM attraction node 2.9 km further north is a ticket-office point and is not used.
  // Halocline cenote: gated Advanced Open Water on top of the cavern specialty, per domain review. No source gives the entry (stairs, platform or ladder), so the briefing leaves it to the guide.
  {
    slug: "chac-mool-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cenote-chac-mool-79277",
      "https://www.prodiveinternational.com/dive-site/chac-mool/",
      "https://cancunscubacenter.com/diving/diving-cenotes/",
      "https://tankha.com/diving/cenote-caverns",
      "https://www.scubatotal.com/post/top-8-dive-sites-in-cancun-a-diver-s-guide-to-the-caribbean-s-hidden-treasures",
    ],
    briefing: {
      name: "Chac Mool Cenote",
      locationName: "Puerto Aventuras, Mexico",
      forecastLatitude: 20.5132,
      forecastLongitude: -87.2475,
      description:
        "A cenote near Puerto Aventuras with two water entries into the same large rooms, one with a collapsed ceiling and an air dome above the water. The dive stays in the lit rooms.",
      marineLife: "Catfish · fossils · stalactites",
      marineLifeDescription:
        "Few animals. The sights are stalactites, tree roots in the light and the halocline.",
      difficultyLevel: "intermediate",
      depthRange: "0–14 m (0–46 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Still water. A halocline blurs your view where fresh and salt water mix, and fin kicks stir silt, so hold trim and keep kicks short. Fresh water lifts you less than the sea, so check your weighting.",
      divePlan:
        "Guide-led only, with group size set by the guide, single file along the line in the lit rooms, never beyond the daylight. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. A through-route between cenotes is a cave dive; do not follow it. Entry is confirmed by staff on the day.",
      fitTone: "demanding",
      fitNote:
        "Roomy and well lit, with a halocline that blurs the view. Buoyancy and trim decide the dive.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
    },
  },
  // Denominator row: Jardín del Edén (Ponderosa, Eden)
  // Position: Scubago pin; Pro Dive puts it 3 km south of Puerto Aventuras, which agrees. OpenStreetMap's own point for the name falls 14 km inland and is not used. Depth: Cancún Scuba Center gives 45 ft (14 m) for Ponderosa. Cavern route within daylight per Tank-Ha. Entry fee in cash.
  // Halocline cenote: gated Advanced Open Water on top of the cavern specialty, per domain review. No source gives the entry (stairs, platform or ladder), so the briefing leaves it to the guide.
  {
    slug: "jardin-del-eden-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/jardin-del-eden-cenote-ponderosa-202823",
      "https://www.prodiveinternational.com/dive-site/el-eden/",
      "https://cancunscubacenter.com/diving/diving-cenotes/",
      "https://tankha.com/diving/cenote-caverns",
    ],
    briefing: {
      name: "Jardín del Edén",
      locationName: "Puerto Aventuras, Mexico",
      forecastLatitude: 20.4919,
      forecastLongitude: -87.2582,
      description:
        "A large open cenote like a swimming pool in the jungle, also called Ponderosa. Mossy boulders and plants on the bottom, and a dive that stays in the open, lit rooms.",
      marineLife: "Freshwater fish · eels · aquatic plants",
      marineLifeDescription: "Fish and freshwater eels live among the plants and boulders.",
      difficultyLevel: "intermediate",
      depthRange: "0–14 m (0–46 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Still water. A halocline near 10 m blurs your view, and fins stir silt, so hold trim. Fresh water lifts you less than the sea, so check your weighting.",
      divePlan:
        "Guide-led only, with group size set by the guide, along the line and never beyond the daylight. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. A through-route between cenotes is a cave dive; do not follow it. Entry is confirmed by staff on the day.",
      fitTone: "demanding",
      fitNote: "Large rooms with a halocline near 10 m. Buoyancy control is the skill.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
    },
  },
  // Denominator row: Chikin Ha
  // Position: OpenStreetMap and Scubago agree within 100 m. Depth: Cancún Scuba Center 50 ft (15 m). Cavern route within daylight per Tank-Ha. Entry fee in cash.
  // Halocline cenote: gated Advanced Open Water on top of the cavern specialty, per domain review. No source gives the entry (stairs, platform or ladder), so the briefing leaves it to the guide.
  {
    slug: "chikin-ha-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cenote-chikin-ha-136389",
      "https://www.prodiveinternational.com/dive-site/chickin-ha/",
      "https://cancunscubacenter.com/diving/diving-cenotes/",
      "https://deepmexico.com/",
    ],
    briefing: {
      name: "Chikin Ha Cenote",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.4994,
      forecastLongitude: -87.2611,
      description:
        "The first cenote of a system that links several over more than 10 km. The dive stays in the lit chamber, and the halocline begins at about 10 m.",
      marineLife: "Freshwater fish · tree roots · fossils",
      marineLifeDescription: "Roots reach into the water, and fossils sit in the walls.",
      difficultyLevel: "intermediate",
      depthRange: "0–15 m (0–49 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Still water. The halocline near 10 m blurs your view, and below it the water is warmer. Fins stir silt, so hold trim. Fresh water lifts you less than the sea, so check your weighting.",
      divePlan:
        "Guide-led only, with group size set by the guide, along the line in the lit chamber and back inside the daylight. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. A through-route between cenotes is a cave dive; do not follow it. Entry is confirmed by staff on the day.",
      fitTone: "demanding",
      fitNote: "A striking halocline at about 10 m. Hold your trim in the mixing layer.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
    },
  },
  // Denominator row: Tajma Ha (Taj Mahal)
  // Position: OpenStreetMap and Scubago agree within 20 m. Depth: Cancún Scuba Center 50 ft (15 m). Cavern route within daylight per Tank-Ha. Entry fee in cash.
  // Halocline cenote: gated Advanced Open Water on top of the cavern specialty, per domain review. No source gives the entry (stairs, platform or ladder), so the briefing leaves it to the guide. The multi-cenote traverse the sources mention is a cave route and is not part of the dive.
  {
    slug: "tajma-ha-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cenote-tajma-ha-201167",
      "https://www.prodiveinternational.com/dive-site/tajma-ha/",
      "https://cancunscubacenter.com/diving/diving-cenotes/",
      "https://tankha.com/diving/cenote-caverns",
    ],
    briefing: {
      name: "Tajma Ha Cenote",
      locationName: "Puerto Aventuras, Mexico",
      forecastLatitude: 20.4834,
      forecastLongitude: -87.277,
      description:
        "A cavern 5 km south of Puerto Aventuras, decorated with stalactites and stalagmites, with a halocline in the deeper areas. The dive covers only the lit chamber.",
      marineLife: "Fossils · limestone formations",
      marineLifeDescription: "Fossil shells, corals and urchin skeletons sit in the walls.",
      difficultyLevel: "intermediate",
      depthRange: "0–15 m (0–49 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Still water. The halocline in the deeper areas blurs your view, and fins stir silt, so hold trim. Weight for fresh water, which lifts you less than the sea.",
      divePlan:
        "Guide-led only, with group size set by the guide, along the line in the lit chamber, never beyond the daylight. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. A through-route between cenotes is a cave dive; do not follow it. Entry is confirmed by staff on the day.",
      fitTone: "demanding",
      fitNote:
        "Decorated and well lit, so delicate, with a halocline in the deeper areas. Stay off the formations.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
    },
  },
  // Denominator row: The Pit (El Pit)
  // Position: Scubago pin, 2 km from the Dos Ojos pin, consistent with Pro Dive's 2.8 km by road and with OpenStreetMap's point for the cenote. Depth: Pro Dive puts the hydrogen sulfide cloud at 30 m and the cenote narrows into darkness past 40 m; no source gives a recreational floor below the cloud, so the plan's floor is 27 m, above the cloud (its top varies; the cenote itself goes deeper), and the gate is Advanced Open Water without the Deep specialty because the plan stays shallower than 30 m. The 10 m sloping ceiling is not part of the plan. Akumal Dive Shop asks for Deep or Advanced with 30 logged dives. The sloping ceiling at 10 m is a cavern overhang within the light. Entry fee in cash.
  {
    slug: "el-pit-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cenote-el-pit-17663",
      "https://www.prodiveinternational.com/dive-site/el-pit/",
      "https://akumaldiveshop.com/cenote-diving/",
      "https://www.mexidivers.com/cenote-diving",
    ],
    briefing: {
      name: "The Pit",
      locationName: "Tulum, Mexico",
      forecastLatitude: 20.3232,
      forecastLongitude: -87.4099,
      description:
        "A deep gash in the jungle floor, 2.8 km past Dos Ojos. A shallow halocline sits near the top, and a hydrogen sulfide cloud sits around 30 m, past the plan. Sunbeams enter the opening in daylight.",
      marineLife: "Light beams · limestone walls",
      marineLifeDescription: "The animals are few. The sights are the light and the walls.",
      difficultyLevel: "advanced",
      depthRange: "0–27 m (0–89 ft)",
      maxDepthMeters: 27,
      currentNote:
        "Still water. The halocline blurs your view, the hydrogen sulfide cloud near 30 m hides what is below, and the cenote goes on far past the plan, so stay well above the cloud. Hydrogen sulfide is toxic, smells of rotten eggs and damages gear; the plan ends above it. Fresh water lifts you less than the sea, so check your weighting. The entrance is steep and narrow.",
      divePlan:
        "Guide-led only, with group size set by the guide, in daylight under the opening. Descend in the middle of the cenote to 27 m and no deeper; the cloud's top varies, so stop at the first haze. Come back up the same open water with reserve gas, and do not return under the sloping ceiling. Staff confirm the diver's log before boarding. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. The entrance is steep and narrow; staff confirm the entry on the day.",
      fitTone: "demanding",
      fitNote:
        "A deep dive in an unusual place. Operators ask for Deep or Advanced with 30 logged dives, so staff confirm the diver's log before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
    },
  },
  // Denominator row: Casa Cenote (Manatí)
  // Position: OpenStreetMap and Scubago agree within 100 m. Depth: Pro Dive says the dive follows the river at no more than 8 m. This is an open-air mangrove cenote joined to the sea, so no cavern card; the side caves are not part of the dive.
  {
    slug: "casa-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/casa-cenote-109901",
      "https://www.prodiveinternational.com/dive-site/casa-cenote/",
      "https://www.mexidivers.com/cenote-diving",
    ],
    briefing: {
      name: "Casa Cenote",
      locationName: "Tulum, Mexico",
      forecastLatitude: 20.2668,
      forecastLongitude: -87.3918,
      description:
        "An open-air cenote lined with mangroves, a river that joins one of the longest cave systems to the sea. The dive follows the river under the jungle at no more than 8 m.",
      marineLife: "Snapper · freshwater fish · mangrove roots",
      marineLifeDescription:
        "Fresh and saltwater fish share the river under the mangroves. Small caves along the sides are overheads: stay out of them.",
      difficultyLevel: "intermediate",
      depthRange: "0–8 m (0–26 ft)",
      maxDepthMeters: 8,
      currentNote:
        "Gentle flow, open to daylight throughout. Mangrove roots and rocks line the river, so watch fin tips. The side caves are overheads: stay out of them. Operators name a resident crocodile. Staff check for the crocodile before every dive; no one enters while it is in or near the river; surface only where briefed. Fresh water lifts you less than the sea, so check your weighting.",
      divePlan:
        "Guide-led. Follow the river from the lagoon end alongside the mangroves, and surface only where briefed.",
      fitTone: "unknown",
      fitNote:
        "Shallow and open to the sky, with a resident crocodile. Staff brief the entry and the exit.",
      creatureSlugs: ["gray-snapper"],
    },
  },
  // Denominator row: Gran Cenote
  // Position: OpenStreetMap. Pro Dive places the entrance on the highway to Cobá, 4 km from Tulum, which agrees. Depth: Pro Dive 10 m, Cancún Scuba Center 40 ft (12 m); taking 12 m. Cavern route within daylight: the dive follows the circular edge. Entry fee in cash.
  // No source gives the entry (stairs, platform or ladder), so the briefing leaves it to the guide.
  {
    slug: "gran-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.prodiveinternational.com/dive-site/gran-cenote/",
      "https://cancunscubacenter.com/diving/diving-cenotes/",
      "https://www.scubatotal.com/post/top-10-cenotes-dive-sites-in-mexico-from-cancun",
    ],
    briefing: {
      name: "Gran Cenote",
      locationName: "Tulum, Mexico",
      forecastLatitude: 20.2466,
      forecastLongitude: -87.4641,
      description:
        "A circular cenote with white walls and decorated passages, 4 km from Tulum on the road to Cobá. The cavern dive follows the edge of the circle.",
      marineLife: "Freshwater turtles · fossils",
      marineLifeDescription:
        "Turtles live in the open water at the top. White formations and fossils fill the cavern.",
      difficultyLevel: "intermediate",
      depthRange: "0–12 m (0–39 ft)",
      maxDepthMeters: 12,
      currentNote:
        "Still water. Fins stir silt over the decorated passages, so perfect buoyancy matters. Check your weighting for fresh water, which lifts you less than the sea.",
      divePlan:
        "Guide-led only, with group size set by the guide, along the circle of the cenote and never beyond the daylight. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. A through-route between cenotes is a cave dive; do not follow it. Entry is confirmed by staff on the day.",
      fitTone: "demanding",
      fitNote: "White walls and clear water, and delicate to dive. Perfect buoyancy matters.",
      requiredSpecialties: ["cavern"],
    },
  },
  // Denominator row: Calavera (Temple of Doom)
  // Position: OpenStreetMap and Scubago agree within 90 m. Depth: Cancún Scuba Center 50 ft (15 m), Scubago 15 m. Cavern route: Scubago says the dive suits certified cavern divers; Pro Dive describes a large chamber lit through holes in the roof. Entry fee in cash.
  // Halocline cenote: gated Advanced Open Water on top of the cavern specialty, per domain review. No source mentions a ladder, so the jump stays and the briefing asks divers to tell the guide first.
  {
    slug: "calavera-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cenote-calavera-131765",
      "https://www.prodiveinternational.com/dive-site/calavera/",
      "https://cancunscubacenter.com/diving/diving-cenotes/",
    ],
    briefing: {
      name: "Calavera",
      locationName: "Tulum, Mexico",
      forecastLatitude: 20.2291,
      forecastLongitude: -87.4577,
      description:
        "The Skull Cenote, also called Temple of Doom, entered through a round hole in the surface rock. You jump about 3 m to the water, then circle a hill of sediment and rock in a huge chamber, passing three halocline layers.",
      marineLife: "Fossils · limestone formations",
      marineLifeDescription:
        "Look up at the entrance for the skull's eyes and mouth, and look in the walls for fossils.",
      difficultyLevel: "intermediate",
      depthRange: "0–15 m (0–49 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Still water. Three halocline layers blur your view as you cross them, and fins stir silt. Weight for fresh water, which lifts you less than the sea. The entry is a jump of about 3 m through the roof hole. Tell the guide before you kit up if a jump is a problem for you.",
      divePlan:
        "Guide-led only, with group size set by the guide. Jump from the platform, circle the central hill at changing depths along the wall, and stay inside the daylight. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. A through-route between cenotes is a cave dive; do not follow it.",
      fitTone: "demanding",
      fitNote:
        "A dramatic entry and a roomy chamber. Staff confirm the diver's log before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
    },
  },
  // Denominator row: Carwash (Aktun Ha)
  // Position: OpenStreetMap and Scubago agree within 60 m. Depth: Cancún Scuba Center 60 ft (18 m) for Aktun Ha. Cavern route within daylight per Mexidivers. Entry fee in cash.
  // No source gives the entry (stairs, platform or ladder), so the briefing leaves it to the guide.
  {
    slug: "carwash-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cenote-car-wash-aktun-ha-133537",
      "https://cancunscubacenter.com/diving/diving-cenotes/",
      "https://www.mexidivers.com/cenote-diving",
    ],
    briefing: {
      name: "Carwash",
      locationName: "Tulum, Mexico",
      forecastLatitude: 20.2745,
      forecastLongitude: -87.4863,
      description:
        "Also called Aktun Ha, where taxi drivers once washed their cars. Roots, lily pads and a cavern lit through the water, with a layer of algae at the surface that gives the light a green tint.",
      marineLife: "Fish · fossils · lily pads",
      marineLifeDescription:
        "Fossils sit in the walls, and the algae layer at the surface shapes the light.",
      difficultyLevel: "intermediate",
      depthRange: "0–18 m (0–59 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Still water. Silt rises easily from the floor, so hold trim and keep kicks short. Fresh water lifts you less than the sea, so check your weighting.",
      divePlan:
        "Guide-led only, with group size set by the guide, along the line through the cavern and never beyond the daylight. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. A through-route between cenotes is a cave dive; do not follow it. Entry is confirmed by staff on the day.",
      fitTone: "demanding",
      fitNote: "Calm and bright, but silt rises easily. Hold trim and keep kicks short.",
      requiredSpecialties: ["cavern"],
    },
  },
  // Denominator row: Angelita
  // Position: OpenStreetMap and Scubago agree within 60 m. Depth: the cenote drops straight down to about 60 m, with the hydrogen sulfide cloud at about 30 m (Pro Dive, Mexidivers); Pro Dive says it is most often dived to 40 m. The plan's floor is 27 m, above the cloud (its top varies), so the gate is Advanced Open Water without the Deep specialty; the cloud and the basin below are past the plan (Akumal Dive Shop asks for Deep or Advanced with 30 logged dives). No source gives the entry. No overhead route is described; it is an open sinkhole. Entry fee in cash.
  {
    slug: "angelita-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cenote-angelita-147600",
      "https://www.prodiveinternational.com/dive-site/angelita/",
      "https://www.mexidivers.com/cenote-diving",
      "https://akumaldiveshop.com/cenote-diving/",
    ],
    briefing: {
      name: "Angelita",
      locationName: "Tulum, Mexico",
      forecastLatitude: 20.1375,
      forecastLongitude: -87.578,
      description:
        "A round cenote that drops straight down, far past the plan's floor. At roughly 30 m a hydrogen sulfide cloud forms a layer like a river, with branches reaching up through it; the branches, the cloud and the dark salt water below are past the plan. Hydrogen sulfide is toxic, smells of rotten eggs and damages gear.",
      marineLife: "Few animals · clear water",
      marineLifeDescription:
        "Almost no animals in the clear water above the plan. The branches and the sulfide cloud lie below the plan.",
      difficultyLevel: "advanced",
      depthRange: "0–27 m (0–89 ft)",
      maxDepthMeters: 27,
      currentNote:
        "Still water. A halocline blurs the view, and the sulfide cloud lies past the plan's floor; the cenote falls away far below the plan's floor, so stay well above the hydrogen sulfide cloud. Fresh water lifts you less than the sea, so check your weighting.",
      divePlan:
        "Guide-led only. Descend the clear water to 27 m and no deeper; the cloud's top varies, so stop at the first haze. The plan ends above the cloud. Ascend slowly along the walls with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A deep dive in a place that tempts you down. The floor is the plan's, not the cenote's.",
      minimumCertificationLevel: "advanced_open_water",
    },
  },
  // Denominator row: Dos Ojos (Barbie Line, Bat Cave)
  // Position: OpenStreetMap and Scubago agree within 30 m. Depth: Cancún Scuba Center 30 ft (9 m) on the Barbie Line and 40 ft (12 m) in the Bat Cave; taking 12 m. Cavern route: both lines stay within the natural light zone per Mexidivers. Entry fee in cash.
  // Halocline cenote: gated Advanced Open Water on top of the cavern specialty, per domain review. No source gives the entry (stairs, platform or ladder), so the briefing leaves it to the guide. Mexidivers puts Dos Ojos among the cavern cenotes that stay in the natural light zone; the named Barbie and Bat Cave lines are left out of the prose. The through-route between the eyes and the dark chambers are cave routes: the prose says they are past the light and out of scope, and the plan stays in daylight.
  {
    slug: "dos-ojos-cenote",
    version: 1,
    area: "mexico-cenotes",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cenote-dos-ojos-62804",
      "https://www.prodiveinternational.com/dive-site/dos-ojos/",
      "https://cancunscubacenter.com/diving/diving-cenotes/",
      "https://www.mexidivers.com/cenote-diving",
    ],
    briefing: {
      name: "Dos Ojos",
      locationName: "Tulum, Mexico",
      forecastLatitude: 20.3248,
      forecastLongitude: -87.3907,
      description:
        "Two circular cenotes, 'two eyes'. The guided dive is a lit loop in the first eye, in daylight. The through-route to the second eye and the dark chambers lie past the light and are out of scope.",
      marineLife: "Freshwater catfish · limestone formations",
      marineLifeDescription: "Few animals, but columns and stalactites in the lit chamber.",
      difficultyLevel: "intermediate",
      depthRange: "0–12 m (0–39 ft)",
      maxDepthMeters: 12,
      currentNote:
        "Still water. The halocline blurs your view, and fins stir silt over the decoration, so hold trim. Fresh water lifts you less than the sea, so check your weighting.",
      divePlan:
        "Guide-led only, with group size set by the guide, along the lit loop inside the daylight. The cave lines beyond the light are not part of the dive. Carry a primary light and a backup, and turn the dive when a third of your gas is gone. A through-route between cenotes is a cave dive; do not follow it. Entry is confirmed by staff on the day.",
      fitTone: "demanding",
      fitNote: "Not deep, but delicate, with a halocline. Buoyancy and trim make the dive.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
    },
  },
];
