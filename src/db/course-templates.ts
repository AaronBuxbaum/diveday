import type { CourseContent } from "@/lib/courses";
import type { CertificationLevel } from "@/lib/readiness";

/**
 * Scuba's published course pages: the words a shop starts from, not the words
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
        "Discover Scuba Diving is not a certification — it is the afternoon you find out whether breathing underwater is for you. An instructor covers the few things that matter, fits your gear, and stays with you the whole time.\n\nYou will start in shallow, confined water, practise clearing your mask and recovering your regulator, and then, if you are comfortable, make a shallow open-water dive. Nobody is graded, and nobody goes deeper than they want to.\n\nIf you love it, your instructor can credit the skills you learn here toward the Open Water Diver course.",
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
            "One shallow open-water dive, maximum 12 metres, with your instructor",
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
            "No deeper than 12 metres, and only as deep as you are happy with. Most first dives stay much shallower.",
        },
        {
          question: "Am I certified afterwards?",
          answer:
            "No — this is an experience programme, not a certification. If you go on to the Open Water Diver course, your instructor can credit these skills toward it; ask us how that works for your dates.",
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
        "The Open Water Diver certification is the one that opens the door: qualified to dive to 18 metres with a buddy, anywhere in the world, without an instructor — in conditions as good as or better than those you trained in.\n\nThe course is three parts. Knowledge development covers pressure, air, and planning — most students do this online before arriving. Confined water is where the skills become muscle memory, in shallow water with somewhere to stand. Four open-water dives put it together on the reef.\n\nNo prior experience is required. You do need to be comfortable in water: the course includes a 200-metre swim (or 300 with mask, fins, and snorkel) and a 10-minute float, neither of them timed.",
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
        "No certification required. Divers aged 10–11 certify as Junior Open Water Divers, dive to a maximum of 12 metres, and must dive with a PADI Professional or a certified parent or guardian; divers aged 12–14 dive to 18 metres with any certified adult. Those restrictions lift at 15. Every student completes a medical questionnaire first; some answers need a physician's sign-off before getting in the water.",
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
            "Open water dives 3–4, to a maximum of 18 metres",
            "Navigation, buoyancy control, and a debrief",
            "Certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep can I dive once I am certified?",
          answer:
            "18 metres (60 feet) as an Open Water Diver, in conditions as good as or better than those you trained in. Advanced Open Water Diver extends that to 30 metres.",
        },
        {
          question: "Do I need to be a strong swimmer?",
          answer:
            "You need basic watermanship: a 200-metre swim or a 300-metre snorkel, plus a 10-minute float or tread. Neither is timed, and any stroke counts.",
        },
        {
          question: "Is equipment included?",
          answer:
            "Yes — mask, fins, wetsuit, BCD, regulator, computer, tanks, and weights are all provided for the course.",
        },
        {
          question: "What is the minimum age?",
          answer:
            "10 years old. Divers aged 10–11 certify as Junior Open Water Divers, dive to 12 metres, and must be accompanied by a PADI Professional or a certified parent or guardian. Divers aged 12–14 dive to 18 metres with any certified adult. Both restrictions lift at 15.",
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
        "Advanced Open Water Diver is not a repeat of Open Water with harder skills — it is five dives, each a first taste of a different specialty, done under instructor supervision.\n\nTwo are required: a deep dive, which extends your limit to 30 metres (21 metres for divers aged 12–14), and an underwater navigation dive. You choose the other three from what the site and the season offer — night, wreck, drift, buoyancy, naturalist, and others.\n\nThere is no final exam. There is a short knowledge review before each dive, and the dives themselves count as training dives.",
      heroImageUrl: bundledImage("FGBNMS - nurse shark (27551309652).jpg"),
      imageUrls: [
        bundledImage("Sphyraena barracuda by NOAA.jpg"),
        bundledImage("Grouper 2 Molasses Reef 1999.jpg"),
      ],
      durationText: "2 days · 5 dives",
      groupSizeText: "Maximum 8 students per instructor",
      minimumAge: 12,
      prerequisiteNote:
        "PADI Open Water Diver (or a qualifying certification from another agency) — we verify the card before the first dive. Divers aged 12–14 certify as Junior Advanced Open Water Divers and are limited to 21 metres, including on the deep dive; the full 30 metres comes at 15.",
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
            "Deep adventure dive — maximum 30 metres, or 21 metres for divers aged 12–14",
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
            "To a maximum of 30 metres — 21 metres if you are 12–14 — and only after your instructor has briefed gas planning, narcosis, and the ascent plan.",
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
        "Most divers describe Rescue as the hardest course they have enjoyed. The focus shifts outward: from your own diving to the divers around you, and to the problems that are still small enough to solve.\n\nYou will practise self-rescue, recognising and managing stress in another diver, in-water rescue and tows, surfacing an unresponsive diver, and giving rescue breaths while bringing them in. The course finishes with two scenarios that put it together under pressure.\n\nEmergency First Response (CPR and first aid) training within the past 24 months is required. We run it alongside the course if you need it.",
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
];
