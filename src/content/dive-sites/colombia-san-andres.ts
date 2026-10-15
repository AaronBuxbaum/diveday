// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** San Andrés and Providencia. */
export const COLOMBIA_SAN_ANDRES: DiveSiteTemplate[] = [
  // Denominator row: Bajo Bonito (La Plaza de Toros)
  {
    slug: "bajo-bonito-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://travel.padi.com/dive-site/colombia/bajo-bonito-plaza-de-toros/",
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/bajobonito.html",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
      "https://agendadelmar.com/gua-de-buceo-de-san-andrs/",
    ],
    briefing: {
      // Depth: Karibik Diver says 5 to 16 m, PADI says 20 m; the plan floor is held at 18 m. Agenda del Mar lists 12 to 15 m, a diver's log 15 m. Position: PADI's pin, which OpenStreetMap's coastline puts about 300 m offshore, in the water; the Divers Team map draws the site in the same stretch.
      name: "Bajo Bonito (Plaza de Toros)",
      locationName: "Northwest coast, San Andrés Island",
      forecastLatitude: 12.592,
      forecastLongitude: -81.714,
      description:
        "A reef running parallel to the northwest coast, with good coral cover. Its sand bowl, ringed by coral and shaped like a bullring, gives the other name. Rock formations and a small cave sit in the reef.",
      marineLife: "Southern stingrays · lobsters · morays · nurse sharks",
      marineLifeDescription:
        "Rays work the sand lanes, lobsters and morays sit inside the reef, and nurse sharks rest on the edge of the shallow plateau.",
      difficultyLevel: "intermediate",
      depthRange: "5–18 m (16–59 ft)",
      maxDepthMeters: 18,
      currentNote:
        "A cave in the reef is overhead; stay out of it. Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the reef along the sand lane, keeping the structure beside you and holding no deeper than 18 m (59 ft), and come back along the shallower side.",
      fitTone: "welcoming",
      fitNote:
        "Varied coral and sand with a bullring to find, best for a diver who holds depth without fuss.",
      landmarks: [
        {
          name: "The bullring",
          kind: "reefFormation",
          note: "A round sand bowl about 14 m deep, ringed by coral.",
        },
      ],
      creatureSlugs: ["southern-stingray", "spiny-lobster", "green-moray", "nurse-shark"],
    },
  },
  // Denominator row: Cantil Bajo Bonito
  {
    slug: "cantil-bajo-bonito-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://travel.padi.com/dive-site/colombia/cantil-bajo-bonito/",
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/bajo_bonito_cantil.html",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      // PADI lists 40 m and calls it a deep first dive; Karibik Diver says the plateau starts at 12 m, the edge is at 18 to 20 m and the wall passes 30 m. The plan floor is 30 m.
      name: "Cantil Bajo Bonito",
      locationName: "Northwest coast, San Andrés Island",
      forecastLatitude: 12.5965,
      forecastLongitude: -81.7159,
      description:
        "A coral garden on a shallow plateau that ends in a wall. The edge is rich with fish, and the wall falls past recreational depth.",
      marineLife: "Angelfish · parrotfish · stingrays · nurse sharks",
      marineLifeDescription:
        "Fish gather along the edge. Rays, nurse sharks, lobsters and the odd turtle turn up.",
      difficultyLevel: "intermediate",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Drop onto the plateau, follow the edge no deeper than 30 m (100 ft), and back up the reef with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A wall dive where the floor is yours to hold.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The edge",
          kind: "reefFormation",
          note: "Where the plateau ends and the wall begins, rich with fish.",
        },
      ],
      creatureSlugs: [
        "queen-angelfish",
        "stoplight-parrotfish",
        "southern-stingray",
        "nurse-shark",
        "spiny-lobster",
        "hawksbill-turtle",
      ],
    },
  },
  // Denominator row: La Montañita
  {
    slug: "la-montanita-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/montanita.html",
      "https://travel.padi.com/dive-site/colombia/la-montanita/",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
    ],
    briefing: {
      // Depth: PADI lists 4 m, Karibik Diver a plateau from 10 m, an edge at 18 to 20 m and a drop past 30 m; the plan floor is 15 m, 3 m above the shallowest edge, and the edge itself, at 20 m, sets maxDepthMeters. Position: PADI's pin, which the Divers Team map agrees with to about 1 km.
      name: "La Montañita",
      locationName: "Northwest coast, San Andrés Island",
      forecastLatitude: 12.5847,
      forecastLongitude: -81.719,
      description: "A coral garden on a shallow plateau. The edge beyond it drops away.",
      marineLife: "Stingrays · nurse sharks · lobsters · morays",
      marineLifeDescription: "The edge is the busiest part. With luck there are turtles.",
      difficultyLevel: "beginner",
      depthRange: "10–20 m (35–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "A cave in the reef is overhead; stay out of it. Current not documented; ask the crew on the day.",
      divePlan:
        "Stay on the plateau between 10 and 15 m (33 and 49 ft), which keeps a margin of 3 m above the edge, and turn before it. The edge at 20 m and the drop-off beyond it lie deeper than the plan.",
      fitTone: "welcoming",
      fitNote: "A plateau dive for a diver who watches the gauge and turns on time.",
      creatureSlugs: [
        "southern-stingray",
        "nurse-shark",
        "spiny-lobster",
        "green-moray",
        "hawksbill-turtle",
      ],
    },
  },
  // Denominator row: La Rocosa (La Rocasa)
  {
    slug: "la-rocosa-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/la_rocasa.html",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
      "https://www.chronic-wanderlust.com/diving-san-andres/",
    ],
    briefing: {
      // Approximate pin: no source publishes coordinates. Placed from the Divers Team map's position on the west coast, interpolated between sites PADI does pin (La Montañita and Reggae Nest), and set about 250 m off the OpenStreetMap coastline; good to about 2 km, and more than 200 m from every other pin. Depth: Karibik Diver's plateau from 10 m and an edge beyond it, and a diver's log of 14.8 m maximum; the plan floor is 15 m. A shop confirms its own point.
      // The Divers Team map draws La Rocosa about 500 m south of La Montañita on the west coast.
      name: "La Rocosa",
      locationName: "West coast, San Andrés Island",
      forecastLatitude: 12.5798,
      forecastLongitude: -81.724,
      description:
        "Patch reefs on sand to the north, and in the south a coral garden on a plateau that ends in a drop-off.",
      marineLife: "Stingrays · nurse sharks · lobsters · morays",
      marineLifeDescription: "The edge of the southern garden holds most of the fish.",
      difficultyLevel: "beginner",
      depthRange: "10–15 m (33–49 ft)",
      maxDepthMeters: 15,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Start on the patch reefs over sand to the north, work south to the garden, and hold 15 m (49 ft) at most. Turn well before the southern edge; the drop-off lies beyond the plan.",
      fitTone: "welcoming",
      fitNote: "Sand, patch reefs and a garden, all within one tank at modest depth.",
      creatureSlugs: [
        "southern-stingray",
        "nurse-shark",
        "spiny-lobster",
        "green-moray",
        "hawksbill-turtle",
      ],
    },
  },
  // Denominator row: Reggae Nest
  {
    slug: "reggae-nest-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/reggae-nest.html",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
      "https://etbtravelphotography.com/top-dive-sites-in-san-andres-colombia/",
      "https://www.chronic-wanderlust.com/diving-san-andres/",
    ],
    briefing: {
      // Approximate pin: no source publishes coordinates. Placed from the Divers Team map's position on the west coast, interpolated between sites PADI does pin (La Montañita and Barco Hundido), and set about 200 m off the OpenStreetMap coastline; good to about 2 km, and more than 200 m from every other pin. A shop confirms its own point.
      // Depth: Karibik Diver 10 to 20 m; two divers' logs reach 19 to 20 m (65 ft, 18.9 m). The Divers Team map draws Reggae Nest at about the middle of the west coast, 3 km south of La Montañita.
      name: "Reggae Nest",
      locationName: "West coast, San Andrés Island",
      forecastLatitude: 12.5541,
      forecastLongitude: -81.7345,
      description:
        "A reef running parallel to the west coast, with rock formations and mixed corals.",
      marineLife: "Great barracuda · stingrays · lobsters · nurse sharks",
      marineLifeDescription:
        "Barracuda patrol the reef, rays work the sand lanes, and nurse sharks rest on the shallow edge.",
      difficultyLevel: "intermediate",
      depthRange: "10–20 m (33–66 ft)",
      maxDepthMeters: 20,
      // Gate: a reported moderate current at the mooring line and a 20 m floor; the sources call no gate, so this is the conservative reading.
      currentNote:
        "Moderate current is reported; ask the crew. A cave in the reef is overhead; stay out of it.",
      divePlan:
        "Follow the reef along the sand lane and come back along the shallow edge, planning the return for any current. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A long reef at moderate depth, best as a second dive.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["great-barracuda", "southern-stingray", "spiny-lobster", "nurse-shark"],
    },
  },
  // Denominator row: Blue Diamond wreck (Wreck Diamond, Barco Hundido)
  {
    slug: "blue-diamond-wreck-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://en.escueladebuceoseapride.com/buceo",
      "https://travel.padi.com/dive-site/colombia/blue-diamond/",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
      "https://www.buceo21.com/REPORTAJES/turismo/88sanandres.html",
    ],
    briefing: {
      // Position: PADI's pin; the Divers Team map draws the Barco Hundido at the same stretch of coast. Depth: Sea Pride and PADI both say 14 m; Buceo XXI says 13 m. Buceo XXI says storms batter it; a diver's log calls it collapsed.
      name: "Blue Diamond Wreck",
      locationName: "West coast, San Andrés Island",
      forecastLatitude: 12.5355,
      forecastLongitude: -81.7359,
      description:
        "A broken-up ship close to the west coast, grown over with coral, in a wide stretch of sand. It can be reached by boat or by a surface swim of about 80 m (260 ft) from shore.",
      marineLife: "Parrotfish · angelfish · morays · boxfish",
      marineLifeDescription:
        "Fish gather around the steel, and the corals growing on it are the reason to look.",
      difficultyLevel: "intermediate",
      depthRange: "14 m (46 ft)",
      maxDepthMeters: 14,
      // Gate: an open-water surface swim of about 80 m from shore, surface traffic and loose steel, not depth.
      currentNote:
        "Stay outside the hull. The shore route is an 80 m surface swim in open water with boat traffic overhead; confirm entry and exit with the crew. Storms have battered the wreck, so expect loose and sharp steel and skip it in rough weather. Current not documented; ask the crew on the day.",
      divePlan:
        "Circle the wreck from outside at one depth, rise along the outer side, and finish over the sand beside it. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A shallow wreck with a long surface swim and loose steel, seen from the outside only.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wreck",
          kind: "wreckFeature",
          note: "A ship broken up by storms and grown over with coral. Stay outside the hull.",
        },
      ],
      creatureSlugs: ["queen-angelfish", "stoplight-parrotfish", "green-moray", "smooth-trunkfish"],
    },
  },
  // Denominator row: West View
  {
    slug: "west-view-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://travel.padi.com/dive-site/colombia/west-view/",
      "https://en.escueladebuceoseapride.com/buceo",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
    ],
    briefing: {
      // Depth: Sea Pride says 6 to 12 m, PADI says 9 to 10 m. Position: PADI's pin.
      name: "West View",
      locationName: "West coast, San Andrés Island",
      forecastLatitude: 12.5205,
      forecastLongitude: -81.7316,
      description:
        "A rocky shallow reef on the west coast near Km 11, known for the Poseidon statue.",
      marineLife: "Butterflyfish · parrotfish · angelfish · grunts",
      marineLifeDescription:
        "Fish are everywhere over the rock, and the statue draws most divers first.",
      difficultyLevel: "beginner",
      depthRange: "6–12 m (20–40 ft)",
      maxDepthMeters: 12,
      currentNote:
        "Entry is from the shore or by boat; confirm the entry, exit and any surface swim with the crew, and watch for surface traffic. Current not documented; ask the crew on the day.",
      divePlan: "Visit the statue, then work along the rocky reef and back.",
      fitTone: "welcoming",
      fitNote: "Shallow and compact, so it suits a first dive or a Discover Scuba session.",
      landmarks: [
        {
          name: "Poseidon statue",
          kind: "underwaterMonument",
          note: "The sculpture the site is known for, on the rocky bottom.",
        },
      ],
      creatureSlugs: [
        "french-angelfish",
        "stoplight-parrotfish",
        "bluestriped-grunt",
        "foureye-butterflyfish",
      ],
    },
  },
  // Denominator row: El Faro
  {
    slug: "el-faro-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://en.escueladebuceoseapride.com/buceo",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
      "https://www.buceo21.com/REPORTAJES/turismo/88sanandres.html",
    ],
    briefing: {
      // Approximate pin: no source publishes coordinates. The Divers Team map draws El Faro between West View and La Piscinita on the west coast, about 630 m south of West View's PADI pin. Good to about 1 km. Depth: Sea Pride 6 to 12 m, Buceo XXI 12 m. Buceo XXI also calls it a shore dive with many urchins and a small cavern.
      name: "El Faro",
      locationName: "West coast, San Andrés Island",
      forecastLatitude: 12.5148,
      forecastLongitude: -81.7315,
      description:
        "A shallow reef on the west coast, reached from shore or by boat, with tall chimney-shaped corals and plenty of sea urchins.",
      marineLife: "Parrotfish · butterflyfish · angelfish · grunts",
      marineLifeDescription: "Soft and hard corals, with the usual reef fish over them.",
      difficultyLevel: "beginner",
      depthRange: "6–12 m (20–40 ft)",
      maxDepthMeters: 12,
      currentNote:
        "Sea urchins are common, so watch your hands and fins at the shore entry. A small cavern is overhead; stay out of it. Current not documented; ask the crew on the day.",
      divePlan:
        "Work along the formation, keep clear of the cavern, and return along the same line to your exit.",
      fitTone: "welcoming",
      fitNote: "Shallow and compact; urchins make good buoyancy matter more than depth.",
      creatureSlugs: [
        "stoplight-parrotfish",
        "foureye-butterflyfish",
        "french-angelfish",
        "bluestriped-grunt",
      ],
    },
  },
  // Denominator row: El Velerito
  {
    slug: "el-velerito-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/el_velerito.html",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
      "https://agendadelmar.com/gua-de-buceo-de-san-andrs/",
    ],
    briefing: {
      // The drop-off falls past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty. Agenda del Mar lists 40 m and Karibik Diver a drop past 45 m; both lie beyond the plan floor.
      // Approximate pin: no source publishes coordinates. Placed from the Divers Team map's position on the west coast, interpolated between sites PADI does pin (Nirvana and West View); good to about 2 km, and more than 200 m from every other pin. A shop confirms its own point.
      // The Divers Team map draws it just north of Nirvana and further out to sea; 400 m from Nirvana's pin.
      // Karibik Diver: plateau from 10 m, edge at 20 m, drop past 45 m. Agenda del Mar puts the sunken sailboat's entrance at the cantil, Karibik at the anchor point, so the plan leaves the boat outside either way.
      name: "El Velerito",
      locationName: "Southwest coast, San Andrés Island",
      forecastLatitude: 12.5037,
      forecastLongitude: -81.7345,
      description:
        "Sand, then a coral garden on a shallow plateau that ends in a drop-off. A small sunken sailboat lies on the site; stay outside it.",
      marineLife: "Stingrays · lobsters · barracuda · turtles",
      marineLifeDescription: "Jacks and barracuda pass along the edge.",
      difficultyLevel: "intermediate",
      depthRange: "10–30 m (33–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Cross the sand to the coral, follow the edge no deeper than 30 m (100 ft), and back up the reef with reserve gas. Stay outside the sailboat. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A drop-off dive where the floor is yours to hold.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The sailboat",
          kind: "wreckFeature",
          note: "A small sunken sailboat. Stay outside it.",
        },
      ],
      creatureSlugs: ["southern-stingray", "spiny-lobster", "great-barracuda", "green-moray"],
    },
  },
  // Denominator row: Nirvana
  {
    slug: "nirvana-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://gaiascuba.com/por-que-bucear-en-san-andres/",
      "https://travel.padi.com/dive-site/colombia/nirvana/",
      "https://en.escueladebuceoseapride.com/buceo",
    ],
    briefing: {
      // Gaia says 12 to 30 m; PADI lists 40 m as the site's maximum. No source says whether the reef ends at 40 m or drops on, so the deeper figure is the plan floor and the site is gated as a deep dive. Position: PADI's pin.
      name: "Nirvana",
      locationName: "Southwest coast, San Andrés Island",
      forecastLatitude: 12.5013,
      forecastLongitude: -81.7321,
      description:
        "A reef off the southwest coast with brain corals, gorgonians and tube sponges, shallow in part and deeper in part. Nurse sharks rest in the hollows.",
      marineLife: "Parrotfish · angelfish · barracuda · nurse sharks",
      marineLifeDescription:
        "Schools of parrotfish and angelfish, with groupers and barracuda along the structure.",
      difficultyLevel: "advanced",
      depthRange: "12–40 m (40–131 ft)",
      maxDepthMeters: 40,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Drop onto the reef, work along it no deeper than 40 m (131 ft), and finish the dive shallower with reserve gas. The sources do not document the bottom, so 40 m is the plan floor, not a known depth. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "Shallow in part and deep in part, so the depth is yours to hold.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "rainbow-parrotfish",
        "queen-angelfish",
        "great-barracuda",
        "nurse-shark",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: West Point
  {
    slug: "west-point-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/west_point.html",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
      "https://www.buceo21.com/REPORTAJES/turismo/88sanandres.html",
    ],
    briefing: {
      // Strong current and a drop-off, so the gate is Advanced Open Water. Karibik Diver: plateau from 12 m, edge at 20 m, drop past 45 m, strong currents that push divers off the reef. Buceo XXI: a cantil (wall) dived in the low to mid 20s. The wall falls past recreational depth, so the 25 m floor is the plan's own limit.
      // Approximate pin: no source publishes coordinates. Placed from the Divers Team map's position on the west coast, placed about 1 km southwest of Nirvana's PADI pin at the southwest tip; set about 240 m off the OpenStreetMap coastline; good to about 2 km, and more than 200 m from every other pin. A shop confirms its own point.
      // The Divers Team map draws West Point at the southwest tip, south of Nirvana.
      name: "West Point",
      locationName: "Southwest tip, San Andrés Island",
      forecastLatitude: 12.4945,
      forecastLongitude: -81.7375,
      description:
        "A coral garden on a plateau split by a sand lane where the boat anchors, ending in a cantil (wall) that falls away past recreational depth. Big sand patches and schools of fish show up along the way.",
      marineLife: "Stingrays · lobsters · barracuda · turtles",
      marineLifeDescription: "Jacks and barracuda along the edge.",
      difficultyLevel: "advanced",
      depthRange: "12–25 m (40–82 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Strong currents often push divers off the reef. Carry an SMB and stay close to the group. If you are swept off the wall, send up the SMB, ascend slowly beside its line with a safety stop, and signal the boat.",
      divePlan:
        "Start on the plateau, follow the wall no deeper than 25 m (82 ft), and turn early if the current picks up. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "The current can carry a diver off the reef, so it suits practiced advanced divers.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["southern-stingray", "spiny-lobster", "great-barracuda", "hawksbill-turtle"],
    },
  },
  // Denominator row: Trampa Tortuga
  {
    slug: "trampa-tortuga-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://travel.padi.com/dive-site/colombia/trampa-de-tortuga/",
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/trampatortuga.html",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      // Karibik Diver: garden from 10 m, then a drop to 20 to 30 m and in the northeast down to 60 m; PADI says the platform runs from 12 m past 100 m. Position: PADI's pin.
      name: "Trampa Tortuga",
      locationName: "East barrier reef, San Andrés Island",
      forecastLatitude: 12.5431,
      forecastLongitude: -81.6785,
      description:
        "A coral garden on the barrier reef east of the island, with a block that rises in front of the main reef and a wall that falls away past recreational depth. Visitors in the blue are the reason it is known.",
      marineLife: "Stingrays · green morays · turtles · nurse sharks",
      marineLifeDescription:
        "Rays and green morays are common. Dolphins, turtles and sharks have turned up, though none is promised.",
      difficultyLevel: "advanced",
      depthRange: "10–30 m (33–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Open water on the east barrier reef; current is not documented, so carry an SMB. Sharks, rays and other big animals: stay put, keep nothing dangling, do not chase or touch, stay with the group and follow the crew's briefing.",
      divePlan:
        "Drop onto the garden, follow the edge and the block no deeper than 30 m (100 ft), and back up the reef with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A reef-edge dive over deep water.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The block",
          kind: "reefFormation",
          note: "A coral block rising in front of the main reef, its top near 22 m.",
        },
      ],
      creatureSlugs: ["southern-stingray", "green-moray", "nurse-shark", "hawksbill-turtle"],
    },
  },
  // Denominator row: Blue Wall
  {
    slug: "blue-wall-san-andres",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://travel.padi.com/dive-site/colombia/blue-wall-2/",
      "https://web.archive.org/web/2019/https://www.karibik-diver.com/bluewall.html",
      "https://www.diversteam.net/wp-content/uploads/2018/09/mapa-buceo-sai-trilogia-alta-resolucion.pdf",
      "https://agendadelmar.com/gua-de-buceo-de-san-andrs/",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a floor at 40 m, so the gate is Advanced Open Water with the Deep specialty.
      // Karibik Diver: a drop-off to 60 m. PADI: 8 m to well past 50 m, with most dives ending near 40 m and advanced divers and up. The plan floor is 40 m, where most dives end, so the gate includes the Deep specialty. Karibik Diver says gray reef sharks; the catalog's Caribbean reef shark is used. Agenda del Mar: 6 to 42 m, variable current, advanced, a cavern of about 10 m on the wall (overhead; stay out). Position: PADI's pin.
      name: "Blue Wall",
      locationName: "Southeast coast, San Andrés Island",
      forecastLatitude: 12.4967,
      forecastLongitude: -81.7151,
      description:
        "An outer reef slope and drop-off on the east side, with coral blocks in front of the wall. Reef sharks are reported here.",
      marineLife: "Reef sharks · nurse sharks · parrotfish · lobsters",
      marineLifeDescription:
        "Sharks cruise around the coral blocks, nurse sharks rest on the plateau, and large parrotfish graze the reef.",
      difficultyLevel: "advanced",
      depthRange: "8–40 m (26–131 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Current is variable and strong winds from November to January stir the surface. Carry an SMB. A cavern and a canyon swim-through near the wall are overhead; stay out. Sharks: stay put, keep nothing dangling, do not chase or touch, stay with the group and follow the crew's briefing. No season is documented for the sharks, so ask the crew; without them the dive is a wall and coral blocks.",
      divePlan:
        "Drop onto the plateau, follow the wall and the blocks no deeper than 40 m (131 ft), keep clear of the cavern, and back up the reef with reserve gas. Most dives end near 40 m and the wall falls beyond it. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep wall dive in variable current.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "caribbean-reef-shark",
        "nurse-shark",
        "rainbow-parrotfish",
        "spiny-lobster",
        "green-moray",
      ],
    },
  },
  // Denominator row: Cantil de Santa Catalina
  {
    slug: "cantil-de-santa-catalina-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/cantil-de-santa-catalina/",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      // DSOP: 12 to 35 m; Felipe Diving: 40 to 150 ft. The plan floor is 30 m.
      // Position: PADI's pin. Felipe Diving lists it 3.36 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "Cantil de Santa Catalina",
      locationName: "Santa Catalina, Providencia",
      forecastLatitude: 13.4024,
      forecastLongitude: -81.3924,
      description:
        "A coral platform that slopes to a wall, with small caves in it and sponges and corals along the way, as last reported. Reef sharks and stingrays have been seen here.",
      marineLife: "Reef sharks · stingrays · lobsters · sponges",
      marineLifeDescription:
        "Lobsters and shrimp sit in the small caves, and reef sharks cruise past the wall.",
      difficultyLevel: "intermediate",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. Small caves on the wall are overhead; stay out. Sharks: stay put, keep nothing dangling, do not chase or touch, follow the crew's briefing. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Drop onto the platform, follow the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. Staff confirm the diver's log before boarding. Hurricane Iota (November 2020) damaged Providencia; moorings, wrecks and reef condition are confirmed with the crew.",
      fitTone: "demanding",
      fitNote: "A wall dive off a remote island.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "southern-stingray",
        "spiny-lobster",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Felipe's Place
  {
    slug: "felipes-place-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/felipes-place/",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      // DSOP: 8 to 60+ m; Felipe Diving: 31 to 80 ft multilevel. The plan floor is 30 m.
      // Position: PADI's pin. Felipe Diving lists it 3.25 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "Felipe's Place",
      locationName: "Santa Catalina, Providencia",
      forecastLatitude: 13.3989,
      forecastLongitude: -81.3992,
      description:
        "A long platform of hard and soft corals and sponges, as last reported, that ends in a wall to the west. The structures described by older sources may have changed.",
      marineLife: "Sponges · soft corals · lobsters · crabs",
      marineLifeDescription:
        "Colored sponges cover the wall, and lobsters and cryptic fish sit in the small caves.",
      difficultyLevel: "intermediate",
      depthRange: "8–30 m (26–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. A crevice on the wall forms a tunnel, which is overhead; stay out of it. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Cross the platform, follow the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. Staff confirm the diver's log before boarding. Hurricane Iota (November 2020) damaged Providencia; moorings, wrecks and the statue and reef condition are confirmed with the crew.",
      fitTone: "demanding",
      fitNote: "A varied site that runs from a platform to a wall.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["spiny-lobster", "common-sea-fan", "giant-barrel-sponge", "sea-plume"],
    },
  },
  // Denominator row: Chromis (Cromis)
  {
    slug: "chromis-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/chromis/",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      // DSOP: 8 to 60+ m; Felipe Diving: 35 to 120 ft. PADI's pin is 45 m from Felipe's Place's pin (PADI publishes both). The plan floor is 30 m.
      // Position: PADI's pin. Felipe Diving lists it 3.0 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "Chromis",
      locationName: "Santa Catalina, Providencia",
      forecastLatitude: 13.3987,
      forecastLongitude: -81.3996,
      description:
        "A long platform of hard and soft corals and sponges, as last reported, that ends in a wall to the west, named for the clouds of chromis over it. Lobsters and crabs live along the wall to the south.",
      marineLife: "Blue chromis · brown chromis · lobsters · crabs",
      marineLifeDescription:
        "Chromis hang in the water over the platform, with cryptic fish on the wall.",
      difficultyLevel: "intermediate",
      depthRange: "8–30 m (26–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Cross the platform, then follow the wall south no deeper than 30 m (100 ft), and back up the reef with reserve gas. Staff confirm the diver's log before boarding. Hurricane Iota (November 2020) damaged Providencia; moorings, wrecks and reef condition are confirmed with the crew.",
      fitTone: "demanding",
      fitNote: "A platform-and-wall dive with life in the shallows.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["blue-chromis", "brown-chromis", "spiny-lobster", "common-sea-fan"],
    },
  },
  // Denominator row: The Cave (La Cueva)
  {
    slug: "the-cave-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/the-cave-2/",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      // DSOP: 12 to 30+ m; Felipe Diving: 48 to 140 ft. The plan floor is 30 m.
      // Position: PADI's pin. Felipe Diving lists it 2.91 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "The Cave",
      locationName: "Santa Catalina, Providencia",
      forecastLatitude: 13.3868,
      forecastLongitude: -81.4188,
      description:
        "Once called the garden cave. A wide platform of hard and soft corals and many fish, as last reported, ends in a wall to the west. Groupers, jacks and reef sharks pass along it.",
      marineLife: "Reef sharks · jacks · groupers · soft corals",
      marineLifeDescription:
        "Big fish pass along the wall, and the platform above is busy with smaller fish.",
      difficultyLevel: "intermediate",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. A cave in the reef is overhead; stay out of it. Sharks: stay put, keep nothing dangling, do not chase or touch, follow the crew's briefing. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Cross the platform, descend the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. Staff confirm the diver's log before boarding. Hurricane Iota (November 2020) damaged Providencia; moorings, wrecks and reef condition are confirmed with the crew.",
      fitTone: "demanding",
      fitNote: "A wall dive with big fish passing.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["caribbean-reef-shark", "horse-eye-jack", "black-grouper", "common-sea-fan"],
    },
  },
  // Denominator row: Convento
  {
    slug: "convento-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/the-convent/",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      // DSOP: wall to 40 m; Felipe Diving: 60 to 140 ft (18 to 43 m), so the shallowest depth is 18 m. The plan floor is 30 m.
      // Position: PADI's pin. Felipe Diving lists it 1.4 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "Convento",
      locationName: "West side, Providencia",
      forecastLatitude: 13.3566,
      forecastLongitude: -81.416,
      description:
        "A reef platform with broad sand patches, and a wall to the west. Most of the life is in the upper 25 m. To the north, reef sharks are reported over a sand area, and the shallow return crosses a platform with stingrays.",
      marineLife: "Reef sharks · stingrays · lobsters · pufferfish",
      marineLifeDescription:
        "Small caves hold lobsters and crabs, and the return across the platform is good for rays.",
      difficultyLevel: "intermediate",
      depthRange: "18–30 m (59–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. Sharks: stay put, keep nothing dangling, do not chase or touch, follow the crew's briefing. No shark season is documented, so ask the crew; without them the dive is a wall and a platform with rays. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Cross the platform, follow the wall north no deeper than 30 m (100 ft), and back up the reef with reserve gas. Staff confirm the diver's log before boarding. Hurricane Iota (November 2020) damaged Providencia; moorings, wrecks and reef condition are confirmed with the crew.",
      fitTone: "demanding",
      fitNote: "A wall and a platform in one tank.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["caribbean-reef-shark", "southern-stingray", "spiny-lobster", "balloonfish"],
    },
  },
  // Denominator row: Tete's Place
  {
    slug: "tetes-place-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/tetes-place/",
    ],
    briefing: {
      // Depth: DSOP 6 to 9 m; PADI 9 m; Felipe Diving 15 to 23 ft; the deeper figure is taken.
      // Position: PADI's pin. Felipe Diving lists it 1.38 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "Tete's Place",
      locationName: "Southwest, Providencia",
      forecastLatitude: 13.3281,
      forecastLongitude: -81.4116,
      description:
        "A shallow reef running southwest, parallel to the island, over rock, sand and seagrass. Pillar and soft corals sat on top as last reported, with morays and rays along the rocky edge.",
      marineLife: "Nurse sharks · morays · rays · grunts",
      marineLifeDescription:
        "Big schools of grunts and angelfish over the top, and nurse sharks are seen often. Dolphins pass sometimes.",
      difficultyLevel: "beginner",
      depthRange: "6–9 m (20–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Current not documented; ask the crew on the day. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Follow the reef southwest along the edge and return the same way. Hurricane Iota (November 2020) damaged Providencia; reef condition is confirmed with the crew.",
      fitTone: "welcoming",
      fitNote: "Shallow and rich in fish, so it suits a first dive on Providencia.",
      creatureSlugs: [
        "nurse-shark",
        "green-moray",
        "southern-stingray",
        "bluestriped-grunt",
        "pillar-coral",
      ],
    },
  },
  // Denominator row: Manta's City (Manta's Place)
  {
    slug: "mantas-city-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/mantas-city/",
    ],
    briefing: {
      // Depth: DSOP 5 to 12 m; PADI 12 m; Felipe Diving 30 ft.
      // Position: PADI's pin. Felipe Diving lists it 2.09 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "Manta's City",
      locationName: "South, Providencia",
      forecastLatitude: 13.315,
      forecastLongitude: -81.3744,
      description:
        "Round patch reefs on sand south of the island, with large star corals and sponges. The big rays are stingrays, mistaken for mantas, which gave the site its name. A sand wall to the east holds many sea stars.",
      marineLife: "Stingrays · snapper · surgeonfish · sea stars",
      marineLifeDescription:
        "Stingrays glide over the sand, and snapper and surgeonfish school over the patches.",
      difficultyLevel: "beginner",
      depthRange: "5–12 m (16–40 ft)",
      maxDepthMeters: 12,
      currentNote:
        "Current not documented; ask the crew on the day. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Hop between the patch reefs and cross the sand before turning back. Hurricane Iota (November 2020) damaged Providencia; reef condition is confirmed with the crew.",
      fitTone: "welcoming",
      fitNote: "Shallow patch reefs, suited to a first dive.",
      creatureSlugs: [
        "southern-stingray",
        "yellowtail-snapper",
        "ocean-surgeonfish",
        "great-star-coral",
      ],
    },
  },
  // Denominator row: El Planchón (tanker wreck)
  {
    slug: "el-planchon-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/el-planchon-2/",
    ],
    briefing: {
      // An upside-down hull on an open-sea reef 18 to 24 m down, so the gate is Advanced Open Water (an overhead nearby, not depth alone). DSOP 18 to 24 m; PADI 24 m; Felipe Diving 50 ft; the deeper figure is taken.
      // Position: PADI's pin. Felipe Diving lists it 2.14 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "El Planchón",
      locationName: "West side, Providencia",
      forecastLatitude: 13.3717,
      forecastLongitude: -81.418,
      description:
        "The upside-down hull of a tanker, reported intact on the seabed with soft corals on top. A winch plate and pipework are reported on the hull, and a coral reef surrounds the wreck.",
      marineLife: "Parrotfish · jacks · angelfish · morays",
      marineLifeDescription:
        "Fish gather on the reef around the hull, and basket stars curl up on the soft corals.",
      difficultyLevel: "intermediate",
      depthRange: "18–24 m (60–79 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Stay outside the hull. Current not documented; ask the crew on the day. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Circle the hull from outside at one depth, then follow the reef around it with reserve gas. Hurricane Iota (November 2020) damaged Providencia; the wreck and its moorings are confirmed with the crew.",
      fitTone: "demanding",
      fitNote: "A deeper wreck dive that needs Advanced Open Water. Look from outside only.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The hull",
          kind: "wreckFeature",
          note: "An upside-down tanker hull. Stay outside it.",
        },
      ],
      creatureSlugs: ["queen-angelfish", "stoplight-parrotfish", "green-moray", "spiny-lobster"],
    },
  },
  // Denominator row: Nick's Place
  {
    slug: "nicks-place-providencia",
    version: 1,
    area: "colombia-san-andres",
    sources: [
      "https://www.thediveshopoldprovidence.com/en/sitios-de-buceo/",
      "https://felipedivingshop.com/es/sitios-de-buceo/",
      "https://travel.padi.com/dive-site/colombia/nicks-place/",
    ],
    briefing: {
      // The wall drops past recreational depth; the plan holds a hard floor at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      // DSOP: 18 to 40+ m; Felipe Diving: 50/90 to 130 ft. The plan floor is 30 m.
      // Position: PADI's pin. Felipe Diving lists it 3.0 nautical miles from Agua Dulce, which agrees with the pin within about 1 km.
      name: "Nick's Place",
      locationName: "West side, Providencia",
      forecastLatitude: 13.3885,
      forecastLongitude: -81.4187,
      description:
        "A long platform of hard and soft corals and sponges, as last reported, that ends in a steep wall to the west. Lobsters, shrimp and nudibranchs live on the wall, and reef sharks are reported along it.",
      marineLife: "Reef sharks · lobsters · nudibranchs · angelfish",
      marineLifeDescription:
        "Gray angelfish and French angelfish cross the platform, with sharks along the wall.",
      difficultyLevel: "intermediate",
      depthRange: "18–30 m (60–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. Sharks: stay put, keep nothing dangling, do not chase or touch, follow the crew's briefing. No shark season is documented, so ask the crew; without them the dive is a platform and a wall of sponges and corals. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Cross the platform, follow the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. Staff confirm the diver's log before boarding. Hurricane Iota (November 2020) damaged Providencia; moorings, wrecks and reef condition are confirmed with the crew.",
      fitTone: "demanding",
      fitNote: "A wall dive along a coral platform.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "gray-angelfish",
        "french-angelfish",
        "spiny-lobster",
      ],
    },
  },
];
