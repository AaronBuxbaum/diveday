// i18n-exempt-file: shop-editable starter course content, not app UI copy — see CourseContent's doc comment

import { courseTemplateSnapshot } from "@/lib/course-template-sync";
import type { CourseContent, CourseGalleryPhoto } from "@/lib/courses";
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
 * never rewrites a shop's page automatically. The staff editor can show a
 * three-way diff and explicitly apply a later version, with shop-owned fields
 * kept out of the overwrite (ADR 20260816-course-template-updates).
 *
 * **Every depth is a placeholder — `{depth18}`, never "18 meters" and never
 * "18 meters (60 feet)".** The prose lands in the shop's own row as free text,
 * and a Florida shop reading feet on every other surface in the app was being
 * told "No deeper than 12 meters" by its own course page. `{depth18}` resolves
 * at render through `resolveCourseContentDepths` (src/lib/courses.ts) into the
 * shop's `shops.depth_unit`, so the same row reads "18 meters" in Cozumel and
 * "60 feet" in Key Largo.
 *
 * The number in the token is metres, but the resolution is a **lookup, not a
 * conversion** — `COURSE_DEPTHS` carries the agency pairs (12/40, 18/60, 21/70,
 * 30/100, 40/130), the same table `DepthCeiling` in src/lib/depth-ceiling.ts
 * holds, so a page and a roster warning can never quote different limits. A
 * naive conversion would print "59 ft", a number in no dive manual anywhere.
 * `{depth30n}` is the bare number for a range: "to {depth30n}–{depth40}".
 *
 * A shop is free to delete a placeholder and write its own words; only a
 * *broken* one (`{depth 18}`, `{depth19}`) is refused, at save, by the course
 * editor. The swim test is untouched and reads "200-meter/yard", which is
 * PADI's own wording: the two distances are treated as equivalent rather than
 * converted, so there is no pair to look up.
 */
export type CourseTemplate = {
  slug: string;
  version: number;
  title: string;
  /**
   * Which agency's standards the prose below is quoting.
   *
   * Not the same list as `certification_agency` (the enum a *diver's card* is
   * recorded against, which carries ten): this is the set DiveDay has actually
   * written starter pages for. A shop that teaches under any other agency
   * writes its own courses — the templates are a starting point, never a
   * gate — and the diver-facing catalog builds one tab per agency a shop
   * teaches (`activeCourseAgencies` in src/db/courses.ts).
   */
  agency: "padi" | "ssi" | "sdi";
  description: string;
  minimumCertificationLevel: CertificationLevel | null;
  content: CourseContent;
};

/** Bundled Wikimedia Commons imagery; see public/dive-sites/README.md for credits. */
function bundledImage(filename: string): string {
  return `/dive-sites/${encodeURIComponent(filename)}`;
}

/**
 * A gallery of bundled photos, deliberately uncaptioned.
 *
 * DiveDay ships the art; the caption is the shop's — it describes *its* course
 * and is written in the shop's own language, which a bundled English string
 * could only get wrong. A blank caption renders as the generated
 * "{title} — photo {n}" (`resolveImageAlt`), which is what a shop that never
 * touches the page publishes and is exactly what it published before this
 * helper existed.
 */
function bundledGallery(...filenames: string[]): CourseGalleryPhoto[] {
  return filenames.map((filename) => ({ url: bundledImage(filename), alt: "" }));
}

const blank: CourseContent = {
  summary: null,
  overview: null,
  heroImageUrl: null,
  heroImageAlt: null,
  galleryPhotos: [],
  durationText: null,
  groupSizeText: null,
  minimumAge: null,
  prerequisiteNote: null,
  includes: [],
  excludes: [],
  scheduleDays: [],
  faqs: [],
  isIntroCourse: false,
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
      isIntroCourse: true,
      summary: "Try scuba for the first time, with an instructor at your shoulder",
      overview:
        "Discover Scuba Diving is not a certification — it is the afternoon you find out whether breathing underwater is for you. An instructor covers the few things that matter, fits your gear, and stays with you the whole time.\n\nYou will start in shallow, confined water, practice clearing your mask and recovering your regulator, and then, if you are comfortable, make a shallow open-water dive. Nobody is graded, and nobody goes deeper than they want to.\n\nIf you love it, your instructor can credit the skills you learn here toward the Open Water Diver course.",
      heroImageUrl: bundledImage("Blue Tangs Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Molasses Reef 20080309.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
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
      excludes: ["Photos and video"],
      scheduleDays: [
        {
          title: "Your afternoon",
          timeNote: "about 3 hours",
          items: [
            "Briefing: how the gear works and how to breathe on it",
            "Confined water: mask clearing, regulator recovery, moving around",
            "One shallow open-water dive, maximum {depth12}, with your instructor",
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
            "No deeper than {depth12}, and only as deep as you are happy with. Most first dives stay much shallower.",
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
    // Version 2 is the first live revision consumed by the update flow. Older
    // shop copies can review this wording change without losing their own
    // overview, pricing, or photography.
    version: 2,
    title: "Open Water Diver",
    agency: "padi",
    description: "The foundational certification course for new divers.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "Become a certified PADI Open Water Diver",
      overview:
        "The Open Water Diver certification is the one that opens the door: qualified to dive to {depth18} with a buddy, anywhere in the world, without an instructor — in conditions as good as or better than those you trained in.\n\nThe course is three parts. Knowledge development covers pressure, air, and planning — most students do this online before arriving. Confined water is where the skills become muscle memory, in shallow water with somewhere to stand. Four open-water dives put it together on the reef.\n\nNo prior experience is required. You do need to be comfortable in water: the course includes a 200-meter/yard swim (or 300 with mask, fins, and snorkel) and a 10-minute float, neither of them timed.",
      heroImageUrl: bundledImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Blue Tang Pickles 20080310.jpg",
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "Yellowtail Snappers Molasses Reef 1999.jpg",
      ),
      durationText: "3 days · 8:00am–5:00pm",
      groupSizeText: "Maximum 8 students per instructor",
      minimumAge: 10,
      prerequisiteNote:
        "No certification required. Divers aged 10–11 certify as Junior Open Water Divers, dive to a maximum of {depth12}, and must dive with a PADI Professional or a certified parent or guardian; divers aged 12–14 dive to {depth18} with any certified adult. Those restrictions lift at 15. Every student completes a medical questionnaire first; some answers need a physician's sign-off before getting in the water.",
      includes: [
        "All PADI learning materials and certification fees",
        "Complete rental gear for the whole course",
        "Four open-water training dives",
        "Light lunch on full days",
      ],
      excludes: ["Underwater photos"],
      scheduleDays: [
        {
          title: "Day 1 — classroom and confined water",
          startTime: "08:00",
          endTime: "17:00",
          items: [
            "Paperwork, medical questionnaire, and gear fitting",
            "Knowledge reviews 1–2, with quizzes",
            "Swim and float assessment (not timed)",
            "Confined water dives 1–2: assembly, mask clearing, regulator recovery, buoyancy",
          ],
        },
        {
          title: "Day 2 — confined water and first open water",
          startTime: "08:00",
          endTime: "17:00",
          items: [
            "Knowledge reviews 3–4, with quizzes",
            "Confined water dives 3–5, including out-of-air skills and mask removal",
            "Open water dives 1–2 on a shallow reef",
          ],
        },
        {
          title: "Day 3 — open water and exam",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Knowledge review 5 and the final exam",
            "Open water dives 3–4, to a maximum of {depth18}",
            "Navigation, buoyancy control, and a debrief",
            "Certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep can I dive once I am certified?",
          answer:
            "{depth18} as an Open Water Diver, in conditions as good as or better than those you trained in. Advanced Open Water Diver extends that to {depth30}.",
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
            "10 years old. Divers aged 10–11 certify as Junior Open Water Divers, dive to {depth12}, and must be accompanied by a PADI Professional or a certified parent or guardian. Divers aged 12–14 dive to {depth18} with any certified adult. Both restrictions lift at 15.",
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
        "Advanced Open Water Diver is not a repeat of Open Water with harder skills — it is five dives, each a first taste of a different specialty, done under instructor supervision.\n\nTwo are required: a deep dive, which extends your limit to {depth30}, or {depth21} for divers aged 12–14, and an underwater navigation dive. You choose the other three from what the site and the season offer — night, wreck, drift, buoyancy, naturalist, and others.\n\nThere is no final exam. There is a short knowledge review before each dive, and the dives themselves count as training dives.",
      heroImageUrl: bundledImage("FGBNMS - nurse shark (27551309652).jpg"),
      galleryPhotos: bundledGallery(
        "Yellowtail Snappers Molasses Reef 1999.jpg",
        "Grouper 2 Molasses Reef 1999.jpg",
      ),
      durationText: "2 days · 5 dives",
      groupSizeText: "Maximum 8 students per instructor",
      minimumAge: 12,
      prerequisiteNote:
        "PADI Open Water Diver (or a qualifying certification from another agency) — we verify the certification record before the first dive. Divers aged 12–14 certify as Junior Advanced Open Water Divers and are limited to {depth21}, including on the deep dive; the full {depth30} comes at 15.",
      includes: [
        "All PADI learning materials and certification fees",
        "Five supervised adventure dives",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "Specialty gear for optional dives"],
      scheduleDays: [
        {
          title: "Day 1 — deep and navigation",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Knowledge reviews for the day's dives",
            "Deep adventure dive — maximum {depth30}, or {depth21} for divers aged 12–14",
            "Underwater navigation dive: natural references and compass",
          ],
        },
        {
          title: "Day 2 — three you choose",
          startTime: "08:00",
          endTime: "15:00",
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
            "To a maximum of {depth30} — {depth21} if you are 12–14 — and only after your instructor has briefed gas planning, narcosis, and the ascent plan.",
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
      galleryPhotos: bundledGallery("Sponge 06 Molasses Reef 20230714.jpg"),
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
      excludes: ["Emergency First Response course, if you need it", "Personal gear rental"],
      scheduleDays: [
        {
          title: "Day 1 — knowledge and self-rescue",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Knowledge development and the rescue exam",
            "Self-rescue and cramp release",
            "Tired and panicked diver at the surface",
          ],
        },
        {
          title: "Day 2 — rescuing another diver",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Responsive and unresponsive diver underwater",
            "Surfacing an unresponsive diver and in-water rescue breathing",
            "Exits, oxygen, and handing over to emergency services",
          ],
        },
        {
          title: "Day 3 — scenarios",
          startTime: "08:00",
          endTime: "14:00",
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
        "If it has been a year or more since your last dive, the theory fades faster than the fun does. This is the PADI ReActivate program: a short knowledge review, then a confined-water session where you put the gear back on and find that your hands still know what to do.\n\nWe go over the skills that matter after a break — mask clearing, regulator recovery, weighting and buoyancy, sharing air, and how your computer works. Then you dive. Most divers feel normal again within the first ten minutes of the confined-water session.\n\nThis is not a new certification. It is a dated refresher noted on your certification record, and it is the right reset before you get on a boat with strangers.",
      heroImageUrl: bundledImage("Blue Tang Pickles 20080310.jpg"),
      galleryPhotos: bundledGallery("Brain coral 2 Molasses Reef 20080309.jpg"),
      durationText: "Half a day · about 4 hours",
      groupSizeText: "A small group, with your instructor in the water with you",
      minimumAge: 10,
      // PADI's floor for ReActivate is (Junior) Scuba Diver; the app's ladder has
      // no Scuba Diver rung, so the gate above sits at Open Water. Say plainly
      // that this is our line, not the agency's — same precedent as Rescue,
      // Deep, and Wreck below.
      prerequisiteNote:
        "Open Water Diver or higher, from PADI or another agency — that is where we set this course. PADI's own floor is one rung lower (PADI Scuba Diver), which our system cannot record; if you hold Scuba Diver, talk to us before you book — the gate is ours, not the agency's. Share your digital certification record or other evidence, or we can look it up. You will complete a medical questionnaire first; some answers require a physician's sign-off before you can dive.",
      includes: [
        "Knowledge review with an instructor",
        "Complete rental gear for the session",
        "Confined-water skills session",
      ],
      excludes: ["Open-water dives afterwards", "Photos and video"],
      scheduleDays: [
        {
          title: "Your morning",
          timeNote: "about 4 hours",
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
            "No. Your original certification never expires. ReActivate adds a date to your certification record showing when you last refreshed, which some operators like to see.",
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
    title: "Nitrox Diver",
    agency: "padi",
    description: "Learn to plan and dive with Nitrox up to 40% oxygen.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "More bottom time on repetitive dives, and the planning that makes it safe",
      overview:
        "Nitrox is ordinary air with more oxygen and less nitrogen. Less nitrogen means slower nitrogen loading, which usually means longer no-decompression limits — the difference shows up most on the second and third dives of a day.\n\nThe trade is a new limit to respect. Oxygen becomes the thing you can get too much of, so every dive has a maximum operating depth set by the mix. The course teaches you to analyze your own cylinder, log the result, set your computer to the mix you actually have, and work out the depth you must not pass.\n\nThe certification covers recreational blends from 22% to 40% oxygen. There are no required training dives — this is a knowledge and practical-skills course — though we usually run two dives with it so you use the procedures for real.",
      heroImageUrl: bundledImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery("Grouper 2 Molasses Reef 1999.jpg"),
      durationText: "1 day · knowledge and practical sessions",
      groupSizeText: "A small group, working through the analyzer and your own computer",
      minimumAge: 12,
      // The gate above matches PADI: Open Water Diver (or Junior Open Water
      // Diver) is the agency's own floor. The age is the tighter limit here —
      // a 10- or 11-year-old Junior Open Water Diver has to wait until 12.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 12 years old. Junior Open Water Divers aged 10–11 are old enough for the certification but not for this course; the agency's minimum age is 12. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Analyzer use and cylinder-logging practice",
      ],
      excludes: [
        "The two optional dives — boat, tanks, and the Nitrox in them are billed together if you add them",
        "Personal gear rental",
        "Nitrox fills after the course",
      ],
      scheduleDays: [
        {
          title: "Course day",
          startTime: "08:00",
          endTime: "14:00",
          items: [
            "Knowledge development: oxygen exposure, nitrogen loading, and what changes",
            "Working out maximum operating depth from the mix, and the mix from the depth",
            "Practical: analyze two cylinders, log them, and set your computer to the blend",
            "Two optional dives on Nitrox, using the procedures end to end",
          ],
        },
      ],
      faqs: [
        {
          question: "Does Nitrox let me dive deeper?",
          answer:
            "No — the opposite. You have two limits now: the one your certification gives you, and a maximum operating depth set by your mix and an oxygen partial-pressure ceiling of 1.4 bar. Whichever is shallower is your limit for that dive. Nitrox buys bottom time, not depth.",
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
            "No. On a single shallow dive you will probably hit your air supply or the boat schedule long before the no-decompression limit. The gain shows up on repetitive dives between {depth18n} and {depth30}.",
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
      galleryPhotos: bundledGallery(
        "Sponge 06 Molasses Reef 20230714.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "1 day · 2 dives",
      groupSizeText: "A small group, so your instructor can watch each diver hover",
      minimumAge: 10,
      // The gate above matches PADI: Open Water Diver (or Junior Open Water
      // Diver) is the agency's own floor, and the ages line up too.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency. Divers aged 10–11 take it as Junior Open Water Divers and keep their {depth12} depth limit and supervision requirements. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Two training dives",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "Underwater photos"],
      scheduleDays: [
        {
          title: "Course day",
          startTime: "08:00",
          endTime: "14:00",
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
      galleryPhotos: bundledGallery(
        "Sponge 06 Molasses Reef 20230714.jpg",
        "French Angelfish Pickles Reef 20230713.jpg",
      ),
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
      excludes: ["Personal gear rental", "Dinner between dives"],
      scheduleDays: [
        {
          title: "Evening 1 — dusk and dark",
          startTime: "16:00",
          endTime: "21:30",
          items: [
            "Knowledge review: lights, signals, buddy contact, and lost-light procedure",
            "Gear and light check in daylight, before you need them",
            "Dive 1: entry at dusk, staying with your buddy as the light goes",
            "Dive 2: light signals and communication in full dark",
          ],
        },
        {
          title: "Evening 2 — navigation",
          startTime: "17:00",
          endTime: "21:00",
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
            "Shallower than daytime dives — our night training dives stay well within {depth18}. Your certification limit still applies, and after dark there is nothing at depth you cannot see at {depth12}.",
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
    description: "Four dives that extend your limit to {depth40}, done properly.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "How to dive between {depth18n} and {depth40} and come back with a plan intact",
      overview:
        "Deep diving is not about being brave. It is about how little margin you have: air goes faster, no-decompression limits shrink, narcosis is real, and the surface is further away when something goes wrong.\n\nThe course is four dives, the deepest to a maximum of {depth40} — the limit of recreational diving, and the deepest this certification will ever take you. You will plan gas and time before you get wet, practice using a safety cylinder on a line, and see for yourself what narcosis does to you by running a simple task at depth and again at the surface.\n\nColor disappears with depth too. Bring a light and watch what red does at {depth30}.",
      heroImageUrl: bundledImage("AtlanticGoliathGrouper.jpg"),
      galleryPhotos: bundledGallery(
        "AtlanticGoliathGrouper.jpg",
        "Grouper 2 Molasses Reef 1999.jpg",
      ),
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
        "Four training dives, the last to a maximum of {depth40}",
        "Safety cylinder and line",
        "Tanks, weights, and boat",
      ],
      excludes: ["Nitrox fills", "Personal gear rental", "Dive computer rental"],
      scheduleDays: [
        {
          title: "Day 1 — planning and the first two dives",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Knowledge development: gas planning, narcosis, decompression, and contingencies",
            "Dive 1: to {depth18n}–{depth30}, with a narcosis comparison task",
            "Dive 2: to {depth30}, buddy contact and turn-pressure discipline",
            "Debrief: what your air consumption actually did",
          ],
        },
        {
          title: "Day 2 — deeper, with a safety stop plan",
          startTime: "08:00",
          endTime: "14:00",
          items: [
            "Dive 3: to {depth30n}–{depth40}, with a safety cylinder staged on the line",
            "Dive 4: to a maximum of {depth40}, planned and led by you",
            "Simulated emergency decompression stop on the safety cylinder, and ascent discipline",
            "Logbook signing and certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep does this certify me to dive?",
          answer:
            "{depth40}, which is the limit of recreational diving. Nothing beyond that is a specialty — it is technical diving, with different gear and training.",
        },
        {
          question: "Should I dive Nitrox on deep dives?",
          answer:
            "It helps with nitrogen loading, but the oxygen limit gets shallower as the mix gets richer, and at {depth40} most shops' standard blends are already past their limit, so air is usually what you breathe. Take the Nitrox course and plan each dive on its own numbers.",
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
        "Wrecks are the best artificial reefs there are, and the most unforgiving places to improvise. Sharp steel, silt that hangs for an hour once you disturb it, and overheads that take away your straight route to the surface.\n\nThe course is four dives. You survey and map a wreck from the outside first, learn to look for hazards and entry points before you take any, then practice running and following a penetration line so that a lost visibility situation has a rope answer rather than a guessing answer. Only the fourth dive involves limited penetration, and only inside the light zone.\n\nRecreational wreck penetration stays shallow and short: your depth plus the distance you swim inside stays within {depth40} of the surface, and you stay on a continuous guideline back to the exit. Deeper or further is technical wreck training, which is a different course.",
      heroImageUrl: bundledImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
      galleryPhotos: bundledGallery(
        "AtlanticGoliathGrouper.jpg",
        "Grouper 2 Molasses Reef 1999.jpg",
      ),
      durationText: "2 days · 4 dives",
      groupSizeText: "A small group — smaller again on the penetration dive",
      minimumAge: 15,
      prerequisiteNote:
        // Same shape as Deep Diver: PADI's floor is Adventure Diver and the
        // app's ladder has no Adventure Diver rung, so the gate above sits at
        // Advanced Open Water. Name it as ours so an Adventure Diver knows to
        // ask rather than assume the agency turned them away.
        "PADI Advanced Open Water Diver or higher, and at least 15 years old. That is where we set this course; PADI's own requirement is Adventure Diver, a rung our system cannot record. If you hold Adventure Diver, talk to us — the gate is ours, not the agency's. Deep Diver is not required, but wrecks below {depth18} are a good reason to have it. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Four training dives",
        "Reels, lines, and slates",
        "Tanks, weights, and boat",
      ],
      excludes: [
        "Personal gear rental",
        "Dive light — bring your own or rent one from us; you need one for the penetration dive.",
        "Nitrox fills",
      ],
      scheduleDays: [
        {
          title: "Day 1 — survey from the outside",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Knowledge development: hazards, silt, entanglement, and why you do not take souvenirs",
            "Dive 1: orientation on the wreck, staying outside, spotting hazards",
            "Dive 2: mapping and sketching the wreck on a slate",
          ],
        },
        {
          title: "Day 2 — lines and limited penetration",
          startTime: "08:00",
          endTime: "14:00",
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
            "Not far, and only on the last dive. Recreational wreck penetration stays inside the light zone, on a continuous guideline to the exit, with your depth plus penetration distance within {depth40} of the surface.",
        },
        {
          question: "Do I need Deep Diver first?",
          answer:
            "No. But many good wrecks sit below {depth18}, and your depth limit follows your certification, not the wreck. If the sites you want are deep, take Deep Diver too.",
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
    slug: "underwater-navigator",
    version: 1,
    title: "Underwater Navigator",
    agency: "padi",
    description: "Three dives spent learning to find your way back without asking.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Know where the boat is, and get back to it without surfacing",
      overview:
        "Most divers navigate by following someone. This is the course where you stop.\n\nYou work with a compass on the surface first, because a compass you are still puzzling over at depth is a compass you will not trust. Then three dives: swimming reciprocal and square patterns on the compass, estimating distance by kick cycles and by time, and reading the reef itself — the direction of the slope, the way the ripples in the sand line up, where the sun is.\n\nNatural navigation is the half most divers skip and the half that works when the compass is still on the boat. By the end you should be able to leave a fixed point, swim a pattern, and come back to it — the same skill that finds a mooring line, a wreck, and your exit.",
      heroImageUrl: bundledImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "Yellowtail Snappers Molasses Reef 1999.jpg",
      ),
      durationText: "1–2 days · 3 dives",
      groupSizeText: "A small group — navigation is practiced one diver at a time",
      minimumAge: 10,
      // The gate above matches PADI: (Junior) Open Water Diver is the agency's
      // own floor for Underwater Navigator, and 10 is its minimum age.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 10 years old. Divers aged 10–11 take it as Junior Open Water Divers and keep their {depth12} depth limit and supervision requirements. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Three training dives",
        "Compass, slate, and marker floats",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "A compass of your own, if you buy one"],
      scheduleDays: [
        {
          title: "Day 1 — compass work",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Knowledge review: the compass, natural references, and how distance is estimated",
            "On land: setting a heading and walking it, before it costs you air",
            "Dive 1: reciprocal headings out and back, on the compass alone",
            "Dive 2: estimating distance by kick cycles, by time, and by tank pressure",
          ],
        },
        {
          title: "Day 2 — patterns and natural navigation",
          timeNote: "half a day",
          items: [
            "Dive 3: a square pattern, then a return to the start on natural references alone",
            "Finding a marked object from a distance, and relocating it a second time",
            "Debrief and certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need my own compass?",
          answer:
            "No — we provide one for the course. If you buy one afterwards, buy the model you trained on where you can: a compass you read without thinking is worth more than a better one you have to study.",
        },
        {
          question: "Is it all compass work?",
          answer:
            "About half. The rest is natural navigation — slope, sand ripples, light, surge direction — which is what you fall back on when the compass is on the boat or the site gives you nothing to sight along.",
        },
        {
          question: "How is this different from the navigation dive in Advanced Open Water?",
          answer:
            "Depth of practice. That is one dive and an introduction; this is three dives of patterns and distance estimation until it is repeatable. The first dive here credits as the Navigation Adventure Dive, in either direction.",
        },
        {
          question: "What if I get lost during the course?",
          answer:
            "You will, at least once, which is the point of doing it with an instructor beside you. Being wrong in front of your instructor is much cheaper than being wrong on a holiday dive.",
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
    slug: "digital-underwater-photographer",
    version: 1,
    title: "Digital Underwater Photographer",
    agency: "padi",
    description:
      "Two dives on getting a photo worth keeping, in the water rather than in software.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Come back with photos you actually want to show people",
      overview:
        "Almost everyone's first underwater photos are the same: blue, soft, and taken from too far away. Nearly all of that comes from three habits, and two dives is enough to break them.\n\nYou will learn to get close and then closer, to shoot slightly upward instead of down onto the sand, and to put light back into the picture — strobe, video light, or just the sun behind you — because water takes the red out of everything within the first few body lengths. We set your camera up together before you get wet, so you are not scrolling through menus at depth.\n\nBuoyancy is the other half of this course and it is not optional. A photographer who kneels on the reef to steady a shot is a diver doing damage; every frame here is taken hovering.",
      heroImageUrl: bundledImage("French Angelfish Pickles Reef 20230713.jpg"),
      galleryPhotos: bundledGallery(
        "Stoplight parrotfish Pickles Reef.jpg",
        "Sponge 06 Molasses Reef 20230714.jpg",
      ),
      durationText: "1 day · 2 dives",
      groupSizeText: "A small group, so your instructor can go through your frames between dives",
      minimumAge: 10,
      // The gate above matches PADI: (Junior) Open Water Diver is the agency's
      // own floor for Digital Underwater Photographer, minimum age 10.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 10 years old. Divers aged 10–11 take it as Junior Open Water Divers and keep their {depth12} depth limit and supervision requirements. Steady buoyancy matters more here than any camera does. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply.",
      includes: [
        "All PADI learning materials and certification fees",
        "Two training dives",
        "A camera and housing to borrow, if you do not have one",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "Memory cards", "Editing software"],
      scheduleDays: [
        {
          title: "Course day",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Setup: your camera, its housing, and the handful of settings you will actually use",
            "Dive 1: getting close, shooting slightly upward, holding position without touching anything",
            "Surface interval: going through your own frames with your instructor, honestly",
            "Dive 2: light and colour — strobe or video light, angle, and distance",
            "Choosing your best few frames, and working out why the rest did not land",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need to own a camera?",
          answer:
            "No, we can lend you one. If you own one, bring it — the housing, the buttons, and the menus are half of what you are learning here, and they are different on every camera.",
        },
        {
          question: "Will a phone work?",
          answer:
            "In a housing rated for the depth you are diving, yes, and plenty of good photos are taken that way. Bring the housing you actually plan to dive, not one you have never opened.",
        },
        {
          question: "How good does my buoyancy need to be?",
          answer:
            "Good enough to hover and stay off the reef with both hands on a camera. If you are not there yet, Peak Performance Buoyancy first will do more for your photos than any lens.",
        },
        {
          question: "What about video?",
          answer:
            "The habits carry straight over — get close, hold still, light the subject — but this course is built around stills. If video is what you care about, say so when you book and we will weight the dives that way.",
        },
        {
          question: "Does this count toward Advanced Open Water?",
          answer:
            "Yes. The first dive credits as the Digital Underwater Photographer Adventure Dive in the Advanced Open Water Diver course, in either direction.",
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
    slug: "drift-diver",
    version: 1,
    title: "Drift Diver",
    agency: "padi",
    description: "Two dives learning to let the current do the work.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Stop swimming against the ocean and start riding it",
      overview:
        "A drift dive is the laziest good diving there is. You go in, stop kicking, and let the water carry you past more reef than you could ever swim. What the course adds is everything around that: staying together, and staying findable.\n\nTwo dives cover the parts that go wrong. Entries have to be quick and everybody has to go at once. Buddy contact matters more when nothing is where you left it. A surface marker goes up before you do, so the boat knows where you are before your head appears. You will also learn to read a current — where it accelerates, where it eddies behind structure, and how to get out of one you would rather not be in.\n\nMost drift days here are live-boat: nothing anchors, the boat follows your bubbles and your marker, and it collects you wherever you surface.",
      heroImageUrl: bundledImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "Blue Tangs Molasses Reef 1999.jpg",
        "Elkhorn coral 8 Molasses Reef 20080309.jpg",
      ),
      durationText: "1 day · 2 dives",
      groupSizeText: "A small group — a drift group strung out is a group nobody can watch",
      minimumAge: 12,
      // The gate above matches PADI: (Junior) Open Water Diver is the agency's
      // own floor for Drift Diver. Age is the tighter limit at 12, so a Junior
      // Open Water Diver aged 10–11 waits.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 12 years old. Divers aged 12–14 certify as Junior Drift Divers and keep the supervision requirements that come with their certification. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Two drift dives from the boat",
        "Surface marker buoy and reel",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "A marker buoy of your own, if you buy one"],
      scheduleDays: [
        {
          title: "Course day",
          startTime: "08:00",
          endTime: "14:30",
          items: [
            "Briefing: reading a current, live-boat procedure, and what the crew expects to see",
            "Dive 1: a quick group entry, drifting in trim, and holding buddy contact",
            "Surface interval, and an honest look at how the group held together",
            "Dive 2: deploying a surface marker from depth, then a controlled ascent in moving water",
          ],
        },
      ],
      faqs: [
        {
          question: "Is a drift dive harder than an ordinary dive?",
          answer:
            "Easier on your legs and harder on your attention. Nothing stays where you left it, so buddy contact and marker deployment stop being paperwork and become the dive.",
        },
        {
          question: "What if I get separated from the group?",
          answer:
            "Ascend, deploy your marker, and wait. The boat is following the group rather than sitting on an anchor, and a diver with a marker up is visible from a long way off. We rehearse this instead of hoping.",
        },
        {
          question: "Do I need my own surface marker?",
          answer:
            "We provide one for the course. Buy your own afterwards — a marker you have sent up a dozen times goes up cleanly on the day it matters.",
        },
        {
          question: "Can I take photos on a drift dive?",
          answer:
            "Yes, and it will teach you to shoot fast. What you cannot do is stop to frame a shot; the group will not stop with you.",
        },
        {
          question: "Does this count toward Advanced Open Water?",
          answer:
            "Yes. The first dive credits as the Drift Adventure Dive in the Advanced Open Water Diver course, in either direction.",
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
    slug: "boat-diver",
    version: 1,
    title: "Boat Diver",
    agency: "padi",
    description: "Two dives on being useful, and unbothered, on a dive boat.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Know where your gear goes, where to stand, and when to jump",
      overview:
        "Nobody is born knowing how a dive boat works. All of it is unfamiliar the first time: where your kit goes, which side you enter from, what the crew means by a live drop, why your fins go on last.\n\nTwo dives cover the routine. Setting up in the space you are given rather than the space you want. The entries a boat asks for, done without losing your mask. Tag lines and descent lines, and what they are actually for. Getting back onto a ladder in a swell without hurting yourself or the person behind you. You will pick up the vocabulary too — bow, stern, windward, and which parts of a briefing are instructions rather than scenery.\n\nSeasickness gets its own conversation, because the honest answer is that it is far easier to prevent than to cure.",
      heroImageUrl: bundledImage("Blue Tang Pickles 20080310.jpg"),
      galleryPhotos: bundledGallery(
        "Yellowtail Snappers Molasses Reef 1999.jpg",
        "Brain coral 2 Molasses Reef 20080309.jpg",
      ),
      durationText: "1 day · 2 dives",
      groupSizeText: "A small group on an ordinary boat day, not a boat chartered for the course",
      minimumAge: 10,
      // The gate above matches PADI: (Junior) Open Water Diver is the agency's
      // own floor for Boat Diver, minimum age 10.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 10 years old. Divers aged 10–11 take it as Junior Open Water Divers and keep their {depth12} depth limit and supervision requirements. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Two dives from the boat",
        "Tanks, weights, and the boat day",
      ],
      excludes: ["Personal gear rental", "Seasickness medication", "Crew gratuity"],
      scheduleDays: [
        {
          title: "Course day",
          startTime: "07:30",
          endTime: "14:00",
          items: [
            "At the dock: loading, stowing, and setting up in the space you have",
            "Underway: the briefing, the roll call, and what the crew needs from you",
            "Dive 1: a giant stride entry, a descent on the line, and a ladder exit",
            "Dive 2: a back roll entry, tag line work, and an exit timed to the swell",
            "Back alongside: rinsing, unloading, and the logbook",
          ],
        },
      ],
      faqs: [
        {
          question: "I get seasick. Should I still do this?",
          answer:
            "Yes, and tell us before the day. Medication taken the night before works far better than anything you take once you already feel it, and the crew can put you where the boat moves least.",
        },
        {
          question: "Which entry will I be asked to do?",
          answer:
            "Whichever the boat's layout calls for — usually a giant stride, sometimes a back roll off a low tube. You practice both here, so neither is a surprise on somebody else's boat.",
        },
        {
          question: "Is this only useful on your boat?",
          answer:
            "No. Boats differ; the sequence does not. Stow, set up, brief, enter, dive the plan, exit, account for everyone. It transfers to a liveaboard, a panga, and a charter in a language you do not speak.",
        },
        {
          question: "Does this count toward Advanced Open Water?",
          answer:
            "Yes. The first dive credits as the Boat Adventure Dive in the Advanced Open Water Diver course, in either direction.",
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
    slug: "search-and-recovery-diver",
    version: 1,
    title: "Search and Recovery Diver",
    agency: "padi",
    description: "Four dives on finding what went over the side, and bringing it up safely.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "Find the thing, then lift it without becoming the emergency",
      overview:
        "Things go over the side of boats. The dive that follows is usually three people swimming in circles somewhere near where they think it went in.\n\nThis is four dives of doing it properly. You run the standard patterns — expanding square, U-pattern, circular line search — on a compass and on a line, and learn which one suits the visibility, the bottom, and the size of what you are hunting. Then the recovery: rigging a lift bag, filling it in stages, and sending it up without being attached to it.\n\nThe lift bag is where people get hurt, so it gets the most attention. A bag that runs away takes a diver with it if the diver is holding the line, and a bag that spills at the surface drops its load straight back down onto whatever is underneath.",
      heroImageUrl: bundledImage("FGBNMS - nurse shark (27551309652).jpg"),
      galleryPhotos: bundledGallery(
        "Grouper 2 Molasses Reef 1999.jpg",
        "Sponge 06 Molasses Reef 20230714.jpg",
      ),
      durationText: "2 days · 4 dives",
      groupSizeText: "A small group — line work needs room, and a tangled pattern teaches nothing",
      minimumAge: 12,
      // PADI's own floor for Search and Recovery is (Junior) Advanced Open
      // Water Diver, or (Junior) Open Water Diver holding Underwater
      // Navigator. The app's ladder records levels, not specialty cards, so
      // the gate above can only be the first of those two routes — say so,
      // because a diver holding the second one deserves to know the line is
      // ours rather than the agency's.
      prerequisiteNote:
        "PADI Advanced Open Water Diver or higher, and at least 12 years old. PADI also accepts an Open Water Diver holding Underwater Navigator; our system records certification levels rather than specialty cards, so if that is you, talk to us before you book — the gate is ours, not the agency's. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply.",
      includes: [
        "All PADI learning materials and certification fees",
        "Four training dives, all within {depth18}",
        "Lift bags, lines, reels, and marker floats",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "Actual salvage work, which we quote separately"],
      scheduleDays: [
        {
          title: "Day 1 — search patterns",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Knowledge review: choosing a pattern for the visibility, the bottom, and the object",
            "On land: tying the three knots you will need, until they are boring",
            "Dive 1: an expanding square search on the compass",
            "Dive 2: a circular line search, then a U-pattern along a fixed line",
          ],
        },
        {
          title: "Day 2 — recovery",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Dive 3: locating a small object, then a large one, on a planned pattern",
            "Dive 4: rigging and filling a lift bag, and a controlled ascent of the load",
            "Planning a search from what is actually known about where the object went in",
            "Debrief and certification paperwork",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need to be good with knots?",
          answer:
            "You need three of them, and you will tie them on dry land until they are dull. A bowline you can tie in gloves and bad visibility is worth more than six knots you half-remember.",
        },
        {
          question: "How heavy a load will I lift?",
          answer:
            "Deliberately not a heavy one. The skill is control rather than tonnage: a load that gets away from you is a runaway bag at the surface and a falling object underneath it.",
        },
        {
          question: "What visibility do you run this in?",
          answer:
            "Whatever the day gives us, and a murky day is good training rather than a cancelled one. Line searches exist precisely because you cannot see the object until you are on top of it.",
        },
        {
          question: "Will this help me find things people actually lose?",
          answer:
            "That is what it is for — phones, cameras, sunglasses, outboard parts, an anchor. The hard part is almost always working out where the thing went in, which is why the last dive starts on the surface with questions.",
        },
        {
          question: "Does this count toward Advanced Open Water?",
          answer:
            "Yes. The first dive credits as the Search and Recovery Adventure Dive in the Advanced Open Water Diver course, in either direction.",
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
    slug: "sidemount-diver",
    version: 1,
    title: "Sidemount Diver",
    agency: "padi",
    description: "Confined water and three dives moving your tanks off your back onto your hips.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Two tanks, nothing on your back, and a rig you can take off in the water",
      overview:
        "Sidemount came out of caves for ordinary reasons: nothing on your spine, tanks you can hand up the ladder one at a time, two independent regulators, and trim you can actually adjust.\n\nThe course is a confined-water session and three open-water dives, and most of the work is fitting the harness. Bungee tension, rail position, where the tanks sit as they empty — every diver's setup is different, and yours will be wrong for the first hour. That is normal, and it is what the pool time is for.\n\nAfter that: switching regulators on a schedule so both tanks drain evenly, valve drills you can reach, and taking the whole rig off and putting it back on in the water. You finish diving a configuration you can tune yourself, which is the real point of it.",
      heroImageUrl: bundledImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
      galleryPhotos: bundledGallery(
        "Elkhorn coral 8 Molasses Reef 20080309.jpg",
        "Blue Tang Pickles 20080310.jpg",
      ),
      durationText: "2 days · confined water plus 3 dives",
      groupSizeText: "A small group — a harness is fitted one diver at a time",
      minimumAge: 15,
      // The gate above matches PADI: Open Water Diver is the agency's own
      // floor for Sidemount Diver, and its minimum age of 15 is past the
      // Junior Open Water age band, so no junior caveat applies.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 15 years old. This is the recreational sidemount course: it is not a technical or overhead qualification, and it does not change the depth limit your certification already carries. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Sidemount harness and two cylinders",
        "One confined-water session and three open-water dives",
        "Weights and boat",
      ],
      excludes: ["A harness or regulators of your own", "Personal gear rental"],
      scheduleDays: [
        {
          title: "Day 1 — fitting and confined water",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Knowledge review: what sidemount does, what it does not, and gas on two independent tanks",
            "Rigging: harness, bungees, and where the tanks want to sit on you",
            "Confined water: trim, regulator switches, and getting in and out of the rig",
          ],
        },
        {
          title: "Day 2 — open water",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Dive 1: trim and buoyancy on full tanks, and the first switching schedule",
            "Dive 2: valve and regulator drills, and removing one tank underwater",
            "Dive 3: an ordinary dive in the configuration, then a look at how your gas balanced",
          ],
        },
      ],
      faqs: [
        {
          question: "Is sidemount only for cave divers?",
          answer:
            "No. It came from caves, but plenty of divers use it on ordinary reefs for the trim, the back, and the redundancy. This is the recreational course; overhead environments are a separate qualification.",
        },
        {
          question: "Does this let me dive deeper?",
          answer:
            "No. Two tanks are more gas and a second regulator, not a higher certification. Your depth limit stays the one your certification already gives you.",
        },
        {
          question: "I have a bad back. Will this help?",
          answer:
            "Often, yes — you carry two tanks separately rather than one on your spine, and you can clip them on in the water. That is not medical advice, and a back problem is one of the things the medical questionnaire asks about.",
        },
        {
          question: "Do I need to buy the gear?",
          answer:
            "Not for the course; the harness and cylinders are ours. If you buy afterwards, get fitted rather than ordering by size — sidemount is a rig you tune to your own body.",
        },
        {
          question: "Does this count toward Advanced Open Water?",
          answer:
            "Yes. The first dive credits as the Sidemount Adventure Dive in the Advanced Open Water Diver course, in either direction.",
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
    slug: "fish-identification",
    version: 1,
    title: "Fish Identification",
    agency: "padi",
    description: "Two dives learning to name what you have been swimming past.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Learn the families first, and the reef stops being a blur",
      overview:
        "Divers who can name fish have better dives — not because naming is the point, but because you stop scanning and start looking, and the reef fills up with animals that were there the whole time.\n\nThe trick is families rather than species. There are far fewer body shapes than there are fish, so once you can tell a grunt from a snapper by outline alone, a field guide stops being a thousand photographs and becomes a short list. Two dives, a slate, and a guide are enough to make that click.\n\nWe teach the fish that actually live here, and you record what you see: what it was, how many, and where on the reef it was. Those notes are worth keeping — a good deal of what is known about reef populations was written down by divers doing exactly this.",
      heroImageUrl: bundledImage("Blue Tangs Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Molasses Reef 20080309.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "1 day · 2 dives",
      groupSizeText: "A small group, so a guide is shared between two divers rather than six",
      minimumAge: 10,
      // The gate above matches PADI: (Junior) Open Water Diver is the agency's
      // own floor for Fish Identification, minimum age 10.
      prerequisiteNote:
        "PADI Open Water Diver or higher, from PADI or another agency, and at least 10 years old. Divers aged 10–11 take it as Junior Open Water Divers and keep their {depth12} depth limit and supervision requirements. You will complete a medical questionnaire before the course; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All PADI learning materials and certification fees",
        "Two training dives",
        "Slates and a local field guide to borrow",
        "Tanks, weights, and boat",
      ],
      excludes: ["Personal gear rental", "A field guide of your own"],
      scheduleDays: [
        {
          title: "Course day",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Classroom: families and body shapes, and the local look-alikes that catch people out",
            "Dive 1: a slow swim on a shallow reef, recording what you see as you see it",
            "Surface interval: working your notes against the guide, together",
            "Dive 2: a second habitat — sand, wall, or patch reef — and how the cast changes",
            "Writing the day up, and how to submit a survey record if you want to",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need to memorise Latin names?",
          answer:
            "No. You need to recognise about a dozen families by shape; species names follow from there, and the guide does the rest of the work.",
        },
        {
          question: "Is this only useful here?",
          answer:
            "The families travel even though the species do not. Learn the shapes here and you will be reading a guide in the Pacific rather than starting over.",
        },
        {
          question: "What if my buoyancy is still shaky?",
          answer:
            "This is a slow, shallow dive spent hovering and watching, which makes it a kind specialty to take early. It tends to improve your buoyancy rather than test it.",
        },
        {
          question: "Do I need a camera?",
          answer:
            "No, and a slate is often better. A sketch you made underwater beats a photo of a fish that swam off, because you had to look at the fish to draw it.",
        },
        {
          question: "Does this count toward Advanced Open Water?",
          answer:
            "Yes. The first dive credits as the Fish Identification Adventure Dive in the Advanced Open Water Diver course, in either direction.",
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
      galleryPhotos: bundledGallery(
        "Elkhorn coral 8 Molasses Reef 20080309.jpg",
        "French Angelfish Pickles Reef 20230713.jpg",
      ),
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
          timeNote: "week 1–2",
          items: [
            "Knowledge development and the Divemaster exams",
            "Watermanship: swim, snorkel, tread, and tired-diver tow, scored not pass-fail",
            "Rescue assessment — Rescue Exercise 7, unresponsive diver at the surface",
            "Dive Skills Workshop: all 24 skills, demonstration quality",
          ],
        },
        {
          title: "Phase 2 — practical application",
          timeNote: "week 2–4",
          items: [
            "Dive site setup and management workshop",
            "Mapping project on a site we actually run",
            "Deep and search-and-recovery scenarios",
            "Skin diver and snorkeling supervision workshop",
          ],
        },
        {
          title: "Phase 3 — internship",
          timeNote: "week 4 onward",
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
            "Four to eight weeks for most candidates, longer if you are working around a job. The program is performance-based, so the timeline follows the skills: you finish when you are ready to lead a safe, confident dive for customers.",
        },
        {
          question: "Is Divemaster the same as instructor?",
          answer:
            "No. Divemaster supervises and assists; it does not certify students. Instructor Development Course is the next step, and Divemaster is its prerequisite.",
        },
      ],
    },
  },
  {
    slug: "dry-suit-diver",
    version: 1,
    title: "Dry Suit Diver",
    agency: "padi",
    description: "Stay warm and comfortable diving in colder water with a dry suit.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Dive warm in colder waters and extend your dive season",
      overview:
        "Diving in cold water opens up kelp forests, cold-water wrecks, and year-round diving without shivering. A dry suit seals water out completely, keeping you warm with an insulating layer of air and thermal undergarments.\n\nIn this course, you will learn how to choose the right dry suit and undergarments, master dry suit buoyancy control using both your suit and BCD, handle dry suit emergencies, and perform routine maintenance and care.\n\nYou will complete one confined water session to get comfortable with suit inflation, deflation, and buoyancy skills, followed by two open water training dives.",
      heroImageUrl: bundledImage("Brain coral 2 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Sponge 06 Molasses Reef 20230714.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "1–2 days · 1 confined water session + 2 dives",
      groupSizeText: "Small groups for dedicated instructor attention",
      minimumAge: 10,
      prerequisiteNote:
        "PADI (Junior) Open Water Diver or higher, at least 10 years old. You will complete a medical questionnaire before the course; some answers require a physician sign-off before diving.",
      includes: [
        "All PADI learning materials and certification fees",
        "Confined water training session",
        "Two open water training dives",
        "Tanks, weights, and air fills",
      ],
      excludes: ["Dry suit rental or purchase", "Undergarments", "Personal dive gear rental"],
      scheduleDays: [
        {
          title: "Day 1: Theory & Confined Water",
          startTime: "09:00",
          endTime: "15:00",
          items: [
            "Dry suit anatomy, valves, seals, and undergarment selection",
            "Pool or confined water session: buoyancy, roll recovery, and valve drills",
          ],
        },
        {
          title: "Day 2: Open Water Dives",
          startTime: "08:30",
          endTime: "14:30",
          items: [
            "Dive 1: Weight check, controlled descent, trim, and buoyancy adjustment",
            "Dive 2: Scenario practice, disconnection drill, and safe ascent",
          ],
        },
      ],
      faqs: [
        {
          question: "Is diving in a dry suit difficult?",
          answer:
            "It requires learning an additional buoyancy volume to manage, but with proper instruction in confined water first, most divers become comfortable quickly.",
        },
        {
          question: "Do I need to own a dry suit?",
          answer:
            "Many shops offer dry suit rentals for the course or can help you fit and purchase one. Check with us for rental availability in your size.",
        },
      ],
    },
  },
  {
    slug: "emergency-oxygen-provider",
    version: 1,
    title: "Emergency Oxygen Provider",
    agency: "padi",
    description: "Learn how to recognize dive emergencies and administer emergency oxygen.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "Recognize dive illnesses and provide life-saving oxygen support",
      overview:
        "Knowing how and when to administer emergency oxygen is a vital safety skill for divers and boaters. Emergency oxygen is the primary first aid given for decompression illness, lung overexpansion injuries, and near-drowning.\n\nIn this dry classroom course, you will learn the signs and symptoms of decompression sickness and arterial gas embolism, how to assemble and disassemble emergency oxygen units, and how to use non-rebreather masks and demand valves on breathing and non-breathing divers.\n\nThere are no in-water requirements, making this course ideal for divers, boat crew, dive buddies, and non-diving family members.",
      heroImageUrl: bundledImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Molasses Reef 20080309.jpg",
        "Yellowtail Snappers Molasses Reef 1999.jpg",
      ),
      durationText: "Half day (dry course, no dives)",
      groupSizeText: "Interactive small-group classroom workshops",
      minimumAge: null,
      prerequisiteNote:
        "No dive certification or minimum age required. Open to divers, boat captains, and non-divers alike.",
      includes: [
        "PADI Emergency Oxygen Provider manual or eLearning",
        "Hands-on equipment practice with oxygen systems and masks",
        "PADI certification card processing",
      ],
      excludes: ["Personal first aid kit", "Pocket mask"],
      scheduleDays: [
        {
          title: "Course Workshop",
          startTime: "09:00",
          endTime: "13:00",
          items: [
            "Decompression illness overview and indications for emergency oxygen",
            "Oxygen equipment components, safety precautions, and maintenance",
            "Practical skills: demand valve setup, non-rebreather mask, and resuscitation mask",
          ],
        },
      ],
      faqs: [
        {
          question: "Are there any pool or open water dives?",
          answer:
            "No, this is a completely dry classroom and practical workshop course. No swimming or diving is involved.",
        },
        {
          question: "Can non-divers take this course?",
          answer:
            "Yes! Anyone who spends time around divers, boats, or water sports can take and benefit from this course.",
        },
      ],
    },
  },
  {
    slug: "equipment-specialist",
    version: 1,
    title: "Equipment Specialist",
    agency: "padi",
    description: "Understand how your dive gear works and how to maintain and care for it.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Master gear maintenance, field repairs, and equipment principles",
      overview:
        "Don't miss a dive due to a minor gear glitch or missing O-ring. The Equipment Specialist course teaches you how your scuba gear works, routine maintenance procedures, and how to make basic field repairs.\n\nYou will learn the theory and operation of regulators, cylinder valves, BCDs, and dive computers. Through hands-on workshops, you will inspect equipment, replace common wear parts, and understand proper storage and cleaning techniques.\n\nWhile this course does not certify you as an authorized service technician, it gives you the confidence to maintain your own gear and troubleshoot common issues at the dive site.",
      heroImageUrl: bundledImage("Sponge 06 Molasses Reef 20230714.jpg"),
      galleryPhotos: bundledGallery(
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "1 day (dry workshop)",
      groupSizeText: "Hands-on workbench sessions",
      minimumAge: 10,
      prerequisiteNote:
        "PADI (Junior) Scuba Diver or higher certification and at least 10 years old.",
      includes: [
        "PADI Equipment Specialist eLearning or manual",
        "Hands-on workshop with workshop tools and demonstration units",
        "PADI certification card processing",
      ],
      excludes: ["Personal save-a-dive kit supplies", "Manufacturer service kits"],
      scheduleDays: [
        {
          title: "Workshop Day",
          startTime: "09:00",
          endTime: "16:00",
          items: [
            "Regulator stages, balanced vs unbalanced designs, and piston vs diaphragm systems",
            "Cylinder inspection standards, valves, burst disks, and hydrostatic testing",
            "BCD care, inflator overhaul demonstrations, and leak testing",
            "Hands-on field repair exercises: O-rings, mouthpieces, and fin straps",
          ],
        },
      ],
      faqs: [
        {
          question: "Will I be certified to service other people's regulators?",
          answer:
            "No. Factory service certifications are issued by equipment manufacturers. This course focuses on diver maintenance, inspection, and field troubleshooting.",
        },
      ],
    },
  },
  {
    slug: "underwater-naturalist",
    version: 1,
    title: "Underwater Naturalist",
    agency: "padi",
    description: "Look past the big animals to see the interactions and ecosystems of the reef.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "See aquatic life through an ecological and behavioural lens",
      overview:
        "Instead of just seeing a fish or a coral head, learn to see the complex relationships that make underwater ecosystems thrive. The Underwater Naturalist course teaches you to identify groupings of marine organisms, understand symbiotic relationships, and observe behavior without disturbing aquatic life.\n\nYou will learn the major aquatic life groupings, food chains, habitats, and the role divers play in preserving fragile underwater environments.\n\nAcross two open water dives, you will observe symbiotic relationships, practice non-destructive diving techniques, and identify organisms and their habitats.",
      heroImageUrl: bundledImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Pickles Reef 20230713.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "1 day · 2 dives",
      groupSizeText: "Small groups focused on guided reef observation",
      minimumAge: 10,
      prerequisiteNote:
        "PADI (Junior) Open Water Diver or higher, at least 10 years old. Medical questionnaire required.",
      includes: [
        "PADI learning materials and certification fee",
        "Two open water naturalist training dives",
        "Underwater slates and identification guides",
        "Tanks and weights",
      ],
      excludes: ["Personal gear rental"],
      scheduleDays: [
        {
          title: "Naturalist Day",
          startTime: "08:30",
          endTime: "15:00",
          items: [
            "Briefing: aquatic ecosystems, symbiosis, predator-prey relationships, and conservation",
            "Dive 1: Identifying plant and invertebrate groupings and mutualistic relationships",
            "Surface debrief: comparing observations and referencing identification slates",
            "Dive 2: Vertebrate behaviors, feeding strategies, and camouflage",
          ],
        },
      ],
      faqs: [
        {
          question: "How is this different from Fish Identification?",
          answer:
            "Fish Identification focuses on identifying species and families. Underwater Naturalist looks broader at entire marine ecosystems, food webs, invertebrates, and symbiosis.",
        },
      ],
    },
  },
  {
    slug: "ssi-try-scuba",
    version: 1,
    title: "Try Scuba",
    agency: "ssi",
    description:
      "Your first taste of breathing underwater under the direct care of an SSI instructor.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      isIntroCourse: true,
      summary:
        "Experience scuba diving for the first time in confined water with an SSI instructor",
      overview:
        "SSI Try Scuba is your introduction to the underwater world. Under the direct supervision of an SSI professional, you will learn the basic safety guidelines and skills needed to dive.\n\nYou will experience what it feels like to breathe underwater in a pool or calm confined water environment. Your instructor will guide you step by step through equipment familiarization and fundamental diving skills.\n\nIf you decide to continue your dive education, your Try Scuba experience can be credited toward your SSI Scuba Diver or Open Water Diver certification.",
      heroImageUrl: bundledImage("French Angelfish Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "Blue Tang Pickles 20080310.jpg",
      ),
      durationText: "Half day (approx. 3–4 hours)",
      groupSizeText: "Direct 1:1 or small group instructor supervision",
      minimumAge: 8,
      prerequisiteNote:
        "Minimum age 8 years old for pool/confined water (10 for optional open water dive). No prior diving experience needed. Medical questionnaire required before entering the water.",
      includes: [
        "SSI digital recognition card and learning materials",
        "Full scuba equipment rental",
        "Pool or confined water session with an SSI instructor",
      ],
      excludes: ["Swimwear and towel", "Optional open water add-on dive"],
      scheduleDays: [
        {
          title: "Try Scuba Session",
          startTime: "09:00",
          endTime: "13:00",
          items: [
            "Briefing: equipment overview, equalizing, breathing rules, and underwater hand signals",
            "Gear fit and pool/confined water entry",
            "First breaths underwater, regulator clearing, and mask clearing practice",
            "Fun swim and buoyancy practice under direct instructor supervision",
          ],
        },
      ],
      faqs: [
        {
          question: "Is Try Scuba a certification?",
          answer:
            "No, it is a non-certification introductory experience. However, the skills you learn can count toward your SSI Open Water Diver course.",
        },
      ],
    },
  },
  {
    slug: "ssi-open-water-diver",
    version: 1,
    title: "Open Water Diver",
    agency: "ssi",
    description: "The globally recognized SSI certification to dive independently with a buddy.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "Earn your worldwide lifetime scuba certification to dive to {depth18}",
      overview:
        "The SSI Open Water Diver program is your gateway to exploring the ocean worldwide. Through digital learning, pool training, and open water dives, you will gain the knowledge and skills necessary to dive safely to {depth18} with a certified buddy.\n\nSSI's training methodology focuses on comfort through repetition. You will master equipment assembly, mask clearing, regulator recovery, buoyancy control, and emergency procedures in confined water before completing four open water training dives.\n\nUpon graduation, your digital certification is recognized internationally with no expiration.",
      heroImageUrl: bundledImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Yellowtail Snappers Molasses Reef 1999.jpg",
        "FGBNMS - nurse shark (27551309652).jpg",
      ),
      durationText: "3–4 days · 6 confined sessions + 4 open water dives",
      groupSizeText: "Small student-to-instructor ratio for safety and comfort",
      minimumAge: 10,
      prerequisiteNote:
        "Minimum age 10 years old (certified as Junior Open Water Diver until age 15). Ability to swim 200-meter/yard continuously and float/tread water for 10 minutes. Medical questionnaire required.",
      includes: [
        "SSI digital learning kit, video, and lifetime digital certification card",
        "Confined water pool training sessions",
        "Four open water training dives",
        "Tanks, weights, and full gear rental during the course",
        "Logbook integration via the MySSI app",
      ],
      excludes: ["Personal mask and snorkel (recommended)", "Transportation to dive sites"],
      scheduleDays: [
        {
          title: "Day 1: Academics & Pool Training",
          startTime: "08:30",
          endTime: "16:00",
          items: [
            "Academic review and digital exam",
            "Equipment assembly, disassembly, and pre-dive safety checks",
            "Confined water skills: breathing, regulator clearing, and mask clearing",
          ],
        },
        {
          title: "Day 2: Pool Mastery & Gear Drills",
          startTime: "08:30",
          endTime: "15:30",
          items: [
            "Neutral buoyancy, fin pivots, and hover practice",
            "Emergency out-of-air drills, alternate air source sharing, and emergency ascents",
            "200-meter/yard swim test and 10-minute water survival float",
          ],
        },
        {
          title: "Day 3: Open Water Dives 1 & 2",
          startTime: "08:00",
          endTime: "14:00",
          items: [
            "Dive 1: Descent to {depth12}, buoyancy adjustment, and guided exploration",
            "Dive 2: Mask removal and replacement, regulator recovery, and controlled ascent",
          ],
        },
        {
          title: "Day 4: Open Water Dives 3 & 4 & Certification",
          startTime: "08:00",
          endTime: "14:00",
          items: [
            "Dive 3: Descent to {depth18}, buoyancy hover, and buddy towing",
            "Dive 4: Student-led dive planning, underwater navigation, and graduation",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep can I dive after graduating?",
          answer:
            "SSI Open Water Divers aged 15 and older are qualified to dive to {depth18}. Divers aged 10–11 have a maximum depth of {depth12}, and ages 12–14 can dive to {depth18} with an adult certified diver.",
        },
        {
          question: "Does the certification expire?",
          answer:
            "No, your SSI Open Water Diver certification is valid for life. If you have been inactive for an extended period, a Scuba Skills Update is recommended.",
        },
      ],
    },
  },
  {
    slug: "ssi-advanced-adventurer",
    version: 1,
    title: "Advanced Adventurer",
    agency: "ssi",
    description: "Sample five different specialty areas and expand your depth to {depth30}.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary:
        "Try 5 specialty dives, increase your depth limit to {depth30}, and sharpen your skills",
      overview:
        "If you want to explore new diving styles and go deeper, the SSI Advanced Adventurer program allows you to sample five different SSI specialty dive programs without committing to the full specialty certifications.\n\nYou will complete five adventure dives, including mandatory Deep Diving (down to {depth30}) and Underwater Navigation dives, plus three elective dives such as Perfect Buoyancy, Night/Limited Visibility, or Wreck Diving.\n\nEach dive credits toward its corresponding full SSI specialty certification if you choose to pursue it later.",
      heroImageUrl: bundledImage("Blue Tang Pickles 20080310.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Pickles Reef 20230713.jpg",
        "Sponge 06 Molasses Reef 20230714.jpg",
      ),
      durationText: "2–3 days · 5 adventure dives",
      groupSizeText: "Small groups tailored to specialty exploration",
      minimumAge: 10,
      prerequisiteNote:
        "SSI Open Water Diver or equivalent from a recognized agency. Minimum age 10 years old for shallow electives (12 years old for Deep Diving to {depth21}, 15 years old for {depth30}).",
      includes: [
        "SSI digital learning materials and certification card",
        "Five specialty adventure dives",
        "Tanks, weights, and air fills",
      ],
      excludes: ["Personal gear rental", "Specialty equipment rentals (torches, compasses, etc.)"],
      scheduleDays: [
        {
          title: "Day 1: Navigation & Buoyancy",
          startTime: "08:30",
          endTime: "15:00",
          items: [
            "Briefing on specialty topics and dive planning",
            "Dive 1: Underwater Navigation (compass headings, reciprocal courses, natural cues)",
            "Dive 2: Perfect Buoyancy (trim optimization, fin kicks, hovering)",
          ],
        },
        {
          title: "Day 2: Deep Dive & Electives",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Dive 3: Deep Diving (descent to {depth30}, nitrogen awareness, air consumption)",
            "Dive 4: Boat Diving or Fish Identification",
            "Dive 5: Wreck Diving or Night/Limited Visibility",
          ],
        },
      ],
      faqs: [
        {
          question: "Does this certify me as a Deep Diver?",
          answer:
            "No, it certifies you as an Advanced Adventurer with a {depth30} depth limit. To earn the full Deep Diving specialty (to {depth40}), you can complete the remaining dives in the Deep specialty program.",
        },
      ],
    },
  },
  {
    slug: "ssi-diver-stress-and-rescue",
    version: 1,
    title: "Diver Stress & Rescue",
    agency: "ssi",
    description: "Learn to prevent, recognize, and manage stress and diving emergencies.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Build confidence by learning to prevent problems and manage dive emergencies",
      overview:
        "Stress is a major contributor to diving accidents. The SSI Diver Stress & Rescue program provides you with the skills and knowledge required to recognize stress, prevent accidents, and respond effectively in emergency situations.\n\nYou will learn how to identify stress in yourself and other divers, manage panic, perform diver rescues from depth and at the surface, administer in-water rescue breaths, and coordinate emergency response procedures.\n\nMost divers find this course challenging, rewarding, and the single most confidence-building program in recreational diving.",
      heroImageUrl: bundledImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
      galleryPhotos: bundledGallery(
        "AtlanticGoliathGrouper.jpg",
        "Brain coral 2 Molasses Reef 20080309.jpg",
      ),
      durationText: "3 days · Pool sessions + Open water scenarios",
      groupSizeText: "Scenario teams with direct instructor safety oversight",
      minimumAge: 12,
      prerequisiteNote:
        "Open Water Diver certification and current First Aid / CPR / Oxygen provider training (such as SSI React Right). Minimum age 12 years old.",
      includes: [
        "SSI digital learning kit and certification fee",
        "Pool and confined water rescue skill sessions",
        "Open water rescue scenarios",
        "Tanks and weights",
      ],
      excludes: ["Pocket mask", "First aid / CPR certification (can be taken concurrently)"],
      scheduleDays: [
        {
          title: "Day 1: Self-Rescue & Stress Management",
          startTime: "09:00",
          endTime: "16:00",
          items: [
            "Psychology of stress, panic triggers, and early intervention",
            "Pool session: self-rescue, cramp release, tired diver tows, and panicking diver defense",
          ],
        },
        {
          title: "Day 2: Rescue Techniques & Missing Diver Search",
          startTime: "08:30",
          endTime: "15:30",
          items: [
            "Surfacing an unresponsive diver from depth, controlled buoyant ascents",
            "Surface artificial respiration, gear stripping, and exit techniques",
            "Underwater search patterns for missing divers",
          ],
        },
        {
          title: "Day 3: Open Water Rescue Scenarios",
          startTime: "08:30",
          endTime: "15:00",
          items: [
            "Scenario 1: Unresponsive diver at depth and surface rescue with in-water rescue breaths",
            "Scenario 2: Distressed and panicking diver management at surface and boat exit",
            "Emergency action plan debriefing and graduation",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need CPR and first aid training first?",
          answer:
            "Yes. You must hold current CPR and First Aid certifications (within 24 months). SSI React Right can be completed alongside this course.",
        },
      ],
    },
  },
  {
    slug: "ssi-scuba-skills-update",
    version: 1,
    title: "Scuba Skills Update",
    agency: "ssi",
    description: "A quick, comprehensive refresher to get your dive skills sharp and comfortable.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Refresh your knowledge, gear handling, and in-water skills before your next dive",
      overview:
        "If it has been several months or years since your last dive, the SSI Scuba Skills Update is the best way to regain your confidence and comfort in the water.\n\nWith an SSI professional, you will review dive planning, safe diving rules, and gear assembly. In a pool or calm confined water environment, you will practice fundamental skills including mask clearing, buoyancy control, and emergency procedures.\n\nAn optional open water dive can be added to put your refreshed skills into practice on the reef.",
      heroImageUrl: bundledImage("Grouper 2 Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Pickles Reef 20230713.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "Half day (approx. 3–4 hours)",
      groupSizeText: "Relaxed, supportive small-group environment",
      minimumAge: 10,
      prerequisiteNote:
        "Open Water Diver certification or higher from any recognized agency. Medical questionnaire required.",
      includes: [
        "SSI digital skills update completion sticker / digital record",
        "Classroom / briefing review",
        "Confined water pool session",
        "Full scuba equipment rental",
      ],
      excludes: ["Optional open water boat dive"],
      scheduleDays: [
        {
          title: "Refresher Session",
          startTime: "09:00",
          endTime: "13:00",
          items: [
            "Equipment assembly, safety checks, and dive table / computer review",
            "Pool session: mask skills, regulator recovery, trim, and buoyancy hover",
            "Emergency procedures review and MySSI logbook update",
          ],
        },
      ],
      faqs: [
        {
          question: "Will I get a new certification card?",
          answer:
            "You will receive an official digital Scuba Skills Update recognition card in your MySSI app confirming your refresher.",
        },
      ],
    },
  },
  {
    slug: "ssi-perfect-buoyancy",
    version: 1,
    title: "Perfect Buoyancy",
    agency: "ssi",
    description: "Master trim, reduce air consumption, and hover effortlessly in any position.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Perfect your weighting, trim, and fin kicks to float weightlessly",
      overview:
        "Good buoyancy control is what separates an average diver from a great diver. The SSI Perfect Buoyancy specialty program teaches you how to optimize your weighting, balance your gear, and master specialized finning techniques.\n\nYou will learn the principles of buoyancy and trim, how to determine exact weighting requirements, and practice advanced kicks such as the frog kick and helicopter turn.\n\nWith two in-water training sessions, you will dramatically reduce your air consumption, protect delicate marine life, and prolong your dive times.",
      heroImageUrl: bundledImage("Blue Tangs Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "Elkhorn coral 8 Molasses Reef 20080309.jpg",
      ),
      durationText: "1 day · 2 dives (or pool + 1 dive)",
      groupSizeText: "Small groups with personalized trim adjustments",
      minimumAge: 10,
      prerequisiteNote:
        "SSI Open Water Diver or higher certification, at least 10 years old. Medical questionnaire required.",
      includes: [
        "SSI digital learning kit and certification card",
        "Two buoyancy training sessions / dives",
        "Tanks and weights for weighting optimization",
      ],
      excludes: ["Personal gear rental"],
      scheduleDays: [
        {
          title: "Buoyancy Workshop",
          startTime: "09:00",
          endTime: "15:00",
          items: [
            "Weighting calculations, weight distribution, and cylinder buoyancy characteristics",
            "Dive 1: Exact buoyancy check, trim adjustments, and horizontal body positioning",
            "Dive 2: Obstacle courses, hovering at various depths, and propulsion techniques",
          ],
        },
      ],
      faqs: [
        {
          question: "Will this help me use less air?",
          answer:
            "Yes! Being properly weighted and swimming horizontally in trim significantly reduces drag and exertion, resulting in lower gas consumption.",
        },
      ],
    },
  },
  {
    slug: "ssi-deep-diving",
    version: 1,
    title: "Deep Diving",
    agency: "ssi",
    description: "Learn the procedures and safety protocols for diving to {depth40}.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Safely explore deeper reefs and wrecks down to {depth40}",
      overview:
        "Many of the most exciting dive sites — deep drop-offs, pinnacles, and historic shipwrecks — lie below {depth18}. The SSI Deep Diving specialty prepares you to plan and execute dives to a maximum recreational depth of {depth40}.\n\nYou will study deep dive planning, gas management, decompression theory, nitrogen narcosis recognition, and safety stop / emergency decompression procedures.\n\nAcross three open water training dives, you will experience the effects of depth, practice emergency gas sharing at depth, and navigate deep environments with confidence.",
      heroImageUrl: bundledImage("French Angelfish Pickles Reef 20230713.jpg"),
      galleryPhotos: bundledGallery(
        "FKNMS - Goliath Grouper With Remora (27094933605).jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "2 days · 3 deep training dives",
      groupSizeText: "Small student-to-instructor ratios for deep dive monitoring",
      minimumAge: 15,
      prerequisiteNote:
        "Open Water Diver certification from a recognized agency. Minimum age 15 years old. Medical questionnaire required.",
      includes: [
        "SSI digital learning materials and certification card",
        "Three deep training dives ({depth30} to {depth40})",
        "Tanks and weights",
      ],
      excludes: ["Personal dive computer (required for all deep dives)", "Dive light rental"],
      scheduleDays: [
        {
          title: "Day 1: Deep Planning & Dives 1-2",
          startTime: "08:30",
          endTime: "15:00",
          items: [
            "Deep dive physiology, narcosis management, gas consumption rules",
            "Dive 1: Descent to {depth30}, computer comparison, and color loss exercise",
            "Dive 2: Navigation at {depth30n}–{depth30}, gas supply management",
          ],
        },
        {
          title: "Day 2: Deep Dive 3 & Graduation",
          startTime: "08:30",
          endTime: "14:00",
          items: [
            "Dive 3: Deep dive to {depth40}, simulated emergency decompression stop, and ascent",
            "Debriefing and certification logging",
          ],
        },
      ],
      faqs: [
        {
          question: "What is the maximum depth I can dive after this course?",
          answer:
            "This course certifies you to dive to the recreational maximum limit of {depth40} with a certified dive buddy.",
        },
      ],
    },
  },
  {
    slug: "ssi-navigation",
    version: 1,
    title: "Navigation",
    agency: "ssi",
    description:
      "Learn to navigate underwater using compass headings, natural references, and patterns.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Never get lost on a dive: master compass work, patterns, and natural navigation",
      overview:
        "Underwater navigation is the skill that turns an anxious dive into a relaxed exploration. The SSI Navigation specialty teaches you how to use a compass and natural underwater references to always know where you are and how to return to the boat or shore.\n\nYou will learn to measure distance underwater through kick cycles and elapsed time, navigate complex search patterns, and compensate for currents.\n\nAcross two open water dives, you will navigate compass courses, practice square and triangle search patterns, and successfully navigate back to your starting point.",
      heroImageUrl: bundledImage("Brain coral 2 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Blue Tang Pickles 20080310.jpg",
        "Yellowtail Snappers Molasses Reef 1999.jpg",
      ),
      durationText: "1–2 days · 2 open water dives",
      groupSizeText: "Buddy-pair focused navigation challenges",
      minimumAge: 10,
      prerequisiteNote:
        "SSI (Junior) Open Water Diver or higher certification, at least 10 years old.",
      includes: [
        "SSI digital learning kit and certification card",
        "Two navigation training dives",
        "Tanks and weights",
      ],
      excludes: ["Underwater compass rental or purchase", "Personal gear rental"],
      scheduleDays: [
        {
          title: "Navigation Day",
          startTime: "08:30",
          endTime: "15:00",
          items: [
            "Compass mechanics, natural navigation indicators, and search pattern planning",
            "Dive 1: Reciprocal heading navigation, kick cycle calibration, and natural landmarks",
            "Dive 2: Square and triangle multi-leg compass patterns and relocation exercises",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need my own compass?",
          answer:
            "We have compasses available for course use and recommend owning one as part of your core dive kit.",
        },
      ],
    },
  },
  {
    slug: "ssi-photo-and-video",
    version: 1,
    title: "Photo & Video",
    agency: "ssi",
    description:
      "Learn underwater photography and videography techniques to capture stunning imagery.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Capture crisp, colorful underwater photos and video without harming the reef",
      overview:
        "Underwater photography and videography allow you to share the beauty of the ocean with friends and family. The SSI Photo & Video program teaches you the techniques needed to take great digital photos and video underwater.\n\nYou will learn camera system preparation, housing maintenance, strobe and video light positioning, composition, and white balance settings in aquatic environments.\n\nAcross two training dives, you will practice capturing macro and wide-angle subjects while maintaining neutral buoyancy and reef-safe diving habits.",
      heroImageUrl: bundledImage("French Angelfish Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Pickles Reef 20230713.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "1–2 days · 2 dives",
      groupSizeText: "Small groups with individual image critique",
      minimumAge: 10,
      prerequisiteNote:
        "Open Water Diver certification from a recognized agency. Minimum age 10 years old.",
      includes: [
        "SSI digital learning kit and certification card",
        "Two photography training dives",
        "Tanks and weights",
        "Post-dive photo analysis workshop",
      ],
      excludes: ["Camera and housing rental", "Memory cards", "Editing software"],
      scheduleDays: [
        {
          title: "Photo Workshop Day",
          startTime: "08:30",
          endTime: "15:30",
          items: [
            "Camera setup, housing O-ring care, strobe positioning, and underwater optics",
            "Dive 1: Neutral buoyancy shooting, color correction, and wide-angle composition",
            "Dive 2: Close-up and macro photography techniques",
            "Post-dive workflow, editing tips, and image critique",
          ],
        },
      ],
      faqs: [
        {
          question: "Can I use an action camera like a GoPro?",
          answer:
            "Yes! You can use action cameras, compact cameras, or mirrorless/DSLR systems in this course.",
        },
      ],
    },
  },
  {
    slug: "ssi-marine-ecology",
    version: 1,
    title: "Marine Ecology",
    agency: "ssi",
    description:
      "Explore the complex relationships between marine organisms and their ocean habitats.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "Understand ocean ecosystems, coral reefs, and marine conservation",
      overview:
        "The oceans are home to incredible biodiversity and complex ecological systems. The SSI Marine Ecology specialty provides an in-depth look at the science of ocean life and the challenges facing marine environments today.\n\nYou will explore marine ecosystems, ocean food webs, coral reef biology, coastal habitats, and human impacts on the oceans. You will learn practical ways divers and ocean lovers can protect marine life.\n\nThis is a knowledge-based program that can be completed with or without optional open water experience dives.",
      heroImageUrl: bundledImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Yellowtail Snappers Molasses Reef 1999.jpg",
        "Brain coral 2 Molasses Reef 20080309.jpg",
      ),
      durationText: "1 day (dry seminars + optional dives)",
      groupSizeText: "Interactive ecology discussions",
      minimumAge: 10,
      prerequisiteNote:
        "Minimum age 10 years old. Open to divers and non-divers alike. No prior certifications needed for academic completion.",
      includes: [
        "SSI digital learning materials and certification card",
        "Interactive ecology workshop and case study discussions",
      ],
      excludes: ["Optional marine ecology open water dives", "Personal dive gear"],
      scheduleDays: [
        {
          title: "Ecology Seminar",
          startTime: "09:00",
          endTime: "15:00",
          items: [
            "Marine biodiversity, ocean chemistry, and food web dynamics",
            "Coral reef ecosystems, mangrove habitats, and kelp forests",
            "Human impacts: climate change, ocean acidification, and conservation initiatives",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I have to dive to complete this specialty?",
          answer:
            "No, this specialty is an ecology and knowledge-based program. Dives are optional but highly recommended to see principles in action.",
        },
      ],
    },
  },
  {
    slug: "ssi-react-right",
    version: 1,
    title: "React Right",
    agency: "ssi",
    description:
      "Emergency First Response: CPR, First Aid, AED, and Emergency Oxygen administration.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "Learn essential CPR, first aid, and oxygen administration skills for emergencies",
      overview:
        "SSI React Right is an emergency response training program designed for divers and non-divers. You will gain the skills and confidence to act as a first responder in medical emergencies.\n\nThe program covers primary assessment, CPR and rescue breathing, Automated External Defibrillator (AED) operation, first aid and wound care, and Emergency Oxygen administration in diving emergencies.\n\nHands-on scenario practice ensures you are prepared to respond calmly and effectively during an accident.",
      heroImageUrl: bundledImage("Stoplight parrotfish Pickles Reef.jpg"),
      galleryPhotos: bundledGallery(
        "Blue Tang Pickles 20080310.jpg",
        "French Angelfish Pickles Reef 20230713.jpg",
      ),
      durationText: "1 day (dry classroom & practical skills)",
      groupSizeText: "Hands-on medical scenario training",
      minimumAge: 12,
      prerequisiteNote:
        "Minimum age 12 years old. No prior dive certification required. Open to divers and non-divers.",
      includes: [
        "SSI React Right digital learning materials and certification",
        "Practical training with CPR manikins, AED trainers, and oxygen systems",
        "First aid scenario training",
      ],
      excludes: ["Pocket mask", "Personal first aid kit"],
      scheduleDays: [
        {
          title: "React Right Workshop",
          startTime: "09:00",
          endTime: "16:30",
          items: [
            "Primary Assessment and scene safety",
            "CPR and AED practical application on adult manikins",
            "Secondary Assessment: splinting, bandaging, and shock management",
            "Oxygen administration unit setup and delivery for dive emergencies",
          ],
        },
      ],
      faqs: [
        {
          question: "Does this satisfy the prerequisite for Diver Stress & Rescue?",
          answer:
            "Yes! SSI React Right satisfies the CPR, First Aid, and Emergency Oxygen prerequisites for the SSI Diver Stress & Rescue program.",
        },
      ],
    },
  },
  {
    slug: "ssi-dive-guide",
    version: 1,
    title: "Dive Guide",
    agency: "ssi",
    description: "The first step in SSI professional leadership: learn to guide certified divers.",
    minimumCertificationLevel: "rescue",
    content: {
      ...blank,
      summary: "Step into professional diving: lead certified divers and conduct dive briefings",
      overview:
        "The SSI Dive Guide program is the foundation of the SSI Dive Professional pathway. You will learn to lead certified divers in various underwater environments and conditions.\n\nThrough practical application, dive briefings, site assessments, and in-water leadership training, you will develop the organizational and supervisory skills required of a professional dive guide.\n\nCombined with the Science of Diving specialty, the Dive Guide certification qualifies you as an SSI Divemaster.",
      heroImageUrl: bundledImage("AtlanticGoliathGrouper.jpg"),
      galleryPhotos: bundledGallery(
        "FGBNMS - nurse shark (27551309652).jpg",
        "Grouper 2 Molasses Reef 1999.jpg",
      ),
      durationText: "1–2 weeks (or internship format)",
      groupSizeText: "Professional mentorship and practical guiding",
      minimumAge: 15,
      prerequisiteNote:
        "SSI Diver Stress & Rescue (or equivalent), current CPR/First Aid/O2 certification, at least 40 logged dives to start (50 to certify), and at least 15 years old (18 for active professional status).",
      includes: [
        "SSI Dive Guide digital professional materials",
        "Leadership and group management workshops",
        "Practical guiding assessments and briefings",
        "Tanks and weights during course sessions",
      ],
      excludes: [
        "SSI professional registration and membership fees",
        "Professional liability insurance",
        "Complete personal professional dive gear",
      ],
      scheduleDays: [
        {
          title: "Week 1: Leadership & Briefings",
          startTime: "08:30",
          endTime: "16:00",
          items: [
            "The role of the Dive Guide, risk management, and legal responsibilities",
            "Dive site evaluation, weather assessment, and dive briefing preparation",
            "In-water guiding skills, group control, and problem prevention",
          ],
        },
        {
          title: "Week 2: Practical Guiding & Stamina Evaluations",
          startTime: "08:30",
          endTime: "16:00",
          items: [
            "Water fitness evaluations: swim, tread, and tired diver tow",
            "Real-world dive briefing delivery and student-led guided dives",
            "Emergency scenario management and debriefing",
          ],
        },
      ],
      faqs: [
        {
          question: "What is the difference between Dive Guide and Divemaster in SSI?",
          answer:
            "An SSI Dive Guide who also completes the SSI Science of Diving specialty earns the prestigious rating of SSI Divemaster.",
        },
      ],
    },
  },
  /* ------------------------------------------------------------------ *
   * SDI (Scuba Diving International)
   *
   * The third agency DiveDay ships starter pages for, and the one whose
   * ladder differs most from the two above it: SDI certifies to computer use
   * from the first course rather than to tables, folds nitrox in early, and
   * owns Solo Diver, which neither of the others teaches at all.
   *
   * Every rung below maps onto the four levels DiveDay can record
   * (`CertificationLevel`), and where SDI's own prerequisite is finer than
   * that — Advanced Adventure Diver is not literally "Advanced Open Water" —
   * the note says so in the shop's voice rather than quietly rounding a
   * diver up or down. Same rule the PADI entries follow for Adventure Diver
   * and Scuba Diver: the gate is ours, and a diver on the rung between is
   * told to talk to us instead of being refused by a page.
   * ------------------------------------------------------------------ */
  {
    slug: "sdi-scuba-discovery",
    version: 1,
    title: "Scuba Discovery",
    agency: "sdi",
    description: "A guided first breath underwater, with an instructor at arm's reach.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      isIntroCourse: true,
      summary: "Find out whether breathing underwater is for you, in one afternoon",
      overview:
        "SDI Scuba Discovery is not a certification. It is the session where you find out what scuba actually feels like, with an instructor beside you the whole time and nothing to pass.\n\nYou will start in shallow, confined water: how the gear works, how to clear a mask, how to get a regulator back. When you are comfortable — and only then — you can make a shallow open-water dive on the reef.\n\nIf you love it, the skills count toward your Open Water Scuba Diver course. If you do not, you have lost an afternoon and gained an answer.",
      heroImageUrl: bundledImage("Blue Tangs Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Molasses Reef 20080309.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "Half a day · about 3 hours",
      groupSizeText: "Small groups, with an instructor in the water throughout",
      minimumAge: 10,
      prerequisiteNote:
        "No certification and no experience. You will complete a medical questionnaire first; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "All scuba equipment",
        "Instructor-led confined-water session",
        "One shallow open-water dive, if you are ready for it",
      ],
      excludes: ["Photos and video", "Transport to the site"],
      scheduleDays: [
        {
          title: "Discovery session",
          startTime: "09:00",
          endTime: "12:00",
          items: [
            "Briefing: how the gear works and what the water will feel like",
            "Confined water: breathing, mask clearing, regulator recovery",
            "Optional shallow reef dive with your instructor",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep will I go?",
          answer: "No deeper than {depth12}, and only as deep as you are comfortable going.",
        },
        {
          question: "Do I get a certification card?",
          answer:
            "No — this is an experience, not a course. What you learn here can be credited toward the Open Water Scuba Diver course if you decide to carry on.",
        },
      ],
    },
  },
  {
    slug: "sdi-open-water-scuba-diver",
    version: 1,
    title: "Open Water Scuba Diver",
    agency: "sdi",
    description: "SDI's entry-level certification — computer-based from the first dive.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "Certify to dive with a buddy, worldwide, to {depth18}",
      overview:
        "SDI Open Water Scuba Diver is the certification that lets you rent gear, book a boat, and dive with a buddy anywhere in the world.\n\nWhat sets it apart from the other agencies' entry-level courses is the computer. SDI teaches dive planning on a personal dive computer from the start rather than on printed tables, because that is what you will actually use on every dive afterwards. You still learn how decompression works — you just learn it on the device that will be on your wrist.\n\nYou will cover the academics, practise the skills in confined water until they are dull, and then make four open-water dives on the reef with your instructor.",
      heroImageUrl: bundledImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "Blue Tang Pickles 20080310.jpg",
        "Sponge 06 Molasses Reef 20230714.jpg",
      ),
      durationText: "Three to four days · four open-water dives",
      groupSizeText: "Small groups, so nobody waits on the line for a turn",
      minimumAge: 10,
      prerequisiteNote:
        "No certification needed. Divers aged 10 to 14 certify as Junior Open Water Scuba Divers and dive with an adult certified diver, within shallower limits. You will need to be comfortable in the water and complete a medical questionnaire; some answers require a physician's sign-off before you can dive, so tell us early if that may apply to you.",
      includes: [
        "SDI eLearning and digital certification card",
        "All scuba equipment for the course",
        "Confined-water training sessions",
        "Four open-water training dives",
      ],
      excludes: ["Personal mask, fins and snorkel", "Transport to the site"],
      scheduleDays: [
        {
          title: "Day one — academics and confined water",
          startTime: "09:00",
          endTime: "16:00",
          items: [
            "Knowledge review with your instructor, and your dive computer set up",
            "Gear assembly, buddy checks, and entries",
            "Confined water: mask, regulator, buoyancy, and out-of-air drills",
          ],
        },
        {
          title: "Day two — first two open-water dives",
          startTime: "08:00",
          endTime: "14:00",
          items: [
            "Reef dive one: descent, buoyancy, and skills at depth",
            "Reef dive two: navigation basics and a controlled ascent",
          ],
        },
        {
          title: "Day three — final two dives and certification",
          startTime: "08:00",
          endTime: "14:00",
          items: [
            "Reef dives three and four, planned on your own computer",
            "Final skill checks and your digital card issued",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep does this certify me to dive?",
          answer:
            "{depth18}, which is where the reef life is anyway. Divers aged 10 to 14 keep a shallower limit that comes with the junior certification.",
        },
        {
          question: "Why a computer instead of tables?",
          answer:
            "Because a computer is what you will dive with. SDI teaches planning on the device you will actually use, so nothing has to be unlearned later.",
        },
      ],
    },
  },
  {
    slug: "sdi-advanced-adventure-diver",
    version: 1,
    title: "Advanced Adventure Diver",
    agency: "sdi",
    description: "Five dives that open up depth, navigation, and whatever you pick next.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Five guided dives — deep and navigation, plus three you choose",
      overview:
        "Advanced Adventure Diver is SDI's next rung, and it is deliberately not a classroom course. You dive five times with an instructor, each one the first dive of a different specialty.\n\nTwo are fixed: a deep dive, and an underwater navigation dive. The other three are yours to pick — night, wreck, drift, boat, photography, whatever this coast is good for and you are curious about.\n\nEach counts toward the full specialty if you decide to finish it later. Most divers leave this course knowing which two they want.",
      heroImageUrl: bundledImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
      galleryPhotos: bundledGallery(
        "Elkhorn coral 8 Molasses Reef 20080309.jpg",
        "Grouper 2 Molasses Reef 1999.jpg",
      ),
      durationText: "Two days · five dives",
      groupSizeText: "Small groups, matched to the electives you choose",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency — we verify the certification record before the first dive. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Five instructor-led dives",
        "Tanks and weights",
      ],
      excludes: ["Personal gear rental", "Specialty gear for some electives"],
      scheduleDays: [
        {
          title: "Day one — deep and navigation",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Deep dive: gas planning, narcosis awareness, and a real ascent profile",
            "Navigation dive: natural references, compass headings, and finding the line again",
          ],
        },
        {
          title: "Day two — your three electives",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Three dives from the specialties this coast is best at",
            "Debrief on which ones are worth finishing",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep is the deep dive?",
          answer:
            "No deeper than {depth30}, and shallower if that is where the dive is better. It is a supervised introduction to depth, not a depth record.",
        },
        {
          question: "Is this the same as Advanced Open Water?",
          answer:
            "It is SDI's equivalent rung and it is recognised as such. Our system records certification levels rather than each agency's own names, so it is stored as an advanced certification.",
        },
      ],
    },
  },
  {
    slug: "sdi-rescue-diver",
    version: 1,
    title: "Rescue Diver",
    agency: "sdi",
    description: "Spot a problem early, and know exactly what to do when you cannot.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "The course that changes how you watch everyone else on the boat",
      overview:
        "Every diver who has taken this one says the same thing: it is the course where you stop being a passenger.\n\nYou will learn to read stress before it becomes panic, to manage a tired diver on the surface, to bring up an unresponsive diver and give rescue breaths on the way to the boat, and to run the first ten minutes of an emergency while somebody else calls it in.\n\nIt is demanding and it is not a relaxing weekend. It is also the reason a crew is glad to have you aboard.",
      heroImageUrl: bundledImage("FGBNMS - nurse shark (27551309652).jpg"),
      galleryPhotos: bundledGallery(
        "Dasyatis americana NOAA.jpg",
        "French Angelfish Pickles Reef 20230713.jpg",
      ),
      durationText: "Two to three days · confined water and open-water scenarios",
      groupSizeText: "Small groups — every scenario is run by every diver",
      minimumAge: 18,
      prerequisiteNote:
        "SDI Advanced Adventure Diver or higher, or an equivalent advanced certification from another agency, plus current CPR and first-aid training — we can run that alongside if you do not hold it. That is where we set this course; if you hold a rung between Open Water and Advanced, talk to us before you book — the gate is ours, not the agency's. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Confined-water rescue skills sessions",
        "Open-water rescue scenarios",
        "Tanks, weights, and rescue equipment",
      ],
      excludes: ["CPR and first-aid certification, if you need it", "Personal gear rental"],
      scheduleDays: [
        {
          title: "Day one — self-rescue and recognition",
          startTime: "08:30",
          endTime: "16:30",
          items: [
            "Reading stress and fatigue before they become an incident",
            "Self-rescue skills and surface support for a tired diver",
            "Confined-water practice: approaches, tows, and equipment removal",
          ],
        },
        {
          title: "Day two — scenarios in open water",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Missing-diver search patterns from the boat",
            "Unresponsive diver: ascent, rescue breaths, and exit",
            "Running the first ten minutes: oxygen, handover, and what you tell the shore",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need first-aid training first?",
          answer:
            "You need current CPR and first-aid certification before the card is issued. If you do not hold one, tell us when you book and we will run it alongside the course.",
        },
      ],
    },
  },
  {
    slug: "sdi-divemaster",
    version: 1,
    title: "Divemaster",
    agency: "sdi",
    description: "The first professional rating — leading divers, not just diving with them.",
    minimumCertificationLevel: "rescue",
    content: {
      ...blank,
      summary: "Turn diving into the job: guide, supervise, and run the boat's dive day",
      overview:
        "SDI Divemaster is where diving stops being a hobby and starts being work you get paid for. It is the longest course we run and the one with the most time in the water.\n\nYou will refine your own skills until they are demonstration-quality, learn to plan and supervise dives for people who are not as comfortable as you are, run briefings that people actually remember, and handle the parts of a dive day nobody sees — the boat, the paperwork, the diver who is quietly not okay.\n\nMuch of it happens alongside our real courses and charters, because there is no substitute for doing it with actual customers.",
      heroImageUrl: bundledImage("AtlanticGoliathGrouper.jpg"),
      galleryPhotos: bundledGallery(
        "Yellowtail Snappers Molasses Reef 1999.jpg",
        "Grouper 2 Molasses Reef 1999.jpg",
      ),
      durationText: "Four to eight weeks, depending on your schedule",
      groupSizeText: "One-to-one and small-group mentoring with our instructors",
      minimumAge: 18,
      prerequisiteNote:
        "SDI Rescue Diver or an equivalent rescue certification, current CPR and first-aid training, and a logged dive history — SDI asks for 40 logged dives to begin and 60 by certification. A diving medical examination signed by a physician is required for professional-level training; talk to us early, because it can take time to arrange.",
      includes: [
        "SDI Divemaster digital materials and certification card",
        "Mentored training dives and skill circuits",
        "Supervised experience on real courses and charters",
        "Tanks and weights throughout",
      ],
      excludes: [
        "SDI professional membership and insurance",
        "Personal gear, which you will want your own of by now",
        "Diving medical examination",
      ],
      scheduleDays: [
        {
          title: "Phase one — your own diving",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Demonstration-quality skill circuit",
            "Watermanship assessments and rescue review",
            "Dive planning, gas management, and site assessment",
          ],
        },
        {
          title: "Phase two — leading other people",
          startTime: "08:00",
          endTime: "17:00",
          items: [
            "Briefings, guiding, and managing a group in current",
            "Assisting on real Open Water and continuing-education courses",
            "Boat handling, manifests, and emergency management",
          ],
        },
      ],
      faqs: [
        {
          question: "How many dives do I need?",
          answer:
            "SDI asks for 40 logged dives to start and 60 by the time you certify. If you are short, we will get you the rest during the course.",
        },
      ],
    },
  },
  {
    slug: "sdi-solo-diver",
    version: 1,
    title: "Solo Diver",
    agency: "sdi",
    description: "SDI's own course: self-reliance, redundancy, and honest self-assessment.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "Learn to be your own buddy — properly equipped and properly honest about it",
      overview:
        "SDI wrote the first recreational solo-diving course, and it is still the one the industry benchmarks against. Neither of the other agencies we teach offers an equivalent.\n\nThe course is far less about diving alone than the name suggests. It is about redundancy — a second gas supply you can actually reach, a second computer, a second cutting tool — and about the honest arithmetic of gas planning when nobody is coming to share theirs.\n\nMost divers who take it never dive alone. They take it because it makes them a substantially better buddy.",
      heroImageUrl: bundledImage("Sponge 06 Molasses Reef 20230714.jpg"),
      galleryPhotos: bundledGallery(
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "Blue Tangs Molasses Reef 1999.jpg",
      ),
      durationText: "One to two days · at least three dives",
      groupSizeText: "Very small groups — this course is mostly one-to-one",
      minimumAge: 21,
      prerequisiteNote:
        "SDI Advanced Adventure Diver or an equivalent advanced certification, and a substantial logged dive history — SDI asks for 100 logged dives. Bring your own well-fitted gear: this course is about equipment you know, and a redundant gas supply is required. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "At least three training dives",
        "Redundant gas supply for the course, if you do not own one",
      ],
      excludes: ["Personal gear rental", "Redundant computer"],
      scheduleDays: [
        {
          title: "Solo Diver",
          startTime: "08:00",
          endTime: "16:00",
          items: [
            "Gas planning without a buddy's reserve in the arithmetic",
            "Redundancy: configuring and drilling a second gas supply",
            "Dives: self-rescue, valve and regulator failures, and honest turn-pressure discipline",
          ],
        },
      ],
      faqs: [
        {
          question: "Is this course only for people who want to dive alone?",
          answer:
            "No, and most people who take it do not. The self-reliance and gas planning make you a better buddy on every dive you do with one.",
        },
      ],
    },
  },
  {
    slug: "sdi-computer-nitrox-diver",
    version: 1,
    title: "Computer Nitrox Diver",
    agency: "sdi",
    description: "Longer bottom times on enriched air, planned on your own computer.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "More time on the reef, less time on the surface waiting",
      overview:
        "Enriched air is more oxygen and less nitrogen, which means longer no-decompression limits at the depths this coast actually dives. On a two-tank morning it is often the difference between a rushed second dive and an unhurried one.\n\nSDI teaches it the way you will dive it: on a computer set for the mix, not from a second set of printed tables. You will learn what the mix does, what the oxygen limits are and why they matter, and how to analyse and log every cylinder yourself before it goes on your back.\n\nAnalysing your own gas is not a formality. It is the one check nobody else can do for you.",
      heroImageUrl: bundledImage("Blue Tang Pickles 20080310.jpg"),
      galleryPhotos: bundledGallery(
        "Stoplight parrotfish Pickles Reef.jpg",
        "French Angelfish Molasses Reef 20080309.jpg",
      ),
      durationText: "One day · academics plus two optional dives",
      groupSizeText: "Small groups around the analyser",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital materials and certification card",
        "Analyser use and cylinder logging practice",
        "Two enriched-air dives, if you take the in-water option",
      ],
      excludes: ["Enriched-air fills after the course", "Personal gear rental"],
      scheduleDays: [
        {
          title: "Computer Nitrox Diver",
          startTime: "09:00",
          endTime: "16:00",
          items: [
            "What the mix changes, and what it does not",
            "Oxygen exposure limits and the depth ceiling your mix carries",
            "Analysing, labelling and logging a cylinder — every time",
            "Setting your computer for the mix, and two dives on it",
          ],
        },
      ],
      faqs: [
        {
          question: "Does enriched air let me dive deeper?",
          answer:
            "No — the opposite. A richer mix carries a shallower ceiling because of oxygen exposure. What it buys you is time at the depths you already dive.",
        },
      ],
    },
  },
  {
    slug: "sdi-deep-diver",
    version: 1,
    title: "Deep Diver",
    agency: "sdi",
    description: "Plan, manage and enjoy the deeper end of recreational diving.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "The wrecks and walls that start where the reef stops",
      overview:
        "Below {depth30} everything changes: the light goes flat, gas disappears faster than the gauge feels like it should, and narcosis arrives quietly enough that you will not notice it without having practised noticing it.\n\nThis course is about planning for all three. Gas management with a real reserve, ascent profiles you commit to before you descend, and a frank look at how you personally behave at depth.\n\nIt is what the deeper wrecks and the outer wall require, and it is where most divers finally get honest about their air consumption.",
      heroImageUrl: bundledImage("Grouper 2 Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "AtlanticGoliathGrouper.jpg",
        "Elkhorn coral 8 Molasses Reef 20080309.jpg",
      ),
      durationText: "Two days · four dives",
      groupSizeText: "Small groups, because depth shortens everyone's dive",
      prerequisiteNote:
        "SDI Advanced Adventure Diver or an equivalent advanced certification, and enriched-air training is strongly recommended for the deeper dives. That is where we set this course; if you hold a rung between Open Water and Advanced, talk to us before you book — the gate is ours, not the agency's. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Four progressively deeper training dives",
        "Tanks, weights, and a hang line with contingency gas",
      ],
      excludes: ["Enriched-air fills", "Personal gear rental"],
      scheduleDays: [
        {
          title: "Day one — planning and the first two dives",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Gas planning, reserves, and turn pressures you actually hold to",
            "Narcosis: recognising it on yourself and on your buddy",
            "Two dives building depth with a controlled, planned ascent",
          ],
        },
        {
          title: "Day two — the deeper pair",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Two dives toward the recreational limit, with a contingency plan briefed",
            "Debrief: consumption rates, timings, and what you would change",
          ],
        },
      ],
      faqs: [
        {
          question: "How deep does this take me?",
          answer:
            "To {depth40}, the recreational limit. Past that is technical diving, which is a different training path with different gear.",
        },
      ],
    },
  },
  {
    slug: "sdi-underwater-navigation",
    version: 1,
    title: "Underwater Navigation",
    agency: "sdi",
    description: "Know where you are, and get back to the boat without surfacing to check.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Natural references, compass work, and finding the mooring line again",
      overview:
        "Navigation is the skill that quietly makes every other dive better. A diver who knows where the boat is spends the dive looking at the reef instead of at the surface.\n\nYou will learn to read the reef itself — depth contours, ripple direction, the way the light falls — and to back that up with a compass when the visibility closes in. Then you will run patterns: out and back, squares, and the search-shaped ones that matter when something is lost.\n\nBy the end you will be the one the group follows.",
      heroImageUrl: bundledImage("Brain coral 2 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Elkhorn coral 8 Molasses Reef 20080309.jpg",
        "Blue Tang Pickles 20080310.jpg",
      ),
      durationText: "One day · two dives",
      groupSizeText: "Small groups, each diver running their own patterns",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: ["SDI digital certification card", "Two navigation dives", "Compass and slate"],
      excludes: ["Personal gear rental"],
      scheduleDays: [
        {
          title: "Underwater Navigation",
          startTime: "08:30",
          endTime: "15:00",
          items: [
            "Natural navigation: contours, ripples, light, and surge direction",
            "Compass work: headings, reciprocals, and kick-cycle distance",
            "Dive one: out-and-back and square patterns",
            "Dive two: navigating to a target and returning to the line",
          ],
        },
      ],
      faqs: [
        {
          question: "Is a compass enough on its own?",
          answer:
            "Rarely. A compass gives you a heading; the reef gives you position. This course teaches both because each covers what the other misses.",
        },
      ],
    },
  },
  {
    slug: "sdi-night-limited-visibility-diver",
    version: 1,
    title: "Night & Limited Visibility Diver",
    agency: "sdi",
    description: "The same reef after dark, and the skills for water that has gone green.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "A different reef entirely, once the sun goes down",
      overview:
        "The reef changes shift at dusk. Parrotfish wrap themselves in mucus and sleep, octopus come out to hunt, and coral polyps open into something the daytime never shows you.\n\nYou will learn light discipline — where to point a torch and, more importantly, where not to — the signals that replace hand shapes in the dark, and how to stay found: with your buddy, with the group, and with the boat.\n\nThe same skills carry into limited visibility by day, which on this coast is the more common reason to need them.",
      heroImageUrl: bundledImage("Sponge 06 Molasses Reef 20230714.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Pickles Reef 20230713.jpg",
        "Stoplight parrotfish Pickles Reef.jpg",
      ),
      durationText: "Two evenings · two to three dives",
      groupSizeText: "Small groups — nobody dives out of torchlight",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Primary and backup torches",
        "Two to three dives after dark",
      ],
      excludes: ["Personal gear rental", "Photography lighting"],
      scheduleDays: [
        {
          title: "Night & Limited Visibility Diver",
          startTime: "17:00",
          endTime: "22:00",
          items: [
            "Torch handling, light signals, and marking the line and the boat",
            "Entries, descents, and staying together in the dark",
            "Dives: navigation by torchlight, and what comes out after sunset",
          ],
        },
      ],
      faqs: [
        {
          question: "What if my torch fails?",
          answer:
            "You carry a backup, and the course drills the failure before it happens. A lost light is an inconvenience you have practised, not an emergency.",
        },
      ],
    },
  },
  {
    slug: "sdi-wreck-diver",
    version: 1,
    title: "Wreck Diver",
    agency: "sdi",
    description: "Survey a wreck properly, and understand exactly where the outside ends.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "How to dive a wreck as a structure, not just swim past one",
      overview:
        "A wreck is a building that fell into the sea, and it rewards being read like one. You will learn to survey from the outside in: orientation, the current running over and around it, where the fish stack up, and which openings are as inviting as they are dangerous.\n\nThis is a recreational wreck course. It covers the hazards of overhead environments and how to recognise the line you do not cross — entanglement, silt-out, and the fact that a ceiling means the surface is no longer above you.\n\nWhat you get is the confidence to dive our wrecks well and the judgement to know what a penetration course would still require.",
      heroImageUrl: bundledImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
      galleryPhotos: bundledGallery(
        "AtlanticGoliathGrouper.jpg",
        "Yellowtail Snappers Molasses Reef 1999.jpg",
      ),
      durationText: "Two days · four dives",
      groupSizeText: "Small groups, because a wreck is easy to lose people on",
      prerequisiteNote:
        "SDI Advanced Adventure Diver or an equivalent advanced certification. That is where we set this course; if you hold a rung between Open Water and Advanced, talk to us before you book — the gate is ours, not the agency's. Our wrecks sit deep enough that deep training is worth having first. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Four wreck dives",
        "Reels, lines and lights for the course",
      ],
      excludes: ["Personal gear rental", "Enriched-air fills"],
      scheduleDays: [
        {
          title: "Day one — reading the structure",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Wreck history, orientation, and the hazards a hull collects",
            "Two dives: surveying the outside, and mapping what you found",
          ],
        },
        {
          title: "Day two — lines, silt, and judgement",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Reel and line technique, and finning that does not destroy the visibility",
            "Two dives at the openings, and an honest look at where recreational stops",
          ],
        },
      ],
      faqs: [
        {
          question: "Will I go inside the wreck?",
          answer:
            "Not beyond the light zone. This course teaches you to dive a wreck well from the outside and to understand what full penetration training would still demand of you.",
        },
      ],
    },
  },
  {
    slug: "sdi-drift-diver",
    version: 1,
    title: "Drift Diver",
    agency: "sdi",
    description: "Let the current do the work, and stay findable while it does.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "The easiest diving there is, once you stop fighting the water",
      overview:
        "A drift dive is the laziest and often the best diving on this coast: you roll in, the current carries you along the reef, and the boat follows your bubbles.\n\nThe skills are all about being findable and staying together. Entries timed to the group, buoyancy that holds a line without kicking, deploying a surface marker from depth, and the discipline of ascending as a group rather than as five separate surprises for the captain.\n\nDivers who take it stop dreading current and start choosing it.",
      heroImageUrl: bundledImage("Blue Tangs Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "Dasyatis americana NOAA.jpg",
        "Blue Tang Pickles 20080310.jpg",
      ),
      durationText: "One day · two dives",
      groupSizeText: "Small groups the boat can keep in one piece of water",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Two drift dives",
        "Surface marker buoy and reel",
      ],
      excludes: ["Personal gear rental"],
      scheduleDays: [
        {
          title: "Drift Diver",
          startTime: "08:30",
          endTime: "15:00",
          items: [
            "Reading current, planning a live-boat drift, and negative entries",
            "Deploying a surface marker from depth without going up with it",
            "Two drifts, ascending and surfacing as one group",
          ],
        },
      ],
      faqs: [
        {
          question: "What happens if I get separated?",
          answer:
            "You deploy your marker and surface — which is exactly what the course drills. The boat is following markers, so a solo ascent is a pickup rather than a search.",
        },
      ],
    },
  },
  {
    slug: "sdi-boat-diver",
    version: 1,
    title: "Boat Diver",
    agency: "sdi",
    description: "Be the diver a captain is glad to have aboard.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Entries, exits, and knowing where to put your kit",
      overview:
        "Almost every dive on this coast starts on a boat, and a boat is a small space with a schedule. The divers who make it easy are the ones who know where their gear goes, when to be ready, and how to get in and out without holding up eleven other people.\n\nYou will cover the vocabulary a briefing assumes you already know, entries and exits in a bit of swell, tag boards and roll calls, and what to do when you surface behind the boat rather than beside it.\n\nIt is not a glamorous course. It is the one that makes every charter you ever book better.",
      heroImageUrl: bundledImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "Grouper 2 Molasses Reef 1999.jpg",
        "Sponge 06 Molasses Reef 20230714.jpg",
      ),
      durationText: "One day · two dives",
      groupSizeText: "Small groups aboard a working charter",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: ["SDI digital certification card", "Two boat dives", "Tanks and weights"],
      excludes: ["Personal gear rental", "Seasickness remedies"],
      scheduleDays: [
        {
          title: "Boat Diver",
          startTime: "07:30",
          endTime: "15:00",
          items: [
            "Boat vocabulary, gear stowage, and where not to stand",
            "Giant stride, back roll, and getting back up a ladder in swell",
            "Roll calls, tag boards, and the surfaced-behind-the-boat problem",
          ],
        },
      ],
      faqs: [
        {
          question: "I get seasick. Is this a bad idea?",
          answer:
            "Tell us when you book. Remedies work far better taken the night before than on the water, and where you sit and what you look at both matter more than people expect.",
        },
      ],
    },
  },
  {
    slug: "sdi-search-and-recovery-diver",
    version: 1,
    title: "Search & Recovery Diver",
    agency: "sdi",
    description: "Find what went over the side, and bring it up without hurting anyone.",
    minimumCertificationLevel: "advanced_open_water",
    content: {
      ...blank,
      summary: "Search patterns that work, and lifting that does not run away with you",
      overview:
        "Phones, cameras, outboards, anchors, wedding rings. Things go over the side constantly, and finding them is a methodical skill rather than a lucky one.\n\nYou will run the standard patterns — circular, jackstay, expanding square — and learn which one suits the bottom, the visibility, and the size of what you are looking for. Then the recovery half: knots that hold under load, and lift bags, which are the genuinely dangerous part of this course and are treated that way.\n\nAn uncontrolled lift takes a diver to the surface with it. The whole second half is about not being that diver.",
      heroImageUrl: bundledImage("Dasyatis americana NOAA.jpg"),
      galleryPhotos: bundledGallery(
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "FGBNMS - nurse shark (27551309652).jpg",
      ),
      durationText: "Two days · four dives",
      groupSizeText: "Small groups, each diver running a full pattern",
      prerequisiteNote:
        "SDI Advanced Adventure Diver or an equivalent advanced certification, and navigation training is genuinely useful beforehand — a search pattern is navigation with a purpose. That is where we set this course; if you hold a rung between Open Water and Advanced, talk to us before you book. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Four dives",
        "Reels, lines, and lift bags for the course",
      ],
      excludes: ["Personal gear rental"],
      scheduleDays: [
        {
          title: "Day one — finding it",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Choosing a pattern for the bottom and the visibility you have",
            "Two dives: circular and jackstay searches with a real target",
          ],
        },
        {
          title: "Day two — bringing it up",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Knots and rigging that hold under load",
            "Lift-bag technique, and why an uncontrolled ascent is the hazard here",
            "Two dives: a controlled recovery from start to surface",
          ],
        },
      ],
      faqs: [
        {
          question: "How heavy can we lift?",
          answer:
            "Within the bags we carry and the training you have. The judgement of what to leave for a professional salvage crew is part of the course.",
        },
      ],
    },
  },
  {
    slug: "sdi-underwater-photography",
    version: 1,
    title: "Underwater Photography",
    agency: "sdi",
    description: "Bring back images that look like the dive actually looked.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Get close, add light, and hold still — the three things that fix everything",
      overview:
        "Almost every disappointing underwater photograph has the same three causes: too far away, no light, and a photographer who was moving.\n\nThis course fixes all three. You will learn how water eats colour with depth and what a strobe or video light gives back, how close you actually need to be, and — the part nobody expects — how much of underwater photography is buoyancy control.\n\nWe will shoot, review the frames together, and shoot again. Bring whatever camera you own; the principles are the same from a phone housing to a full rig.",
      heroImageUrl: bundledImage("French Angelfish Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Stoplight parrotfish Pickles Reef.jpg",
        "Elkhorn coral 8 Molasses Reef 20080309.jpg",
      ),
      durationText: "One to two days · two to three dives with review sessions",
      groupSizeText: "Small groups, so every diver's frames get looked at",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency, and your own camera and housing. Steady buoyancy matters more here than the camera does. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Two to three photo dives",
        "Image review sessions with your instructor",
      ],
      excludes: ["Camera, housing and lighting", "Personal gear rental"],
      scheduleDays: [
        {
          title: "Underwater Photography",
          startTime: "08:30",
          endTime: "16:00",
          items: [
            "How depth eats colour, and what artificial light puts back",
            "Composition, distance, and the backscatter that ruins a good frame",
            "Dives: shoot, review together, adjust, shoot again",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need an expensive camera?",
          answer:
            "No. Everything taught here — getting close, adding light, holding still — improves a phone in a housing as much as it improves a full rig.",
        },
      ],
    },
  },
  {
    slug: "sdi-dry-suit-diver",
    version: 1,
    title: "Dry Suit Diver",
    agency: "sdi",
    description: "Dive warm, and control a suit that is now part of your buoyancy.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Stay warm on long dives — and learn the one skill a wetsuit never taught you",
      overview:
        "A dry suit keeps you warm enough to enjoy a second and third dive that a wetsuit would have ended. It also adds a second air space to manage, and that is the whole reason this course exists.\n\nYou will learn to vent on ascent, to keep gas out of your boots, and to recover from an inverted position calmly — because a suit full of air at your ankles is a runaway ascent if you have never practised it.\n\nBy the end the suit is something you stop thinking about, which is the point.",
      heroImageUrl: bundledImage("Blue Tang Pickles 20080310.jpg"),
      galleryPhotos: bundledGallery(
        "Brain coral 2 Molasses Reef 20080309.jpg",
        "Sponge 06 Molasses Reef 20230714.jpg",
      ),
      durationText: "One day · confined water plus two dives",
      groupSizeText: "Small groups, with suits fitted before the water",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Dry suit and undersuit for the course",
        "Confined-water session and two open-water dives",
      ],
      excludes: ["Personal gear rental", "Dry suit purchase or fitting"],
      scheduleDays: [
        {
          title: "Dry Suit Diver",
          startTime: "08:30",
          endTime: "16:00",
          items: [
            "Suit types, seals, valves, and getting the undersuit right",
            "Confined water: inflation, venting, and recovering from an inverted position",
            "Two dives with the suit as part of your buoyancy, not fighting it",
          ],
        },
      ],
      faqs: [
        {
          question: "Is it worth it in warm water?",
          answer:
            "For a single dive, rarely. For a three-dive day, a long surface interval in wind, or anywhere with a thermocline, it is the difference between finishing the day and cutting it short.",
        },
      ],
    },
  },
  {
    slug: "sdi-equipment-specialist",
    version: 1,
    title: "Equipment Specialist",
    agency: "sdi",
    description: "Understand your kit well enough to fix the small things yourself.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "Know what everything does, and sort the small failures on the boat",
      overview:
        "A blown o-ring, a stuck inflator, a fin strap that let go on the ladder — every one of these ends a dive for someone who cannot fix it and delays a dive by two minutes for someone who can.\n\nYou will go through the whole kit: how a regulator actually delivers gas, what a BCD's valves do, why cylinders get inspected on the schedule they do, and how to run a proper pre-dive check that catches things before the boat leaves.\n\nThis is not a repair-technician course, and it deliberately stops short of servicing anything sealed. What it gives you is the field fixes and the vocabulary to tell a technician what is actually wrong.",
      heroImageUrl: bundledImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
      galleryPhotos: bundledGallery(
        "Grouper 2 Molasses Reef 1999.jpg",
        "Blue Tangs Molasses Reef 1999.jpg",
      ),
      durationText: "One day · workshop, with an optional dive",
      groupSizeText: "Small groups around the bench",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency. Bring your own gear if you have it — the course is far more useful on the kit you actually dive.",
      includes: [
        "SDI digital certification card",
        "Workshop session with tools and spares",
        "O-ring and fin-strap kit to take away",
      ],
      excludes: ["Regulator servicing", "Parts for your own repairs"],
      scheduleDays: [
        {
          title: "Equipment Specialist",
          startTime: "09:00",
          endTime: "16:00",
          items: [
            "How a regulator, BCD and cylinder valve each work",
            "Field fixes: o-rings, straps, mouthpieces, and inflator troubleshooting",
            "Service intervals, inspections, and rinsing that actually helps",
          ],
        },
      ],
      faqs: [
        {
          question: "Can I service my own regulator afterwards?",
          answer:
            "No — that needs a manufacturer-trained technician and the right parts. This course covers what you can safely do yourself and where the line is.",
        },
      ],
    },
  },
  {
    slug: "sdi-sidemount-diver",
    version: 1,
    title: "Sidemount Diver",
    agency: "sdi",
    description: "Cylinders on your hips — easier on your back, and every valve in reach.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "A trim, balanced rig you can carry to the water in two trips",
      overview:
        "Sidemount moves your cylinders from your back to your hips. Divers come to it for three reasons: a back that has had enough of walking down a jetty under a full rig, trim that is genuinely easier to hold flat, and valves you can see and reach yourself.\n\nYou will get the harness set up for your body — which takes longer than anyone expects and matters more than anything else in the course — and then dive it until the rig disappears.\n\nThis is the recreational course. It is not an overhead or technical qualification, and it does not change the depth limit your certification already carries.",
      heroImageUrl: bundledImage("Sponge 06 Molasses Reef 20230714.jpg"),
      galleryPhotos: bundledGallery(
        "Yellowtail Snappers Molasses Reef 1999.jpg",
        "French Angelfish Pickles Reef 20230713.jpg",
      ),
      durationText: "Two days · confined water plus three dives",
      groupSizeText: "Very small groups — rig setup is one-to-one work",
      prerequisiteNote:
        "SDI Open Water Scuba Diver or an equivalent certification from another agency. This is the recreational sidemount course: it is not a technical or overhead qualification, and it does not extend the depth limit your certification already carries. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive.",
      includes: [
        "SDI digital certification card",
        "Sidemount harness and cylinders for the course",
        "Confined-water session and three open-water dives",
      ],
      excludes: ["Personal gear rental", "Sidemount harness purchase"],
      scheduleDays: [
        {
          title: "Day one — the rig",
          startTime: "09:00",
          endTime: "16:00",
          items: [
            "Harness setup, bungee tension, and cylinder trim for your body",
            "Confined water: valve drills, gas switching, and staying flat",
          ],
        },
        {
          title: "Day two — diving it",
          startTime: "08:00",
          endTime: "15:00",
          items: [
            "Three dives, adjusting the rig between each",
            "Entries, exits and ladder work with cylinders off",
          ],
        },
      ],
      faqs: [
        {
          question: "Does this let me dive deeper or in caves?",
          answer:
            "No. It changes how your cylinders are carried, not what you are qualified to dive. Overhead and technical diving are separate training paths.",
        },
      ],
    },
  },
  {
    slug: "sdi-marine-ecosystems-awareness",
    version: 1,
    title: "Marine Ecosystems Awareness",
    agency: "sdi",
    description: "Understand the reef you are diving, and dive it without damaging it.",
    minimumCertificationLevel: null,
    content: {
      ...blank,
      summary: "Know what you are looking at, and leave it exactly as you found it",
      overview:
        "A reef stops being scenery once you can read it. Which fish is cleaning which, why that coral is bleached and that one is not, what the sponges are doing, and which of the day's animals were only there because of the tide.\n\nThe second half is about impact, and it is blunt: a fin tip on a coral head undoes decades, sunscreen matters, and touching almost anything is worse for it than it is for you.\n\nOpen to divers and snorkellers alike — the knowledge half needs no certification at all.",
      heroImageUrl: bundledImage("French Angelfish Pickles Reef 20230713.jpg"),
      galleryPhotos: bundledGallery(
        "Stoplight parrotfish Pickles Reef.jpg",
        "Brain coral 2 Molasses Reef 20080309.jpg",
      ),
      durationText: "Half a day of academics, plus an optional dive",
      groupSizeText: "Any size for the classroom; small groups in the water",
      prerequisiteNote:
        "No certification needed for the knowledge session. If you want to add the dive, an Open Water certification from any recognised agency and a medical questionnaire are required; some answers need a physician's sign-off before you can dive.",
      includes: ["SDI digital certification card", "Reef identification session and slate"],
      excludes: ["The optional dive", "Personal gear rental"],
      scheduleDays: [
        {
          title: "Marine Ecosystems Awareness",
          startTime: "09:00",
          endTime: "13:00",
          items: [
            "How a coral reef is actually put together, and what keeps it alive",
            "Who eats whom: the relationships behind what you have been swimming past",
            "Diver impact — contact, sunscreen, feeding, and anchoring",
            "Optional dive: identification in the water",
          ],
        },
      ],
      faqs: [
        {
          question: "Do I need to be a diver?",
          answer:
            "Not for the knowledge session — snorkellers and non-divers are welcome. The optional dive needs an Open Water certification.",
        },
      ],
    },
  },
  {
    slug: "sdi-inactive-diver-scuba-refresher",
    version: 1,
    title: "Inactive Diver Scuba Refresher",
    agency: "sdi",
    description: "Back in the water after a gap, without pretending the gap did not happen.",
    minimumCertificationLevel: "open_water",
    content: {
      ...blank,
      summary: "A patient tune-up so your first dive back is a good one",
      overview:
        "Certifications do not expire, but skills fade and confidence fades faster. If it has been a year — or ten — this is the session that gets you back without spending your first dive back working out where everything went.\n\nWe will rebuild the gear assembly and buddy check from scratch, run the skills in confined water until they feel automatic again, and go over what has changed since you last dived, which for most people is computers.\n\nNo test, no pressure, and nobody watching the clock.",
      heroImageUrl: bundledImage("Grouper 2 Molasses Reef 1999.jpg"),
      galleryPhotos: bundledGallery(
        "French Angelfish Pickles Reef 20230713.jpg",
        "Blue Tang Pickles 20080310.jpg",
      ),
      durationText: "Half a day · confined water, with an optional reef dive",
      groupSizeText: "Small groups, or one-to-one if you would rather",
      prerequisiteNote:
        "An Open Water certification from any recognised agency, however long ago. You will complete a medical questionnaire; some answers require a physician's sign-off before you can dive, and a gap in diving is a good moment to check.",
      includes: [
        "All scuba equipment for the session",
        "Confined-water skills review",
        "Updated logbook entry",
      ],
      excludes: ["The optional reef dive", "A new certification card — you keep the one you have"],
      scheduleDays: [
        {
          title: "Refresher session",
          startTime: "09:00",
          endTime: "13:00",
          items: [
            "Gear assembly, buddy checks, and what has changed since you last dived",
            "Confined water: mask, regulator, buoyancy, and out-of-air drills",
            "Optional reef dive to put it back together",
          ],
        },
      ],
      faqs: [
        {
          question: "How long is too long between dives?",
          answer:
            "There is no rule, and no shame in either answer. If you are wondering whether you need this, that is usually the answer.",
        },
      ],
    },
  },
];

/** Resolve the current code-owned template without exposing the array to callers. */
export function getCourseTemplate(slug: string): CourseTemplate | null {
  return COURSE_TEMPLATES.find((template) => template.slug === slug) ?? null;
}

/** The baseline persisted beside a shop copy when it begins following a template. */
export { courseTemplateSnapshot };
