// i18n-exempt-file: canned model answers for the browser fleet (e2e-fixtures.ts), never DiveDay copy
import type { ClaudeRequest } from "@/lib/claude/provider";
import { ASSIST_MAPPABLE_FIELDS } from "@/lib/import";
import { MAPPING_SYSTEM } from "./import-mapping";
import { DRAFT_SYSTEM, REPLY_TRANSLATION_SYSTEM, TRIAGE_SYSTEM } from "./inbox";
import { SETUP_SYSTEM } from "./website-setup";

/**
 * The front-of-house layer's canned answers (inbox sort and translate, the
 * reply draft, import mapping, website setup), for the browser fleet's
 * captures of a lit shop. Each passes its feature's own guard: no number the
 * facts did not give, nothing medical, every proposal with its source line.
 */

function content(request: ClaudeRequest): string {
  const first = (request.messages as { content: unknown }[])[0]?.content;
  if (typeof first === "string") return first;
  return JSON.stringify(first ?? "");
}

function triageFixture(request: ClaudeRequest): unknown {
  const spanish = /hola|gracias|podemos|buceo/i.test(content(request));
  return {
    intent: "move",
    urgent: false,
    language: spanish ? "es" : "en",
    translation: spanish ? "Hi, can we move our dive to the next morning trip? Thanks." : null,
    confidence: 0.9,
  };
}

function replyDraftFixture(): unknown {
  return {
    reply:
      "Thanks for getting in touch. A member of our team will check the schedule and confirm the change for you shortly.",
    medical: false,
    eligibility: false,
    confidence: 0.9,
  };
}

function replyTranslationFixture(): unknown {
  return {
    translation:
      "Gracias por escribirnos. Una persona de nuestro equipo revisará el horario y te confirmará el cambio en breve.",
  };
}

function importMappingFixture(request: ClaudeRequest): unknown {
  let sample: { columns?: { header: string }[]; levelSpellings?: string[] } = {};
  try {
    sample = JSON.parse(content(request));
  } catch {
    sample = {};
  }
  const guess = (header: string): string => {
    const h = header.toLowerCase();
    if (/mobile|cell|tel/.test(h) && ASSIST_MAPPABLE_FIELDS.includes("phone")) return "phone";
    if (/mail/.test(h) && ASSIST_MAPPABLE_FIELDS.includes("email")) return "email";
    if (/card|cert.*(no|num)/.test(h) && ASSIST_MAPPABLE_FIELDS.includes("certification_number"))
      return "certification_number";
    return "none";
  };
  return {
    columns: (sample.columns ?? []).map(({ header }) => ({ header, field: guess(header) })),
    levels: (sample.levelSpellings ?? []).map((spelling) => ({
      spelling,
      level: /adv/i.test(spelling) ? "advanced_open_water" : "open_water",
    })),
  };
}

function websiteSetupFixture(): unknown {
  return {
    tagline: {
      text: "Small boats, early starts, the reef to ourselves.",
      source: "Small boats, early starts, the reef to ourselves.",
    },
    description: null,
    phone: { text: "+1 305 555 0142", source: "Call the shop: +1 305 555 0142" },
    deskHours: { opens: "07:00", closes: "18:00", source: "Open daily 7am to 6pm." },
    coursePrices: [],
    departures: [
      {
        title: "Morning two-tank",
        startTime: "08:00",
        price: 140,
        source: "Morning two-tank reef trip, boat leaves 8:00, $140.",
      },
    ],
    policies: [
      {
        text: "Cancel 48 hours ahead for a full refund.",
        source: "Cancel 48 hours ahead for a full refund.",
      },
    ],
    unreadable: false,
  };
}

export const FRONT_FIXTURES: readonly (readonly [string, (request: ClaudeRequest) => unknown])[] = [
  [TRIAGE_SYSTEM, triageFixture],
  [DRAFT_SYSTEM, replyDraftFixture],
  [REPLY_TRANSLATION_SYSTEM, replyTranslationFixture],
  [MAPPING_SYSTEM, importMappingFixture],
  [SETUP_SYSTEM, websiteSetupFixture],
];
