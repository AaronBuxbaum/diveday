// i18n-exempt-file: shop-editable starter field-guide content, not app UI copy — see the doc comment
/**
 * DiveDay's marine-life catalog: the species a shop picks from when it writes a
 * dive site's field guide, and the words it starts from once it has.
 *
 * **These are starting words, not app copy.** Picking a species on the dive-site
 * form *copies* this row onto the site (`dive_site_creatures`), and the shop
 * edits it from there — its own name for the animal, its own sentence, its own
 * tip, its own photo. Nothing here is looked up at render time, so correcting an
 * entry in a later release never rewrites what a shop published; that is the
 * same contract `./course-templates.ts` has, and the reason both are exempt from
 * the message-bundle rule. What the shop typed is what a diver reads, in the
 * shop's own language.
 *
 * **Scope: the tropical western Atlantic** — Florida, the Keys, the Bahamas and
 * the wider Caribbean, which is where DiveDay's own dive-site templates are.
 * Every entry is a species a recreational diver plausibly meets on one of those
 * dives, described the way a briefing describes it: what it looks like, and how
 * to actually see one.
 *
 * **Photos** are bundled under `public/marine-life/` rather than hot-linked, for
 * the reason every other image in this app is (CR-020): a briefing page must
 * never make a live request to a host someone else controls. Credits and
 * licences are in that folder's README.
 *
 * `kind` is the category word the field guide prints over the name. It is free
 * text on the stored row — a shop may invent one — but the catalog keeps to a
 * short, consistent set so a guide assembled from it reads as one voice.
 */

export type MarineLifeSpecies = {
  /** Stable id; recorded on the copied row as provenance (`catalog_slug`). */
  slug: string;
  name: string;
  /** The species' formal name, for the shop that wants to be exact. */
  scientificName: string;
  kind: string;
  /** What it looks like, in one line a diver can match against the water. */
  description: string;
  /** How to actually see one — the lines the briefing's "slow down" aside collects. */
  preparationTip: string;
};

/** Where the bundled photo for a catalog species lives. */
export function marineLifeImage(slug: string): string {
  return `/marine-life/${slug}.jpg`;
}

/**
 * Every species, in the order the picker offers them: grouped by what a diver
 * would call them, and alphabetical inside each group. Not alphabetical
 * overall — a staffer writing a reef briefing thinks "what fish, then what
 * else", and 93 names in one A–Z is a list nobody reads to the end of.
 */
export const MARINE_LIFE_CATALOG: MarineLifeSpecies[] = [
  // --- Reef fish -----------------------------------------------------------
  {
    slug: "banded-butterflyfish",
    name: "Banded butterflyfish",
    scientificName: "Chaetodon striatus",
    kind: "Reef fish",
    description: "A white disc crossed by four dark bands, almost always in a pair.",
    preparationTip:
      "Watch one pair for a minute — they work a patch of reef together and circle back.",
  },
  {
    slug: "blue-chromis",
    name: "Blue chromis",
    scientificName: "Chromis cyanea",
    kind: "Reef fish",
    description: "Small electric-blue slivers hanging in open water just above the coral.",
    preparationTip:
      "Look up and out from the reef rather than down; they feed in the water column.",
  },
  {
    slug: "blue-tang",
    name: "Blue tang",
    scientificName: "Acanthurus coeruleus",
    kind: "Reef fish",
    description: "A deep blue oval with a bright scalpel at the tail; juveniles are yellow.",
    preparationTip: "Hover rather than chase — a loose group grazes past you on its own.",
  },
  {
    slug: "bluehead-wrasse",
    name: "Bluehead wrasse",
    scientificName: "Thalassoma bifasciatum",
    kind: "Reef fish",
    description: "Yellow youngsters and blue-headed adults, darting nose-down over the coral.",
    preparationTip: "Find a cleaning station and stay still; they come to you.",
  },
  {
    slug: "bluestriped-grunt",
    name: "Bluestriped grunt",
    scientificName: "Haemulon sciurus",
    kind: "Schooling fish",
    description: "Yellow flanks ruled with electric blue lines, in loose crowds under ledges.",
    preparationTip:
      "Look into the shade under overhangs — a whole school can sit out the day there.",
  },
  {
    slug: "creole-wrasse",
    name: "Creole wrasse",
    scientificName: "Clepticus parrae",
    kind: "Schooling fish",
    description: "Violet fish streaming along the reef edge in long, fast trains.",
    preparationTip: "Hold position at the drop-off and let the train come past you.",
  },
  {
    slug: "foureye-butterflyfish",
    name: "Foureye butterflyfish",
    scientificName: "Chaetodon capistratus",
    kind: "Reef fish",
    description:
      "A pale disc with one big false eyespot near the tail, to send a predator the wrong way.",
    preparationTip: "Approach from the side; head-on they turn and show you the fake eye.",
  },
  {
    slug: "french-angelfish",
    name: "French angelfish",
    scientificName: "Pomacanthus paru",
    kind: "Reef fish",
    description: "A tall, dark disc scaled in tiny yellow crescents, usually in pairs.",
    preparationTip:
      "Stay still for a moment beside a sponge and the pair often comes to look at you.",
  },
  {
    slug: "french-grunt",
    name: "French grunt",
    scientificName: "Haemulon flavolineatum",
    kind: "Schooling fish",
    description: "Yellow-striped fish stacked in the hundreds around coral heads.",
    preparationTip: "Move slowly into the school and it will part and reform around you.",
  },
  {
    slug: "gray-angelfish",
    name: "Gray angelfish",
    scientificName: "Pomacanthus arcuatus",
    kind: "Reef fish",
    description: "The French angelfish's larger, plainer cousin, with a pale square-cut tail.",
    preparationTip:
      "Tell it from a French angelfish by the tail — square and light, not round and dark.",
  },
  {
    slug: "honeycomb-cowfish",
    name: "Honeycomb cowfish",
    scientificName: "Acanthostracion polygonius",
    kind: "Reef fish",
    description: "A boxy fish tiled in hexagons, with two small horns over the eyes.",
    preparationTip: "Look low over the sand between coral heads; it hovers rather than swims.",
  },
  {
    slug: "porkfish",
    name: "Porkfish",
    scientificName: "Anisotremus virginicus",
    kind: "Schooling fish",
    description: "Two black head bars and a yellow body — the tidiest fish on the reef.",
    preparationTip: "Check the up-current side of a coral head, where they hold station together.",
  },
  {
    slug: "queen-angelfish",
    name: "Queen angelfish",
    scientificName: "Holacanthus ciliaris",
    kind: "Reef fish",
    description: "Blue and gold with a ringed crown on the forehead and long trailing fins.",
    preparationTip: "Quiet breathing helps: it keeps a coral head between you and it if you rush.",
  },
  {
    slug: "queen-parrotfish",
    name: "Queen parrotfish",
    scientificName: "Scarus vetula",
    kind: "Reef fish",
    description: "Blue-green with bright bands running from the beak, grazing along the coral.",
    preparationTip: "Follow the crunching sound; you will hear it working before you see it.",
  },
  {
    slug: "rock-beauty",
    name: "Rock beauty",
    scientificName: "Holacanthus tricolor",
    kind: "Reef fish",
    description: "Yellow at both ends with a black saddle in the middle, never far from a hole.",
    preparationTip:
      "Watch one gap in the reef rather than sweeping — it comes back out to the same spot.",
  },
  {
    slug: "sergeant-major",
    name: "Sergeant major",
    scientificName: "Abudefduf saxatilis",
    kind: "Reef fish",
    description: "Small, striped and everywhere, guarding purple egg patches on hard surfaces.",
    preparationTip: "A guarding male will bump your mask — back off rather than push in.",
  },
  {
    slug: "spotfin-butterflyfish",
    name: "Spotfin butterflyfish",
    scientificName: "Chaetodon ocellatus",
    kind: "Reef fish",
    description: "White with a yellow trailing edge and a dark bar through the eye.",
    preparationTip: "Look along the reef's sandy edge at dusk, when pairs come out to feed.",
  },
  {
    slug: "spotted-drum",
    name: "Spotted drum",
    scientificName: "Equetus punctatus",
    kind: "Reef fish",
    description:
      "Black-and-white, with an absurdly long first fin the juveniles wave like a ribbon.",
    preparationTip:
      "Check the shaded floor of a swim-through; it circles the same small patch all day.",
  },
  {
    slug: "stoplight-parrotfish",
    name: "Stoplight parrotfish",
    scientificName: "Sparisoma viride",
    kind: "Reef fish",
    description: "A heavy beaked grazer — green and gold as an adult, mottled red as a youngster.",
    preparationTip: "Move slowly near coral heads and let the colour find you.",
  },
  {
    slug: "trumpetfish",
    name: "Trumpetfish",
    scientificName: "Aulostomus maculatus",
    kind: "Reef fish",
    description: "A long tube of a fish that hangs head-down among sea rods, pretending to be one.",
    preparationTip: "Scan vertical shapes in a soft-coral stand — it is hiding in plain sight.",
  },
  {
    slug: "white-grunt",
    name: "White grunt",
    scientificName: "Haemulon plumierii",
    kind: "Schooling fish",
    description: "Pale blue and yellow head lines, with a flash of orange inside the mouth.",
    preparationTip:
      "They really do grunt — you can hear a school through the water on a quiet dive.",
  },
  {
    slug: "yellowhead-jawfish",
    name: "Yellowhead jawfish",
    scientificName: "Opistognathus aurifrons",
    kind: "Reef fish",
    description:
      "A pale fish hovering upright over its burrow, dropping in tail-first when startled.",
    preparationTip: "Settle on the sand at a distance and wait — it comes back up within a minute.",
  },

  // --- Bigger fish ---------------------------------------------------------
  {
    slug: "bar-jack",
    name: "Bar jack",
    scientificName: "Caranx ruber",
    kind: "Predator",
    description:
      "A silver jack with one electric-blue stripe down the back, often shadowing a ray.",
    preparationTip:
      "When you find a stingray feeding, look just above it — a jack is usually riding along.",
  },
  {
    slug: "black-grouper",
    name: "Black grouper",
    scientificName: "Mycteroperca bonaci",
    kind: "Predator",
    description: "A big, dark, rectangular grouper that holds station off the reef edge.",
    preparationTip: "Keep your distance and it stays; swim straight at it and the dive is over.",
  },
  {
    slug: "cobia",
    name: "Cobia",
    scientificName: "Rachycentron canadum",
    kind: "Predator",
    description: "A dark torpedo often mistaken for a shark, cruising past wrecks in open water.",
    preparationTip: "Look into the blue away from the structure, not only along it.",
  },
  {
    slug: "goliath-grouper",
    name: "Goliath grouper",
    scientificName: "Epinephelus itajara",
    kind: "Predator",
    description: "Enormous and unbothered — usually parked under a ledge or in a wreck's shadow.",
    preparationTip: "Give it room and never block its way out from under an overhang.",
  },
  {
    slug: "gray-snapper",
    name: "Gray snapper",
    scientificName: "Lutjanus griseus",
    kind: "Schooling fish",
    description: "Wary grey-red snapper that hang in the lee of wrecks and mangrove roots.",
    preparationTip:
      "They watch you first — approach at an angle rather than head-on and they hold.",
  },
  {
    slug: "great-barracuda",
    name: "Great barracuda",
    scientificName: "Sphyraena barracuda",
    kind: "Predator",
    description: "A long silver bar with an underslung jaw, hanging motionless in the current.",
    preparationTip:
      "It is curious, not interested in you — leave shiny gear tucked away and carry on.",
  },
  {
    slug: "horse-eye-jack",
    name: "Horse-eye jack",
    scientificName: "Caranx latus",
    kind: "Schooling fish",
    description: "Big-eyed silver jacks that roll past in tight, fast schools.",
    preparationTip:
      "Watch the blue over the wreck for a wall of them rather than scanning the deck.",
  },
  {
    slug: "hogfish",
    name: "Hogfish",
    scientificName: "Lachnolaimus maximus",
    kind: "Reef fish",
    description: "A long-snouted wrasse that roots through sand and rubble for shellfish.",
    preparationTip: "Follow the puffs of sand — it makes the mess before you spot the fish.",
  },
  {
    slug: "nassau-grouper",
    name: "Nassau grouper",
    scientificName: "Epinephelus striatus",
    kind: "Predator",
    description: "Banded brown and cream with a dark saddle at the tail, and famously curious.",
    preparationTip: "Protected and slow to recover — look, photograph, and leave it where it is.",
  },
  {
    slug: "permit-fish",
    name: "Permit",
    scientificName: "Trachinotus falcatus",
    kind: "Predator",
    description: "A tall, mirror-flat silver disc that appears over wrecks and vanishes as fast.",
    preparationTip:
      "Keep the camera ready on the descent — permit meet you on the way down, not at depth.",
  },
  {
    slug: "red-grouper",
    name: "Red grouper",
    scientificName: "Epinephelus morio",
    kind: "Predator",
    description:
      "Rust-coloured, square-jawed, and dug into its own excavated hollow in the bottom.",
    preparationTip:
      "Look for a scooped pit in the sand or rubble — the fish is usually sitting in it.",
  },
  {
    slug: "remora",
    name: "Remora",
    scientificName: "Echeneis naucrates",
    kind: "Reef fish",
    description: "A striped rider that detaches from its host and circles whatever comes past.",
    preparationTip: "If one takes an interest in you, just keep swimming — it loses interest.",
  },
  {
    slug: "schoolmaster-snapper",
    name: "Schoolmaster snapper",
    scientificName: "Lutjanus apodus",
    kind: "Schooling fish",
    description: "Yellow-finned snapper that hover in the shade of coral heads and wreck plates.",
    preparationTip:
      "Look into the structure rather than over it; they hold just inside the shadow line.",
  },
  {
    slug: "tarpon",
    name: "Tarpon",
    scientificName: "Megalops atlanticus",
    kind: "Predator",
    description: "A slab of living chrome, up to two metres, hanging in a wreck's lee.",
    preparationTip: "Cut your light on a night dive and let them work the edge of everyone else's.",
  },
  {
    slug: "yellowtail-snapper",
    name: "Yellowtail snapper",
    scientificName: "Ocyurus chrysurus",
    kind: "Schooling fish",
    description: "Silver schools ruled by one bright yellow stripe running out into the tail.",
    preparationTip: "Look into the blue beyond the reef instead of only looking down.",
  },

  // --- Sharks and rays -----------------------------------------------------
  {
    slug: "caribbean-reef-shark",
    name: "Caribbean reef shark",
    scientificName: "Carcharhinus perezi",
    kind: "Shark",
    description: "A classic grey requiem shark that patrols the reef edge in open water.",
    preparationTip:
      "Stay off the bottom, keep the group together, and watch it rather than follow it.",
  },
  {
    slug: "lemon-shark",
    name: "Lemon shark",
    scientificName: "Negaprion brevirostris",
    kind: "Shark",
    description: "Yellow-brown, blunt-nosed, with two dorsal fins nearly the same size.",
    preparationTip: "Common over sand flats and in shallow channels — look away from the coral.",
  },
  {
    slug: "nurse-shark",
    name: "Nurse shark",
    scientificName: "Ginglymostoma cirratum",
    kind: "Shark",
    description: "A broad, mellow bottom-rester with rounded fins and two barbels at the snout.",
    preparationTip: "Check quiet ledges without crowding or blocking an animal's way out.",
  },
  {
    slug: "southern-stingray",
    name: "Southern stingray",
    scientificName: "Hypanus americanus",
    kind: "Ray",
    description: "A grey diamond gliding over the sand, or buried with only its eyes showing.",
    preparationTip: "Give rays space and watch from the side, not from above.",
  },
  {
    slug: "spotted-eagle-ray",
    name: "Spotted eagle ray",
    scientificName: "Aetobatus narinari",
    kind: "Ray",
    description:
      "Black wings freckled with white, flying past in open water with a whip of a tail.",
    preparationTip:
      "Look out into the blue at the start of the dive — they pass through, they don't stay.",
  },
  {
    slug: "yellow-stingray",
    name: "Yellow stingray",
    scientificName: "Urobatis jamaicensis",
    kind: "Ray",
    description: "A small, round, mottled ray that lies still in the sand between coral heads.",
    preparationTip:
      "Shuffle rather than kick down onto sand — this is the one most divers land on.",
  },

  // --- Eels and ambush hunters --------------------------------------------
  {
    slug: "goldentail-moray",
    name: "Goldentail moray",
    scientificName: "Gymnothorax miliaris",
    kind: "Eel",
    description: "Dark brown flecked with gold, small enough to live in a fist-sized hole.",
    preparationTip: "Scan holes at chest height on the reef face, not just at the base.",
  },
  {
    slug: "green-moray",
    name: "Green moray",
    scientificName: "Gymnothorax funebris",
    kind: "Eel",
    description: "A heavy olive eel that fills a crevice and breathes with its mouth open.",
    preparationTip:
      "The open mouth is breathing, not a threat — keep hands away and it stays calm.",
  },
  {
    slug: "spotted-moray",
    name: "Spotted moray",
    scientificName: "Gymnothorax moringa",
    kind: "Eel",
    description: "White peppered with dark spots, usually one head poking from the rubble.",
    preparationTip: "Look into rubble and wreck gaps rather than the open reef face.",
  },
  {
    slug: "peacock-flounder",
    name: "Peacock flounder",
    scientificName: "Bothus lunatus",
    kind: "Camouflage",
    description: "A flat sand-coloured disc with blue rings, both eyes on one side.",
    preparationTip: "It only becomes visible when it moves — sweep the sand, don't stare at it.",
  },
  {
    slug: "sand-diver",
    name: "Sand diver",
    scientificName: "Synodus intermedius",
    kind: "Camouflage",
    description: "A propped-up lizardfish that sits on the sand until something small swims by.",
    preparationTip: "Look for a stick shape with eyes at the edge of a sand channel.",
  },
  {
    slug: "spotted-scorpionfish",
    name: "Spotted scorpionfish",
    scientificName: "Scorpaena plumieri",
    kind: "Camouflage",
    description: "Invisible until it moves — a lump of reef with venomous spines along its back.",
    preparationTip:
      "This is why you never put a hand down to steady yourself. Look before you touch.",
  },
  {
    slug: "lionfish",
    name: "Lionfish",
    scientificName: "Pterois volitans",
    kind: "Invasive",
    description: "Striped fans of venomous spines — beautiful, and not from this ocean.",
    preparationTip:
      "Invasive here. Admire it, keep well clear of the spines, and report it to the crew.",
  },

  // --- Reef oddities -------------------------------------------------------
  {
    slug: "blackbar-soldierfish",
    name: "Blackbar soldierfish",
    scientificName: "Myripristis jacobus",
    kind: "Reef fish",
    description: "Red, big-eyed and nocturnal, hanging upside-down inside caves by day.",
    preparationTip: "Bring a light into an overhang and look at the ceiling, not the floor.",
  },
  {
    slug: "glassy-sweeper",
    name: "Glassy sweeper",
    scientificName: "Pempheris schomburgkii",
    kind: "Schooling fish",
    description: "Copper-coloured clouds that fill the shaded spaces inside a wreck or ledge.",
    preparationTip: "Stay outside the structure and let the school reform around you.",
  },
  {
    slug: "porcupinefish",
    name: "Porcupinefish",
    scientificName: "Diodon hystrix",
    kind: "Reef fish",
    description: "A big-eyed spiny balloon that wedges itself under a ledge to sleep.",
    preparationTip: "Never provoke one into inflating — it is a stress response, not a trick.",
  },
  {
    slug: "queen-triggerfish",
    name: "Queen triggerfish",
    scientificName: "Balistes vetula",
    kind: "Reef fish",
    description:
      "Blue-lined and gaudy, swimming with a rippling pair of fins rather than its tail.",
    preparationTip: "Nesting fish defend a cone of water above the nest — go around, not over.",
  },
  {
    slug: "scrawled-filefish",
    name: "Scrawled filefish",
    scientificName: "Aluterus scriptus",
    kind: "Reef fish",
    description: "Olive with blue scribbles, drifting nose-down like a leaf in the current.",
    preparationTip:
      "It hides by going vertical — check anything that looks like a piece of debris.",
  },
  {
    slug: "smooth-trunkfish",
    name: "Smooth trunkfish",
    scientificName: "Lactophrys triqueter",
    kind: "Reef fish",
    description: "A hovering box with pursed lips that blows sand away to find its food.",
    preparationTip: "Watch it puff at the sand — the whole feeding trick happens in a few seconds.",
  },
  {
    slug: "spanish-hogfish",
    name: "Spanish hogfish",
    scientificName: "Bodianus rufus",
    kind: "Reef fish",
    description: "Purple over gold; the young ones run cleaning stations for bigger fish.",
    preparationTip: "Find a juvenile at work and you have found the reef's cleaning station.",
  },
  {
    slug: "squirrelfish",
    name: "Squirrelfish",
    scientificName: "Holocentrus adscensionis",
    kind: "Reef fish",
    description: "Red and silver with huge night-adapted eyes, tucked into a hole by day.",
    preparationTip:
      "Red goes grey at depth without a light — hold a torch on it to see the colour.",
  },

  // --- Turtles and mammals -------------------------------------------------
  {
    slug: "bottlenose-dolphin",
    name: "Bottlenose dolphin",
    scientificName: "Tursiops truncatus",
    kind: "Marine mammal",
    description: "Usually a surface encounter from the boat, occasionally a pass underwater.",
    preparationTip: "Never chase. Stay where you are, and they decide whether it's a meeting.",
  },
  {
    slug: "green-sea-turtle",
    name: "Green sea turtle",
    scientificName: "Chelonia mydas",
    kind: "Turtle",
    description: "A smooth-shelled grazer, usually head-down in seagrass or asleep under a ledge.",
    preparationTip:
      "Stay off its path to the surface — it has to breathe, and it will not go around you.",
  },
  {
    slug: "hawksbill-turtle",
    name: "Hawksbill turtle",
    scientificName: "Eretmochelys imbricata",
    kind: "Turtle",
    description: "A narrow beak and a serrated shell edge, picking sponges off the reef face.",
    preparationTip: "The beak is the tell: pointed and hooked, where a green turtle's is blunt.",
  },
  {
    slug: "loggerhead-turtle",
    name: "Loggerhead turtle",
    scientificName: "Caretta caretta",
    kind: "Turtle",
    description: "A heavy reddish head built for crushing conch and lobster.",
    preparationTip: "Give a feeding loggerhead a wide berth — that jaw is doing serious work.",
  },
  {
    slug: "manatee",
    name: "West Indian manatee",
    scientificName: "Trichechus manatus",
    kind: "Marine mammal",
    description: "A grey, slow, whiskered grazer of warm springs and inshore channels.",
    preparationTip:
      "Protected: passive observation only. Hands off, no pursuit, no blocking its route.",
  },

  // --- Invertebrates -------------------------------------------------------
  {
    slug: "arrow-crab",
    name: "Yellowline arrow crab",
    scientificName: "Stenorhynchus seticornis",
    kind: "Crustacean",
    description: "A spider of a crab, all legs and a needle nose, walking the reef at night.",
    preparationTip: "Sweep a light slowly across a sponge face; the legs catch the beam first.",
  },
  {
    slug: "banded-coral-shrimp",
    name: "Banded coral shrimp",
    scientificName: "Stenopus hispidus",
    kind: "Crustacean",
    description: "Red-and-white candy stripes with white antennae twice its own length.",
    preparationTip: "The waving antennae are the advertisement — look for those, not the body.",
  },
  {
    slug: "caribbean-reef-octopus",
    name: "Caribbean reef octopus",
    scientificName: "Octopus briareus",
    kind: "Mollusc",
    description: "Blue-green and shape-shifting, out hunting across the reef after dark.",
    preparationTip: "A night dive doubles your odds. Keep the light off its eyes and it stays out.",
  },
  {
    slug: "caribbean-reef-squid",
    name: "Caribbean reef squid",
    scientificName: "Sepioteuthis sepioidea",
    kind: "Mollusc",
    description: "A small squadron holding formation in mid-water, colours running across them.",
    preparationTip:
      "Approach slowly and they hold. They are talking to each other in those colours.",
  },
  {
    slug: "channel-clinging-crab",
    name: "Channel clinging crab",
    scientificName: "Mithrax spinosissimus",
    kind: "Crustacean",
    description: "A dinner-plate crab wedged into a crevice, out only when the lights go down.",
    preparationTip: "Check the deep cracks in a wall — you see the claws before the animal.",
  },
  {
    slug: "christmas-tree-worm",
    name: "Christmas tree worm",
    scientificName: "Spirobranchus giganteus",
    kind: "Reef invertebrate",
    description: "Pairs of tiny coloured spirals growing straight out of hard coral.",
    preparationTip: "Wave a hand near one and every worm on the head vanishes at once. Then wait.",
  },
  {
    slug: "cushion-sea-star",
    name: "Cushion sea star",
    scientificName: "Oreaster reticulatus",
    kind: "Reef invertebrate",
    description: "A fat orange star the size of a dinner plate, out on open sand and seagrass.",
    preparationTip: "Leave it in the water. Lifting one for a photo is what kills them.",
  },
  {
    slug: "feather-duster-worm",
    name: "Magnificent feather duster",
    scientificName: "Sabellastarte magnifica",
    kind: "Reef invertebrate",
    description: "A soft banded fan on a tube, retracting the instant a shadow crosses it.",
    preparationTip: "Approach from downstream and stay out of its light; it feels you coming.",
  },
  {
    slug: "flamingo-tongue",
    name: "Flamingo tongue",
    scientificName: "Cyphoma gibbosum",
    kind: "Mollusc",
    description: "A thumbnail snail wrapped in orange leopard print, grazing on sea fans.",
    preparationTip:
      "Search the sea fans, not the coral. The pattern is living tissue, not the shell.",
  },
  {
    slug: "giant-anemone",
    name: "Giant Caribbean anemone",
    scientificName: "Condylactis gigantea",
    kind: "Reef invertebrate",
    description: "A bouquet of purple- or pink-tipped tentacles, often with a shrimp living in it.",
    preparationTip: "Look inside before you move on — the cleaner shrimp are the real find.",
  },
  {
    slug: "long-spined-urchin",
    name: "Long-spined sea urchin",
    scientificName: "Diadema antillarum",
    kind: "Reef invertebrate",
    description: "A black pincushion with spines as long as your hand; the reef's best grazer.",
    preparationTip: "Mind your knees and fins in a swim-through. The spines break off in you.",
  },
  {
    slug: "moon-jelly",
    name: "Moon jelly",
    scientificName: "Aurelia aurita",
    kind: "Drifter",
    description: "A translucent saucer with four horseshoe rings, pulsing through open water.",
    preparationTip:
      "Mild sting at worst, but a hood and gloves make a swarm a pleasure instead of a chore.",
  },
  {
    slug: "pederson-cleaner-shrimp",
    name: "Pederson cleaner shrimp",
    scientificName: "Ancylomenes pedersoni",
    kind: "Crustacean",
    description: "A glass shrimp with violet spots, waving from inside an anemone.",
    preparationTip: "Hold a bare hand still near the anemone and it may well come and clean it.",
  },
  {
    slug: "queen-conch",
    name: "Queen conch",
    scientificName: "Lobatus gigas",
    kind: "Mollusc",
    description: "A heavy flared shell on seagrass sand, dragging itself along on one foot.",
    preparationTip:
      "Protected in Florida. Look for the two stalked eyes, and put nothing in your pocket.",
  },
  {
    slug: "spiny-lobster",
    name: "Caribbean spiny lobster",
    scientificName: "Panulirus argus",
    kind: "Crustacean",
    description: "No claws, but two long whips of antennae sticking out from under a ledge.",
    preparationTip: "The antennae give it away long before the body does. Check every dark gap.",
  },
  {
    slug: "upside-down-jellyfish",
    name: "Upside-down jellyfish",
    scientificName: "Cassiopea xamachana",
    kind: "Drifter",
    description:
      "A jellyfish lying bell-down on the bottom, farming sunlight with its tentacles up.",
    preparationTip: "Common in shallow, sheltered bays — don't kneel on one; they do sting.",
  },

  // --- Corals, sponges and the reef itself ---------------------------------
  {
    slug: "azure-vase-sponge",
    name: "Azure vase sponge",
    scientificName: "Callyspongia plicifera",
    kind: "Sponge",
    description: "A fluted violet-pink cup that almost glows against the reef face.",
    preparationTip: "Get low and shoot up into the cup — the colour only reads with light in it.",
  },
  {
    slug: "common-sea-fan",
    name: "Common sea fan",
    scientificName: "Gorgonia ventalina",
    kind: "Soft coral",
    description: "A purple lattice standing across the current like a window frame.",
    preparationTip: "They grow square to the prevailing current — a useful natural compass.",
  },
  {
    slug: "elkhorn-coral",
    name: "Elkhorn coral",
    scientificName: "Acropora palmata",
    kind: "Hard coral",
    description: "Broad antler branches in the shallows, the classic Caribbean reef silhouette.",
    preparationTip: "This is the shallowest part of most dives — watch your fins above it.",
  },
  {
    slug: "fire-coral",
    name: "Branching fire coral",
    scientificName: "Millepora alcicornis",
    kind: "Hard coral",
    description: "Mustard-tan blades with pale tips, growing over anything that stops moving.",
    preparationTip: "Not a coral and it does sting. Learn the mustard colour and keep clear.",
  },
  {
    slug: "giant-barrel-sponge",
    name: "Giant barrel sponge",
    scientificName: "Xestospongia muta",
    kind: "Sponge",
    description: "A rust-coloured barrel wide enough to climb into, and centuries old.",
    preparationTip:
      "Never rest a hand on the rim. Some of these were here before Florida was a state.",
  },
  {
    slug: "great-star-coral",
    name: "Great star coral",
    scientificName: "Montastraea cavernosa",
    kind: "Hard coral",
    description: "Boulders studded with fat, evenly spaced cups that open and feed at night.",
    preparationTip: "Come back with a light after dark — the whole boulder is in bloom.",
  },
  {
    slug: "grooved-brain-coral",
    name: "Grooved brain coral",
    scientificName: "Diploria labyrinthiformis",
    kind: "Hard coral",
    description: "A rounded head patterned with maze-like ridges and deep valleys.",
    preparationTip: "Notice the pattern while keeping fins and hands safely clear.",
  },
  {
    slug: "pillar-coral",
    name: "Pillar coral",
    scientificName: "Dendrogyra cylindrus",
    kind: "Hard coral",
    description: "Furry-looking spires standing upright off the bottom; rare and getting rarer.",
    preparationTip: "The fuzz is polyps out feeding by day — one of the few corals that does.",
  },
  {
    slug: "red-rope-sponge",
    name: "Erect rope sponge",
    scientificName: "Amphimedon compressa",
    kind: "Sponge",
    description: "Deep red cords standing off the reef, stiff and slightly branched.",
    preparationTip: "The red survives deeper than most colours — a useful marker on a wall.",
  },
  {
    slug: "sea-plume",
    name: "Sea plume",
    scientificName: "Pseudopterogorgia species",
    kind: "Soft coral",
    description: "Feathery gorgonians that sway the whole reef in time with the swell.",
    preparationTip: "Watch them to read the surge before you commit to a swim-through.",
  },
  {
    slug: "staghorn-coral",
    name: "Staghorn coral",
    scientificName: "Acropora cervicornis",
    kind: "Hard coral",
    description: "Dense thickets of finger-thick branches, and a nursery for everything small.",
    preparationTip: "Fragile and slow-growing. Keep your fins high; a kick takes years back.",
  },
  {
    slug: "symmetrical-brain-coral",
    name: "Symmetrical brain coral",
    scientificName: "Pseudodiploria strigosa",
    kind: "Hard coral",
    description: "Tighter, more even ridges than its grooved cousin, in flatter domes.",
    preparationTip: "The valleys hold tiny life — put a light in one instead of swimming past.",
  },
  {
    slug: "turtle-grass",
    name: "Turtle grass",
    scientificName: "Thalassia testudinum",
    kind: "Seagrass",
    description: "Ribbon meadows on the sand flats where the reef's next generation grows up.",
    preparationTip: "Hover, don't stand. Every fin-print in a seagrass bed lasts for months.",
  },
  {
    slug: "yellow-tube-sponge",
    name: "Yellow tube sponge",
    scientificName: "Aplysina fistularis",
    kind: "Sponge",
    description: "Clusters of yellow chimneys standing off the wall, each one an open pipe.",
    preparationTip:
      "A reliable colour marker in poor visibility — you can see the yellow from far off.",
  },
];

/** Every catalog entry, keyed by slug — the picker's own lookup. */
export const MARINE_LIFE_BY_SLUG = new Map(
  MARINE_LIFE_CATALOG.map((species) => [species.slug, species]),
);
