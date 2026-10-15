import { z } from "zod";

/**
 * **A page-shape report** (ADR 20261008-cert-check-extension, "When a check
 * cannot finish"): what the extension hands back when it could not read an
 * agency's page, so DiveDay can see why from the first report, without anyone
 * on a call. Structure only (`extension/shape.js`): the path, the title, the
 * top headings, each box's tag, type and words, the buttons' words, counts,
 * and whether a password box or a captcha is there.
 *
 * Every text in it is made of {@link PAGE_SHAPE_WORDS} and "_" alone, so no
 * name, date or number on the page can be in it. The extension cuts the
 * page's words to these, and the server refuses a report holding any other
 * (`parsePageShape`): it arrives from a browser, so it is untrusted input,
 * parsed and bounded here, logged as one line, never rendered as HTML.
 *
 * Client-safe: the extension's reply is parsed in the browser too.
 */

/**
 * The only words a report may carry: a lookup form's own vocabulary, in
 * English and Spanish, and the agencies' names. No month, no digit. The
 * extension's copy is `PAGE_SHAPE_WORDS` in `extension/protocol.js`, and
 * `page-shape.test.ts` holds the two equal.
 */
export const PAGE_SHAPE_WORDS: readonly string[] = [
  "a",
  "about",
  "account",
  "address",
  "advanced",
  "agency",
  "all",
  "alumno",
  "am",
  "an",
  "and",
  "apellido",
  "apellidos",
  "are",
  "back",
  "birth",
  "birthday",
  "born",
  "btn",
  "buceador",
  "buscar",
  "button",
  "by",
  "cancel",
  "captcha",
  "card",
  "cards",
  "cert",
  "certificate",
  "certification",
  "certifications",
  "certified",
  "challenge",
  "check",
  "chek",
  "choose",
  "clear",
  "close",
  "cmas",
  "code",
  "codigo",
  "confirm",
  "contact",
  "content",
  "contrasena",
  "continue",
  "cookie",
  "cookies",
  "correo",
  "course",
  "ctl",
  "date",
  "day",
  "dd",
  "de",
  "del",
  "details",
  "dive",
  "divechek",
  "diver",
  "divers",
  "diving",
  "dob",
  "e",
  "el",
  "elearning",
  "email",
  "enter",
  "error",
  "estudiante",
  "expired",
  "family",
  "fecha",
  "field",
  "find",
  "first",
  "for",
  "forgot",
  "form",
  "found",
  "from",
  "full",
  "given",
  "go",
  "gue",
  "hcaptcha",
  "help",
  "home",
  "human",
  "i",
  "id",
  "in",
  "iniciar",
  "input",
  "instructor",
  "invalid",
  "is",
  "la",
  "last",
  "lbl",
  "level",
  "log",
  "login",
  "logout",
  "look",
  "lookup",
  "mail",
  "main",
  "manual",
  "match",
  "me",
  "member",
  "menu",
  "middle",
  "mm",
  "month",
  "more",
  "my",
  "nacimiento",
  "name",
  "names",
  "naui",
  "next",
  "no",
  "nombre",
  "nombres",
  "none",
  "not",
  "number",
  "numero",
  "of",
  "on",
  "online",
  "open",
  "optional",
  "or",
  "out",
  "padi",
  "page",
  "password",
  "please",
  "portal",
  "privacy",
  "pro",
  "professional",
  "pros",
  "quick",
  "rating",
  "recaptcha",
  "record",
  "records",
  "register",
  "remember",
  "report",
  "required",
  "rescue",
  "reset",
  "result",
  "results",
  "resultados",
  "robot",
  "run",
  "scuba",
  "sdi",
  "search",
  "security",
  "select",
  "send",
  "services",
  "session",
  "sesion",
  "sign",
  "signin",
  "site",
  "ssi",
  "student",
  "submit",
  "surname",
  "tarjeta",
  "tdi",
  "terms",
  "text",
  "the",
  "this",
  "to",
  "turnstile",
  "txt",
  "up",
  "user",
  "username",
  "verification",
  "verificar",
  "verify",
  "verifycard",
  "water",
  "y",
  "year",
  "you",
  "your",
  "yyyy",
];

/** The most a report may weigh, as JSON: the extension trims its lists to fit. */
export const PAGE_SHAPE_MAX_BYTES = 4096;

const KNOWN = new Set(PAGE_SHAPE_WORDS);

/** At most eight words, each a form word or "_". */
const shapeWords = z
  .string()
  .max(200)
  .refine(
    (text) =>
      text === "" ||
      (text.split(" ").length <= 8 &&
        text.split(" ").every((word) => word === "_" || KNOWN.has(word))),
  );

const count = z.number().int().min(0).max(10_000);

export const pageShapeSchema = z
  .object({
    /** Each segment of the address's path, as form words; never its query string. */
    path: z
      .string()
      .max(400)
      .refine((path) => path.split("/").every((segment) => shapeWords.safeParse(segment).success)),
    title: shapeWords,
    headings: z.array(shapeWords).max(6),
    boxes: z
      .array(
        z
          .object({
            tag: z.enum(["input", "select", "textarea"]),
            type: z.enum([
              "text",
              "search",
              "email",
              "tel",
              "number",
              "date",
              "month",
              "password",
              "checkbox",
              "radio",
              "url",
              "other",
              "select",
              "textarea",
            ]),
            words: shapeWords,
          })
          .strict(),
      )
      .max(20),
    buttons: z.array(shapeWords).max(12),
    forms: count,
    frames: count,
    password: z.boolean(),
    captcha: z.boolean(),
  })
  .strict();

export type PageShape = z.infer<typeof pageShapeSchema>;

/** The report, or null for anything that is not one: a stray word refuses all of it. */
export function parsePageShape(value: unknown): PageShape | null {
  if (typeof value === "string" || value === null || typeof value !== "object") return null;
  let written: string;
  try {
    written = JSON.stringify(value);
  } catch {
    // A loop or a value JSON cannot hold is not a report.
    return null;
  }
  if (written.length > PAGE_SHAPE_MAX_BYTES) return null;
  const parsed = pageShapeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The report as one flat log line's fields: form words and counts only. */
export function pageShapeLogContext(shape: PageShape) {
  return {
    path: shape.path,
    title: shape.title,
    headings: shape.headings.join(" | "),
    boxes: shape.boxes.map((box) => `${box.tag}:${box.type} ${box.words}`).join(" | "),
    buttons: shape.buttons.join(" | "),
    forms: shape.forms,
    frames: shape.frames,
    password: shape.password,
    captcha: shape.captcha,
  };
}

/** The log event a failed check's report writes: one line, counted by agency and reason. */
export const PAGE_SHAPE_LOG_EVENT = "agency_check.page_shape";

/**
 * **One failed check's report, as the server logs it**, from what the
 * browser posted, or null for anything that is not one. `agency` and
 * `reason` must be among `agencies` and `reasons` (the app's own lists), the
 * version must read as one, and the shape must parse as form words: a report
 * is untrusted input, and nothing of it reaches the log unchecked.
 */
export function agencyCheckReportContext(
  posted: { agency: unknown; reason: unknown; version: unknown; pageShape: unknown },
  allowed: { agencies: readonly string[]; reasons: readonly string[] },
) {
  const { agency, reason, version, pageShape } = posted;
  if (typeof agency !== "string" || !allowed.agencies.includes(agency)) return null;
  if (typeof reason !== "string" || !allowed.reasons.includes(reason)) return null;
  let shape: PageShape | null = null;
  if (typeof pageShape === "string" && pageShape !== "") {
    if (pageShape.length > PAGE_SHAPE_MAX_BYTES) return null;
    try {
      shape = parsePageShape(JSON.parse(pageShape));
    } catch {
      return null;
    }
    if (!shape) return null;
  }
  return {
    agency,
    reason,
    extension:
      typeof version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ? version : null,
    ...(shape ? pageShapeLogContext(shape) : {}),
  };
}
