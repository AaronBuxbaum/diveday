import type { CourseContent } from "@/lib/courses";
import type { CertificationLevel } from "@/lib/readiness";

/**
 * DiveDay's published course pages: the words a shop starts from, not the words
 * it must keep. Every number here comes from the agency's own published
 * standards (minimum age, dive counts, depth limits) because a shop that edits
 * nothing must still be telling divers the truth. Everything else — the day
 * plan's hours, what the fee covers — is a plausible default a shop will
 * rewrite to match how it actually runs the course.
 *
 * Imported copies are independent (src/db/courses.ts); bumping a version here
 * never rewrites a shop's page, and never relaxes a cert gate under a course a
 * shop is already teaching.
 */
export type CourseTemplate = {
  slug: string;
  version: number;
  title: string;
  agency: "padi" | "ssi";
  description: string;
  minimumCertificationLevel: CertificationLevel | null;
  content: CourseContent;
};

/** Bundled Wikimedia Commons imagery; see public/dive-sites/README.md for credits. */
function bundledImage(filename: string): string {
  return `/dive-sites/${encodeURIComponent(filename)}`;
}

const blank: CourseContent = {
  summary: null,
  overview: null,
  heroImageUrl: null,
  imageUrls: [],
  durationText: null,
  groupSizeText: null,
  minimumAge: null,
  prerequisiteNote: null,
  includes: [],
  excludes: [],
  scheduleDays: [],
  faqs: [],
};

export const COURSE_TEMPLATES: CourseTemplate[] = [
  {
    slug: "discover-scuba-diving",
    version: 1,
    title: "Discover Scuba Diving",
    agency: "padi",
    description: "A supervised first underwater experience with an instructor.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "Try scuba for the first time, with an instructor at your shoulder",
      overview:
        "Discover Scuba Diving is not a certification — it is the afternoon you find out whether breathing underwater is for you. An instructor covers the few things that matter, fits your gear, and stays with you the whole time.\n\nYou will start in shallow, confined water, practice clearing your mask and recovering your regulator, and then, if you are comfortable, make a shallow open-water dive. Nobody is graded, and nobody goes deeper than they want to.\n\nIf you love it, your instructor can credit the skills you learn here toward the Open Water Diver course.",
      heroImageUrl: bundledImage("Blue Tangs Molasses Reef 1999.jpg"),
      imageUrls: [
        bundledImage("French Angelfish Molasses Reef 20080309.jpg"),
        bundledImage("Stoplight parrotfish Pickles Reef.jpg"),
      ],
      durationText: "Half a day · about 3 hours",
      // Instructor ratios are an agency standard a shop must actually meet, and
      // they depend on whether a certified assistant is in the water. Stating a
      // number here would publish a compliance claim on the shop's behalf, so
      // the template says how we work and leaves the number to the shop.
      groupSizeText: "A small group, with your instructor beside you",
      minimumAge: 10,
      prerequisiteNote:
        "No certification and no experience needed. You will complete a short medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "Instructor-led briefing and skills session",
        "Complete rental gear",
        "One shallow open-water dive",
      ],
      excludes: ["Photos and video", "Marine park fees where they apply"],
      scheduleDays: [
        {
          title: "Your afternoon",
          timeRange: "about 3 hours",
          items: [
            "Briefing: how the gear works and how to breathe on it",
            "Confined water: mask clearing, regulator recovery, moving around",
            "One shallow open-water dive, maximum 12 meters, with your instructor",
            "Debrief, and what Open Water would look like next",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need to know how to swim?",
          answer:
            "You need to be comfortable in the water. There is no swim test for Discover Scuba Diving, but the full Open Water course does have one.",
        },
        {
          question: "How deep will I go?",
          answer:
            "No deeper than 12 meters, and only as deep as you are happy with. Most first dives stay much shallower.",
        },
        {
          question: "Am I certified afterwards?",
          answer:
            "No — this is an experience program, not a certification. If you go on to the Open Water Diver course, your instructor can credit these skills toward it; ask us how that works for your dates.",
        },
        {
          question: "What if I panic underwater?",
          answer:
            "Your instructor is within arm's reach for the whole dive. Ending the dive early is always fine and happens often.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 12 hours after a single dive before flying — that is a minimum, not a guarantee, so leave more room if you can. If you are on a cruise or catching a flight the next morning, tell us when you book.",
        },
      ],
    },
  },
  {
    slug: "open-water-diver",
    version: 1,
    title: "Open Water Diver",
    agency: "padi",
    description: "The foundational certification course for new divers.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "How to become a certified PADI Open Water Diver",
      overview:
        "The Open Water Diver certification is the one that opens the door: qualified to dive to 18 meters with a buddy, anywhere in the world, without an instructor — in conditions as good as or better than those you trained in.\n\nThe course is three parts. Knowledge development covers pressure, air, and planning — most students do this online before arriving. Confined water is where the skills become muscle memory, in shallow water with somewhere to stand. Four open-water dives put it together on the reef.\n\nNo prior experience is required. You do need to be comfortable in water: the course includes a 200-meter swim (or 300 with mask, fins, and snorkel) and a 10-minute float, neither of them timed.",
      heroImageUrl: bundledImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
      imageUrls: [
        bundledImage("Blue Tang Pickles 20080310.jpg"),
        bundledImage("Brain coral 2 Molasses Reef 20080309.jpg"),
        bundledImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
      ],
      durationText: "3 days · 8:00am–5:00pm",
      groupSizeText: "Maximum 8 students per instructor",
      minimumAge: 10,
      prerequisiteNote:
        "No certification required. Divers aged 10–11 certify as Junior Open Water Divers, dive to a maximum of 12 meters, and must dive with a PADI Professional or a certified parent or guardian; divers aged 12–14 dive to 18 meters with any certified adult. Those restrictions lift at 15. Every student completes a medical questionnaire first; some answers need a physician's sign-off before getting in the water.",
      includes: [
        "All PADI learning materials and certification fees",
        "Complete rental gear for the whole course",
        "Four open-water training dives",
        "Light lunch on full days",
      ],
      excludes: ["Marine park fees", "Hotel transfers", "Underwater photos"],
      scheduleDays: [
        {
          title: "Day 1 — classroom and confined water",
          timeRange: "8:00am–5:00pm",
          items: [
            "Paperwork, medical questionnaire, and gear fitting",
            "Knowledge reviews 1–2, with quizzes",
            "Swim and float assessment (not timed)",
            "Confined water dives 1–2: assembly, mask clearing, regulator recovery, buoyancy",
          ],
        },
        {
          title: "Day 2 — confined water and first open water",
          timeRange: "8:00am–5:00pm",
          items: [
            "Knowledge reviews 3–4, with quizzes",
            "Confined water dives 3–5, including out-of-air skills and mask removal",
            "Open water dives 1–2 on a shallow reef",
          ],
        },
        {
          title: "Day 3 — open water and exam",
          timeRange: "8:00am–4:00pm",
          items: [
            "Knowledge review 5 and the final exam",
            "Open water dives 3–4, to a maximum of 18 meters",
            "Navigation, buoyancy control, and a debrief",
            "Certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep can I dive once I am certified?",
          answer:
            "18 meters (60 feet) as an Open Water Diver, in conditions as good as or better than those you trained in. Advanced Open Water Diver extends that to 30 meters.",
        },
        {
          question: "Do I need to be a strong swimmer?",
          answer:
            "You need basic watermanship: a 200-meter swim or a 300-meter snorkel, plus a 10-minute float or tread. Neither is timed, and any stroke counts.",
        },
        {
          question: "Is equipment included?",
          answer:
            "Yes — mask, fins, wetsuit, BCD, regulator, computer, tanks, and weights are all provided for the course.",
        },
        {
          question: "What is the minimum age?",
          answer:
            "10 years old. Divers aged 10–11 certify as Junior Open Water Divers, dive to 12 meters, and must be accompanied by a PADI Professional or a certified parent or guardian. Divers aged 12–14 dive to 18 meters with any certified adult. Both restrictions lift at 15.",
        },
        {
          question: "Can I do the theory before I arrive?",
          answer:
            "Yes, and most students do. PADI eLearning is a separate fee, billed as its own line, and finishing it beforehand frees your days for diving.",
        },
        {
          question: "What if I do not finish in three days?",
          answer:
            "The course is performance-based, not clock-based: you certify when you can do the skills. If you need another session we will schedule one.",
        },
        {
          question: "Does the certification expire?",
          answer:
            "No. If it has been a while since your last dive, a PADI ReActivate refresher is a good idea before diving again.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 18 hours after multiple dives before flying. That is a minimum, not a guarantee — plan your last dive day with room to spare.",
        },
      ],
    },
  },
  {
    slug: "advanced-open-water-diver",
    version: 1,
    title: "Advanced Open Water Diver",
    agency: "padi",
    description: "Build confidence and range with five adventure dives.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Five dives that take you deeper, further, and more confidently",
      overview:
        "Advanced Open Water Diver is not a repeat of Open Water with harder skills — it is five dives, each a first taste of a different specialty, done under instructor supervision.\n\nTwo are required: a deep dive, which extends your limit to 30 meters (21 meters for divers aged 12–14), and an underwater navigation dive. You choose the other three from what the site and the season offer — night, wreck, drift, buoyancy, naturalist, and others.\n\nThere is no final exam. There is a short knowledge review before each dive, and the dives themselves count as training dives.",
      heroImageUrl: bundledImage("FGBNMS - nurse shark (27551309652).jpg"),
      imageUrls: [
        bundledImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
        bundledImage("Grouper 2 Molasses Reef 1999.jpg"),
      ],
      durationText: "2 days · 5 dives",
      groupSizeText: "Maximum 8 students per instructor",
      minimumAge: 12,
      prerequisiteNote:
        "PADI Open Water Diver (or a qualifying certification from another agency) — we verify the card before the first dive. Divers aged 12–14 certify as Junior Advanced Open Water Divers and are limited to 21 meters, including on the deep dive; the full 30 meters comes at 15.",
      includes: [
        "All PADI learning materials and certification fees",
        "Five supervised adventure dives",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "Marine park fees", "Specialty gear for optional dives"],
      scheduleDays: [
        {
          title: "Day 1 — deep and navigation",
          timeRange: "8:00am–3:00pm",
          items: [
            "Knowledge reviews for the day's dives",
            "Deep adventure dive — maximum 30 meters, or 21 meters for divers aged 12–14",
            "Underwater navigation dive: natural references and compass",
          ],
        },
        {
          title: "Day 2 — three you choose",
          timeRange: "8:00am–3:00pm",
          items: [
            "Two morning adventure dives from the available options",
            "One afternoon or night dive, depending on your choice",
            "Logbook signing and certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need to be an experienced diver first?",
          answer:
            "No. You can take Advanced Open Water Diver straight after Open Water — the course is designed to build the experience, supervised.",
        },
        {
          question: "How deep will the deep dive go?",
          answer:
            "To a maximum of 30 meters — 21 meters if you are 12–14 — and only after your instructor has briefed gas planning, narcosis, and the ascent plan.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 18 hours after multiple dives before flying. That is a minimum, not a guarantee; the deep dive in particular is a reason to leave extra room.",
        },
        {
          question: "Which adventure dives can I choose?",
          answer:
            "It depends on the site and conditions. Ask us what is running the week you are here — night, wreck, drift, peak performance buoyancy, and naturalist are the usual options.",
        },
        {
          question: "Do any of these count toward a specialty certification?",
          answer:
            "Yes. Each adventure dive credits as the first dive of the matching specialty course if you go on to complete it.",
        },
      ],
    },
  },
  {
    slug: "rescue-diver",
    version: 1,
    title: "Rescue Diver",
    agency: "padi",
    description: "Problem prevention and rescue skills for experienced divers.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "Learn to spot trouble early — and to handle it when you cannot",
      overview:
        "Most divers describe Rescue as the hardest course they have enjoyed. The focus shifts outward: from your own diving to the divers around you, and to the problems that are still small enough to solve.\n\nYou will practice self-rescue, recognizing and managing stress in another diver, in-water rescue and tows, surfacing an unresponsive diver, and giving rescue breaths while bringing them in. The course finishes with two scenarios that put it together under pressure.\n\nEmergency First Response (CPR and first aid) training within the past 24 months is required. We run it alongside the course if you need it.",
      heroImageUrl: bundledImage("Dasyatis americana NOAA.jpg"),
      imageUrls: [bundledImage("Sponge 06 Molasses Reef 20230714.jpg")],
      durationText: "3 days",
      groupSizeText: "Maximum 8 students per instructor",
      minimumAge: 12,
      prerequisiteNote:
        // PADI's own floor is Adventure Diver with the Underwater Navigation
        // Adventure Dive; the app's certification ladder has no Adventure Diver
        // rung, so the gate above sits at Advanced Open Water. Say plainly that
        // this is where we set it, rather than describing it as the agency's —
        // a diver holding a valid Adventure Diver card deserves to know the
        // difference is ours (see ADR 20260720-course-page-media).
        "PADI Advanced Open Water Diver or higher — that is where we set this course, and it covers PADI's own requirement of Adventure Diver with the Underwater Navigation Adventure Dive. If you hold Adventure Diver with navigation, talk to us. You also need Emergency First Response primary and secondary care — or equivalent CPR and first aid training — completed within the past 24 months.",
      includes: [
        "All PADI learning materials and certification fees",
        "Rescue scenarios and skills sessions",
        "Tanks, weights, and boat",
      ],
      excludes: [
        "Emergency First Response course, if you need it",
        "Personal gear rental",
        "Marine park fees",
      ],
      scheduleDays: [
        {
          title: "Day 1 — knowledge and self-rescue",
          timeRange: "8:00am–4:00pm",
          items: [
            "Knowledge development and the rescue exam",
            "Self-rescue and cramp release",
            "Tired and panicked diver at the surface",
          ],
        },
        {
          title: "Day 2 — rescuing another diver",
          timeRange: "8:00am–4:00pm",
          items: [
            "Responsive and unresponsive diver underwater",
            "Surfacing an unresponsive diver and in-water rescue breathing",
            "Exits, oxygen, and handing over to emergency services",
          ],
        },
        {
          title: "Day 3 — scenarios",
          timeRange: "8:00am–2:00pm",
          items: [
            "Scenario 1: missing diver, search and recovery",
            "Scenario 2: unresponsive diver at the surface, full sequence",
            "Debrief and certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "Is Rescue Diver physically demanding?",
          answer:
            "It is the most demanding recreational course. Expect long surface work, towing, and repeated exits. You do not need to be an athlete, but you should be reasonably fit.",
        },
        {
          question: "Do I need CPR and first aid training?",
          answer:
            "Yes — primary and secondary care within the past 24 months. If yours has lapsed, we will run Emergency First Response alongside the course.",
        },
        {
          question: "Does this qualify me to work as a diver?",
          answer:
            "No. Rescue Diver is a recreational certification. Divemaster is the first professional rating, and Rescue is its prerequisite.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 18 hours after multiple dives before flying — a minimum, not a guarantee. Plan the last day of the course with room to spare.",
        },
      ],
    },
  },
  {
    slug: "scuba-refresher",
    version: 1,
    title: "Scuba Refresher",
    agency: "padi",
    description: "A half-day tune-up for certified divers who have been away.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Shake the rust off before your first dive back",
      overview:
        "If it has been a year or more since your last dive, the theory fades faster than the fun does. This is the PADI ReActivate program: a short knowledge review, then a confined-water session where you put the gear back on and find that your hands still know what to do.\n\nWe go over the skills that matter after a break — mask clearing, regulator recovery, weighting and buoyancy, sharing air, and how your computer works. Then you dive. Most divers feel normal again within the first ten minutes of the confined-water session.\n\nThis is not a new certification. It is a dated refresher noted on your card, and it is the honest thing to do before you get on a boat with strangers.",
      heroImageUrl: bundledImage("Blue Tang Pickles 20080310.jpg"),
      imageUrls: [bundledImage("Brain coral 2 Molasses Reef 20080309.jpg")],
      durationText: "Half a day · about 4 hours",
      groupSizeText: "A small group, with your instructor in the water with you",
      minimumAge: 10,
      // PADI's floor for ReActivate is (Junior) Scuba Diver; the app's ladder has
      // no Scuba Diver rung, so the gate above sits at Open Water. Say plainly
      // that this is our line, not the agency's — same precedent as Rescue,
      // Deep, and Wreck below.
      prerequisiteNote:
        "Open Water Diver or higher, from PADI or another agency — that is where we set this course. PADI's own floor is one rung lower (PADI Scuba Diver), which our system cannot record; if you hold Scuba Diver, talk to us before you book — the gate is ours, not the agency's. Send us a photo of your card or we can look it up. You will complete a medical questionnaire first; some answers require a physician's sign-off before you can dive.",
      includes: [
        "Knowledge review with an instructor",
        "Complete rental gear for the session",
        "Confined-water skills session",
      ],
      excludes: ["Open-water dives afterwards", "Marine park fees", "Photos and video"],
      scheduleDays: [
        {
          title: "Your morning",
          timeRange: "about 4 hours",
          items: [
            "Paperwork, medical questionnaire, and gear fitting",
            "Knowledge review: pressure, air planning, and dive computers",
            "Confined water: mask clearing, regulator recovery, air sharing, buoyancy",
            "Weight check, debrief, and a plan for your next dive",
          ],
        },
      ],
      faqs: [
        {
          question: "How long is too long between dives?",
          answer:
            "There is no rule. Six months away and most divers are fine; a year or more and a refresher is worth the morning. If you are unsure, you probably want one.",
        },
        {
          question: "Do I get a new certification?",
          answer:
            "No. Your original certification never expires. ReActivate adds a date to your card showing when you last refreshed, which some operators like to see.",
        },
        {
          question: "Can I do this the same day as a boat dive?",
          answer:
            "Often yes, if we run the session in the morning and you dive in the afternoon. Tell us when you book so we can line the days up.",
        },
        {
          question: "What if the skills do not come back?",
          answer:
            "Then we keep working, or we point you at the parts of the Open Water course worth repeating. Nobody is pushed onto a boat before they are ready.",
        },
      ],
    },
  },
  {
    slug: "enriched-air-nitrox-diver",
    version: 1,
    title: "Enriched Air (Nitrox) Diver",
    agency: "padi",
    description: "Learn to plan and dive with enriched air up to 40% oxygen.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "More bottom time on repetitive dives, and the planning that makes it safe",
      overview:
        "Enriched air is ordinary air with more oxygen and less nitrogen. Less nitrogen means slower nitrogen loading, which usually means longer no-decompression limits — the difference shows up most on the second and third dives of a day.\n\nThe trade is a new limit to respect. Oxygen becomes the thing you can get too much of, so every dive has a maximum operating depth set by the mix. The course teaches you to analyze your own cylinder, log the result, set your computer to the mix you actually have, and work out the depth you must not pass.\n\nThe certification covers recreational blends from 22% to 40% oxygen. There are no required training dives — this is a knowledge and practical-skills course — though we usually run two dives with it so you use the procedures for real.",
      heroImageUrl: bundledImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
      imageUrls: [bundledImage("Grouper 2 Molasses Reef 1999.jpg")],
      durationText: "1 day · knowledge and practical sessions",
      groupSizeText: "A small group, working through the analyzer and your own computer",
      minimumAge: 12,
      // The gate above matches PADI: Open Water Diver (or Junior Open Water
      // Diver) is the agency's own floor. The age is the tighter limit here —
      // a 10- or 11-year-old Junior Open Water Diver has to wait until 12.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 12 years old. Junior Open Water Divers aged 10–11 are old enough for the certification card but not for this course; the agency's minimum age is 12. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Analyzer use and cylinder-logging practice",
      ],
      excludes: [
        "The two optional dives — boat, tanks, and the enriched air in them are billed together if you add them",
        "Personal gear rental",
        "Enriched air fills after the course",
      ],
      scheduleDays: [
        {
          title: "Course day",
          timeRange: "8:00am–2:00pm",
          items: [
            "Knowledge development: oxygen exposure, nitrogen loading, and what changes",
            "Working out maximum operating depth from the mix, and the mix from the depth",
            "Practical: analyze two cylinders, log them, and set your computer to the blend",
            "Two optional dives on enriched air, using the procedures end to end",
          ],
        },
      ],
      faqs: [
        {
          question: "Does enriched air let me dive deeper?",
          answer:
            "No — the opposite. You have two limits now: the one your certification gives you, and a maximum operating depth set by your mix and an oxygen partial-pressure ceiling of 1.4 bar. Whichever is shallower is your limit for that dive. Enriched air buys bottom time, not depth.",
        },
        {
          question: "What blends does this certify me for?",
          answer:
            "Up to 40% oxygen. Anything richer than that is a technical diving course with different gear and different procedures.",
        },
        {
          question: "Are there required dives?",
          answer:
            "Not by the standard — you can certify from the knowledge development and practical application sessions alone. We usually add two dives anyway, because analyzing a cylinder on a moving boat is a different skill than doing it on a bench.",
        },
        {
          question: "Do I need my own computer?",
          answer:
            "No, but bring yours if you have one. Learning the menus on the computer you actually dive is most of the practical value.",
        },
        {
          question: "Will every dive be longer?",
          answer:
            "No. On a single shallow dive you will probably hit your air supply or the boat schedule long before the no-decompression limit. The gain shows up on repetitive dives in the 18–30 meter range.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 18 hours after multiple dives before flying. That is a minimum, not a guarantee — plan your last dive day with room to spare.",
        },
      ],
    },
  },
  {
    slug: "peak-performance-buoyancy",
    version: 1,
    title: "Peak Performance Buoyancy",
    agency: "padi",
    description: "Two dives spent fixing weighting, trim, and control.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Stop fighting the water and start hovering in it",
      overview:
        "Buoyancy is the skill that makes every other skill easier. Divers who hover use less air, silt less, damage nothing, and look calm because they are calm.\n\nThe course is two dives and the work between them. You start with a real weight check — most divers are carrying several kilos they do not need — then move the weight around until you are flat in the water instead of standing up in it. After that it is practice: hovering without using your hands, moving through tight spaces, ascending at a controlled rate without a line.\n\nIt is the least dramatic course we teach and the one that changes people's diving the most.",
      heroImageUrl: bundledImage("Brain coral 2 Molasses Reef 20080309.jpg"),
      imageUrls: [
        bundledImage("Sponge 06 Molasses Reef 20230714.jpg"),
        bundledImage("Stoplight parrotfish Pickles Reef.jpg"),
      ],
      durationText: "1 day · 2 dives",
      groupSizeText: "A small group, so your instructor can watch each diver hover",
      minimumAge: 10,
      // The gate above matches PADI: Open Water Diver (or Junior Open Water
      // Diver) is the agency's own floor, and the ages line up too.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency. Divers aged 10–11 take it as Junior Open Water Divers and keep their 12-meter depth limit and supervision requirements. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Two training dives",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "Marine park fees", "Underwater photos"],
      scheduleDays: [
        {
          title: "Course day",
          timeRange: "8:00am–2:00pm",
          items: [
            "Knowledge review: weighting, trim, and what actually moves you up and down",
            "Dive 1: proper weight check, weight distribution, and fin pivots",
            "Surface interval — adjust weight placement and gear position",
            "Dive 2: hovering without hands, swimming a buoyancy course, controlled ascent",
          ],
        },
      ],
      faqs: [
        {
          question: "I only have a few dives. Is it too early for this?",
          answer:
            "No. Early is the best time — you have fewer habits to unlearn. You can take it right after Open Water.",
        },
        {
          question: "Will I really use less air?",
          answer:
            "Usually, yes, though it is not guaranteed and nobody can promise a number. Most of the gain comes from not swimming against your own buoyancy the whole dive.",
        },
        {
          question: "Should I bring my own gear?",
          answer:
            "If you own a BCD, wetsuit, or fins, bring them. Weighting is specific to the gear you wear, so a weight check on rental kit tells you less about your own setup.",
        },
        {
          question: "Does this count toward Advanced Open Water?",
          answer:
            "Yes. The first dive credits as the Peak Performance Buoyancy Adventure Dive if you go on to the Advanced Open Water Diver course, and it works the other way too.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 18 hours after multiple dives before flying. That is a minimum, not a guarantee — plan your last dive day with room to spare.",
        },
      ],
    },
  },
  {
    slug: "night-diver",
    version: 1,
    title: "Night Diver",
    agency: "padi",
    description: "Three dives after dark, with lights, signals, and navigation.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "The same reef, a completely different animal",
      overview:
        "A reef you know well is a stranger after dark. Day fish sleep in the coral, hunters come out, and coral polyps open to feed. Your world shrinks to the beam of your light, which is exactly why it feels bigger.\n\nThe course is three dives. You learn light handling and light signals, how to stay with a buddy when you cannot see their face, how to navigate when the landmarks you use in daylight are invisible, and what to do if your primary light fails — which is why you carry a backup.\n\nThe first dive usually starts at dusk so you enter in fading light and watch the change happen. Later dives go in fully dark.",
      heroImageUrl: bundledImage("Dasyatis americana NOAA.jpg"),
      imageUrls: [
        bundledImage("Sponge 06 Molasses Reef 20230714.jpg"),
        bundledImage("French Angelfish Pickles Reef 20230713.jpg"),
      ],
      durationText: "2 evenings · 3 dives",
      groupSizeText: "A small group — smaller after dark than we run in daylight",
      minimumAge: 12,
      // The gate above matches PADI: Open Water Diver is the agency's own floor
      // for Night Diver. Age is the tighter limit — a Junior Open Water Diver
      // aged 10–11 has to wait until 12.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 12 years old. Divers aged 12–14 certify as Junior Night Divers and keep the supervision requirements that come with their certification. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Three night training dives",
        "Primary and backup dive lights",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "Marine park fees", "Dinner between dives"],
      scheduleDays: [
        {
          title: "Evening 1 — dusk and dark",
          timeRange: "4:00pm–9:30pm",
          items: [
            "Knowledge review: lights, signals, buddy contact, and lost-light procedure",
            "Gear and light check in daylight, before you need them",
            "Dive 1: entry at dusk, staying with your buddy as the light goes",
            "Dive 2: light signals and communication in full dark",
          ],
        },
        {
          title: "Evening 2 — navigation",
          timeRange: "5:00pm–9:00pm",
          items: [
            "Dive 3: night navigation with compass and natural references",
            "Finding the boat or exit point without a guide",
            "Debrief and certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "Is night diving dangerous?",
          answer:
            "It is different, not reckless. The added risks are losing your buddy, losing your light, and losing your bearings — the course is three dives spent making each of those a procedure rather than a surprise.",
        },
        {
          question: "How deep do night dives go?",
          answer:
            "Shallower than daytime dives — our night training dives stay well within 18 meters. Your certification limit still applies, and after dark there is nothing at depth you cannot see at 12 meters.",
        },
        {
          question: "Do I need to buy a light?",
          answer:
            "We provide a primary and a backup for the course. If you plan to keep night diving, buy your own — a light you know the switch on is worth more than a brighter one you do not.",
        },
        {
          question: "What if I do not like it?",
          answer:
            "Some divers do not, and that is a fine outcome. Tell your instructor and we end the dive; you are never talked into the water.",
        },
        {
          question: "Does this count toward Advanced Open Water?",
          answer:
            "Yes. The first dive credits as the Night Adventure Dive in the Advanced Open Water Diver course, in either direction.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 18 hours after multiple dives before flying. That is a minimum, not a guarantee — plan your last dive day with room to spare.",
        },
      ],
    },
  },
  {
    slug: "deep-diver",
    version: 1,
    title: "Deep Diver",
    agency: "padi",
    description: "Four dives that extend your limit to 40 meters, done properly.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "How to dive between 18 and 40 meters and come back with a plan intact",
      overview:
        "Deep diving is not about being brave. It is about how little margin you have: air goes faster, no-decompression limits shrink, narcosis is real, and the surface is further away when something goes wrong.\n\nThe course is four dives, the deepest to a maximum of 40 meters — the limit of recreational diving, and the deepest this certification will ever take you. You will plan gas and time before you get wet, practice using a safety cylinder on a line, and see for yourself what narcosis does to you by running a simple task at depth and again at the surface.\n\nColor disappears with depth too. Bring a light and watch what red does at 30 meters.",
      heroImageUrl: bundledImage("AtlanticGoliathGrouper.jpg"),
      imageUrls: [
        bundledImage("AtlanticGoliathGrouper.jpg"),
        bundledImage("Grouper 2 Molasses Reef 1999.jpg"),
      ],
      durationText: "2 days · 4 dives",
      groupSizeText: "A small group — deeper dives mean fewer divers per instructor",
      minimumAge: 15,
      prerequisiteNote:
        // PADI's own floor for Deep Diver is Adventure Diver; the app's
        // certification ladder has no Adventure Diver rung, so the gate above
        // sits at Advanced Open Water. Say plainly that this is our line and
        // not the agency's — a diver holding a valid Adventure Diver card
        // deserves to know the difference is ours.
        "PADI Advanced Open Water Diver or higher, and at least 15 years old. That is where we set this course; PADI's own requirement is Adventure Diver, which is a lower rung than our system can record. If you hold Adventure Diver, talk to us before you book — the gate is ours, not the agency's. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Four training dives, the last to a maximum of 40 meters",
        "Safety cylinder and line",
        "Tanks, weights, and boat",
      ],
      excludes: [
        "Enriched air fills",
        "Personal gear rental",
        "Marine park fees",
        "Dive computer rental",
      ],
      scheduleDays: [
        {
          title: "Day 1 — planning and the first two dives",
          timeRange: "8:00am–3:00pm",
          items: [
            "Knowledge development: gas planning, narcosis, decompression, and contingencies",
            "Dive 1: to 18–30 meters, with a narcosis comparison task",
            "Dive 2: to 30 meters, buddy contact and turn-pressure discipline",
            "Debrief: what your air consumption actually did",
          ],
        },
        {
          title: "Day 2 — deeper, with a safety stop plan",
          timeRange: "8:00am–2:00pm",
          items: [
            "Dive 3: to 30–40 meters, with a safety cylinder staged on the line",
            "Dive 4: to a maximum of 40 meters, planned and led by you",
            "Simulated emergency decompression stop on the safety cylinder, and ascent discipline",
            "Logbook signing and certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep does this certify me to dive?",
          answer:
            "40 meters (130 feet), which is the limit of recreational diving. Nothing beyond that is a specialty — it is technical diving, with different gear and training.",
        },
        {
          question: "Should I dive enriched air on deep dives?",
          answer:
            "It helps with nitrogen loading, but the oxygen limit gets shallower as the mix gets richer, and at 40 meters most shops' standard blends are already past their limit, so air is usually what you breathe. Take the Enriched Air course and plan each dive on its own numbers.",
        },
        {
          question: "What does narcosis feel like?",
          answer:
            "Different for everyone — usually a delay in thinking, sometimes overconfidence, occasionally anxiety. On dive 1 you will do a simple task at depth and again at the surface and compare. That is more useful than any description.",
        },
        {
          question: "Do I need my own dive computer?",
          answer:
            "You should be diving one, and for this course we expect each diver to have a computer. We rent them if you do not own one.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 18 hours after multiple dives, and treat that as a floor rather than a target. Deep repetitive diving is the case where extra surface time before a flight is worth the inconvenience.",
        },
      ],
    },
  },
  {
    slug: "wreck-diver",
    version: 1,
    title: "Wreck Diver",
    agency: "padi",
    description: "Four dives on wrecks, mapping, lines, and limited penetration.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "Dive wrecks with a survey, a line, and a way out",
      overview:
        "Wrecks are the best artificial reefs there are, and the most unforgiving places to improvise. Sharp steel, silt that hangs for an hour once you disturb it, and overheads that take away your straight route to the surface.\n\nThe course is four dives. You survey and map a wreck from the outside first, learn to look for hazards and entry points before you take any, then practice running and following a penetration line so that a lost visibility situation has a rope answer rather than a guessing answer. Only the fourth dive involves limited penetration, and only inside the light zone.\n\nRecreational wreck penetration stays shallow and short: your depth plus the distance you swim inside stays within 40 meters of the surface, and you stay on a continuous guideline back to the exit. Deeper or further is technical wreck training, which is a different course.",
      heroImageUrl: bundledImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
      imageUrls: [
        bundledImage("AtlanticGoliathGrouper.jpg"),
        bundledImage("Grouper 2 Molasses Reef 1999.jpg"),
      ],
      durationText: "2 days · 4 dives",
      groupSizeText: "A small group — smaller again on the penetration dive",
      minimumAge: 15,
      prerequisiteNote:
        // Same shape as Deep Diver: PADI's floor is Adventure Diver and the
        // app's ladder has no Adventure Diver rung, so the gate above sits at
        // Advanced Open Water. Name it as ours so an Adventure Diver knows to
        // ask rather than assume the agency turned them away.
        "PADI Advanced Open Water Diver or higher, and at least 15 years old. That is where we set this course; PADI's own requirement is Adventure Diver, a rung our system cannot record. If you hold Adventure Diver, talk to us — the gate is ours, not the agency's. Deep Diver is not required, but wrecks below 18 meters are a good reason to have it. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Four training dives",
        "Reels, lines, and slates",
        "Tanks, weights, and boat",
      ],
      excludes: [
        "Personal gear rental",
        "Dive light — bring your own or rent one from us; you need one for the penetration dive.",
        "Marine park fees",
        "Enriched air fills",
      ],
      scheduleDays: [
        {
          title: "Day 1 — survey from the outside",
          timeRange: "8:00am–3:00pm",
          items: [
            "Knowledge development: hazards, silt, entanglement, and why you do not take souvenirs",
            "Dive 1: orientation on the wreck, staying outside, spotting hazards",
            "Dive 2: mapping and sketching the wreck on a slate",
          ],
        },
        {
          title: "Day 2 — lines and limited penetration",
          timeRange: "8:00am–2:00pm",
          items: [
            "Dive 3: running a penetration line outside the wreck, then following it blind",
            "Dive 4: limited penetration inside the light zone, on a continuous guideline to the exit",
            "Debrief on gas planning, buddy spacing, and turn rules",
            "Logbook signing and certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "How far inside a wreck will I go?",
          answer:
            "Not far, and only on the last dive. Recreational wreck penetration stays inside the light zone, on a continuous guideline to the exit, with your depth plus penetration distance within 40 meters of the surface.",
        },
        {
          question: "Do I need Deep Diver first?",
          answer:
            "No. But many good wrecks sit below 18 meters, and your depth limit follows your certification, not the wreck. If the sites you want are deep, take Deep Diver too.",
        },
        {
          question: "Can I take something off the wreck?",
          answer:
            "No. Most wrecks are protected, some are war graves, and removing anything is often illegal as well as unwelcome. Take pictures.",
        },
        {
          question: "What if the wreck silts out?",
          answer:
            "That is why you run a line. The course spends a whole dive on following a line by touch, because the day you need it is the day you cannot see it.",
        },
        {
          question: "Which wrecks will we dive?",
          answer:
            "It depends on the season and the surface conditions. Ask us what is diveable the week you are here — we pick sites that suit the course, not the other way around.",
        },
        {
          question: "Can I fly afterwards?",
          answer:
            "Wait at least 18 hours after multiple dives before flying. That is a minimum, not a guarantee — plan your last dive day with room to spare.",
        },
      ],
    },
  },
  {
    slug: "divemaster",
    version: 1,
    title: "Divemaster",
    agency: "padi",
    description: "The first professional rating: supervising, assisting, and leading divers.",
    minimumCertificationLevel: "rescue",
    content: {
      ...blank,
      summary: "The first professional rating, and the point where diving becomes work",
      overview:
        "Divemaster is where you stop being a customer. You learn to supervise certified divers, assist an instructor with students, lead dives, brief a boat, and take responsibility for people who are not looking after themselves as well as you are.\n\nThe program is longer and less scheduled than a specialty course. It runs across knowledge development, waterskills and stamina exercises, a rescue assessment, practical application workshops, and internship days working real dives with real customers. Expect weeks, not days, and expect to be on the boat before the customers arrive.\n\nYou need 40 logged dives to begin and 60 to certify, so the program is also where a chunk of your logbook fills in. The stamina exercises are scored rather than pass-or-fail, which surprises people less than the amount of paperwork does.",
      heroImageUrl: bundledImage("FGBNMS - nurse shark (27551309652).jpg"),
      imageUrls: [
        bundledImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
        bundledImage("French Angelfish Pickles Reef 20230713.jpg"),
      ],
      durationText: "4–8 weeks, depending on your dive count and availability",
      groupSizeText: "Candidates work closely with a staff instructor, in small cohorts",
      minimumAge: 18,
      // The gate above matches PADI: Rescue Diver is the agency's own floor.
      // The other requirements — EFR currency, the dive counts, the physician's
      // medical — are conditions the app's ladder cannot express at all, so
      // they are spelled out here rather than implied by the cert level.
      prerequisiteNote:
        "PADI Rescue Diver or higher, at least 18 years old, and Emergency First Response primary and secondary care — or equivalent CPR and first aid training — completed within the past 24 months. You need 40 logged dives to start the program and 60 to certify, and those 60 have to include night or limited-visibility, deep, and navigation experience. A medical statement signed by a physician within the past 12 months is required; unlike the recreational courses, a self-declared questionnaire is not enough.",
      includes: [
        "All PADI learning materials, exams, and application fees",
        "Knowledge development, workshops, and skill assessments",
        "Internship days working alongside our instructors",
        "Tanks, weights, and boat on training days",
      ],
      excludes: [
        "PADI membership and annual renewal fees",
        "Emergency First Response course, if yours has lapsed",
        "Physician's medical examination",
        "Personal gear — you are expected to own a full set",
        "Professional liability insurance",
      ],
      scheduleDays: [
        {
          title: "Phase 1 — knowledge and watermanship",
          timeRange: "week 1–2",
          items: [
            "Knowledge development and the Divemaster exams",
            "Watermanship: swim, snorkel, tread, and tired-diver tow, scored not pass-fail",
            "Rescue assessment — Rescue Exercise 7, unresponsive diver at the surface",
            "Dive Skills Workshop: all 24 skills, demonstration quality",
          ],
        },
        {
          title: "Phase 2 — practical application",
          timeRange: "week 2–4",
          items: [
            "Dive site setup and management workshop",
            "Mapping project on a site we actually run",
            "Deep and search-and-recovery scenarios",
            "Skin diver and snorkeling supervision workshop",
          ],
        },
        {
          title: "Phase 3 — internship",
          timeRange: "week 4 onward",
          items: [
            "Assisting on Open Water and continuing-education courses",
            "Supervising certified divers on real boat days",
            "Briefing, roll call, and manifest practice",
            "Logbook to 60 dives, paperwork, and certification",
          ],
        },
      ],
      faqs: [
        {
          question: "How many dives do I need?",
          answer:
            "40 logged dives to begin and 60 to certify, and those 60 have to include night or limited-visibility, deep, and navigation experience. If you arrive with 40 we will build the rest into the program; if you arrive with 60 we will check the mix before you start.",
        },
        {
          question: "Do I have to own my gear?",
          answer:
            "Yes, in practice. A Divemaster is expected to arrive with their own mask, fins, snorkel, exposure suit, BCD, regulator with alternate air source, computer, compass, cutting tool, surface marker, and slate.",
        },
        {
          question: "Can I work as a Divemaster straight away?",
          answer:
            "You are certified to supervise certified divers and assist instructors, once you are a renewed PADI member with insurance where it is required. Whether a shop hires you is a separate question, and a good internship is the best answer to it.",
        },
        {
          question: "Are the stamina exercises pass-or-fail?",
          answer:
            "They are scored on a scale, and you need a minimum total across them. You do not need to be an athlete; you do need to be able to look after someone else in the water when you are already tired.",
        },
        {
          question: "How long does it really take?",
          answer:
            "Four to eight weeks for most candidates, longer if you are working around a job. The program is performance-based, so the honest answer is that it takes as long as it takes to be someone we would put in front of customers.",
        },
        {
          question: "Is Divemaster the same as instructor?",
          answer:
            "No. Divemaster supervises and assists; it does not certify students. Instructor Development Course is the next step, and Divemaster is its prerequisite.",
        },
      ],
    },
  },
];
