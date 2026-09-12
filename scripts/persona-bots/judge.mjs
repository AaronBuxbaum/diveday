/**
 * The judged half of the weekly persona walk (#1498) — opt-in, and off unless
 * a human dispatched the workflow with it on.
 *
 * The mechanical walk (`walk.spec.ts`) answers yes-or-no questions from the
 * rendered page: a missing skip link, a message key on screen, a page that did
 * not render. Almost everything the personas' own "hold the line on" lists ask
 * for is a judgement instead — whether a refusal states a *true* reason,
 * whether the jargon is explained — and no probe can see a word of it. So the
 * walk reports honestly and reports thinly, and a quiet week reads like a good
 * one.
 *
 * This is the second pass over the pictures the walk has **already taken**: for
 * each of {@link JUDGE_PERSONAS}, hand a model that persona's own section of
 * `docs/product/personas.md` plus the screenshots of the stops they made, and
 * ask for concrete violations of their own list, each naming the surface and
 * quoting what it read on screen.
 *
 * Three things make an opinion safe to put in a tracker one person reads, and
 * all three are here rather than in the prose of an ADR:
 *
 *  1. **The fingerprint survives a rewording.** A judgement that varies from
 *     run to run cannot be deduplicated, and the fingerprint is the whole
 *     mechanism that stops a finding being filed every Monday. So the probe id
 *     is the persona, the stop, and a hash of the *normalised* claim
 *     ({@link normaliseClaim}) — two runs that say the same thing in different
 *     words collide, and a human who closes one has closed it for good.
 *  2. **A judged finding ranks below every measurement.** `judged` is the last
 *     band in `IMPACT_RANK` (`findings.mjs`), so the three-issue budget reaches
 *     one only once the facts have left some — they can only ever spend what
 *     the measurements did not.
 *  3. **Nothing is exempted.** The brake, the comment ceiling, the closed-issue
 *     suppression and the `findIssueProblems` self-check all apply to a judged
 *     finding exactly as to a mechanical one.
 *
 * Everything here is pure except {@link askAnthropic}, which is injected, so
 * `judge.test.mjs` proves the fingerprint and the parser without a network.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { JUDGE_PERSONAS, personaById } from "./personas.mjs";

/** Judged findings one persona may contribute to a run, before the shared budget applies. */
export const JUDGED_FINDINGS_PER_PERSONA = 3;

/** The severity band; `findings.mjs`'s `IMPACT_RANK` puts it below every mechanical one. */
export const JUDGED_IMPACT = "judged";

/** The pass's own record, written beside the findings so the artifact carries it. */
export const JUDGED_FILE_NAME = "judged.json";

/** The model that does the reading. One request per persona, once a week, when dispatched. */
export const JUDGE_MODEL = "claude-opus-5";

/**
 * One persona's section of `docs/product/personas.md`, from its `## N. Name`
 * heading to the next heading.
 *
 * Sliced rather than duplicated here on purpose: the doc is the contract, and a
 * copy of Nadia's list in this file would be the thing that goes stale. The
 * test asserts a real slice comes back for both judged personas, so renumbering
 * the doc fails `pnpm test` rather than quietly sending an empty section to the
 * model.
 */
export function personaSection(markdown, persona) {
  if (!persona) return null;
  const heading = new RegExp(`^## ${persona.number}\\. ${persona.name}\\b.*$`, "m");
  const start = String(markdown).search(heading);
  if (start === -1) return null;
  const rest = String(markdown).slice(start);
  const next = rest.slice(1).search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next + 1)).trim();
}

/** Words that carry no claim, dropped from the front so "The X" and "X" agree. */
const LEADING_FILLERS = new Set([
  "a",
  "an",
  "and",
  "at",
  "here",
  "i",
  "in",
  "it",
  "its",
  "on",
  "so",
  "the",
  "then",
  "there",
  "these",
  "they",
  "this",
  "was",
  "were",
]);

/** How many words of a claim the fingerprint is taken over. */
const CLAIM_WORDS = 12;

/**
 * A claim reduced to the thing it asserts, so the same finding said twice
 * fingerprints the same both times.
 *
 * This is the answer to the issue's own objection — "a judgement that varies
 * from run to run cannot be fingerprinted". Casing, quote style, punctuation,
 * a leading "The", and anything past the first {@link CLAIM_WORDS} words are
 * all noise a second run can change while meaning exactly what the first one
 * meant. What survives is the claim's own vocabulary, in order, which is what
 * a human closing the issue was actually closing.
 */
export function normaliseClaim(text) {
  const words = String(text ?? "")
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let start = 0;
  while (start < words.length && LEADING_FILLERS.has(words[start])) start += 1;
  return words.slice(start, start + CLAIM_WORDS).join(" ");
}

/**
 * `judged:<persona>:<path>:<8 hex>` — the probe id a judged finding carries.
 *
 * `fingerprint()` in `findings.mjs` wraps any probe id, so the open-issue
 * dedupe, the comment path and the closed-issue suppression all work on this
 * unchanged: a judged claim a human has closed is never re-filed.
 */
export function judgedProbeId({ persona, path: urlPath, claim }) {
  const id = typeof persona === "string" ? persona : persona.id;
  const digest = createHash("sha256").update(normaliseClaim(claim)).digest("hex").slice(0, 8);
  return `judged:${id}:${urlPath}:${digest}`;
}

/**
 * What the model is asked, and the four things it is asked *not* to do.
 *
 * The instructions are narrow on purpose. A judged pass that reports taste
 * rather than violations is the failure the persona walk's ceiling exists to
 * prevent, so the prompt binds every finding to a line in the persona's own
 * section, to one of the surfaces actually shown, and to words the model can
 * quote off the screen — and says outright that reporting nothing is the
 * correct answer when nothing is broken.
 */
export function renderJudgePrompt({ persona, section, stops }) {
  // The role matters to the reading, not only to the capture: Kai's line is
  // about what the *fewest* permissions can see, and a model told nothing about
  // who was signed in will read a staff page as though anyone could open it.
  const surfaces = stops
    .map(
      (stop, index) =>
        `${index + 1}. ${stop.path} — ${stop.as ? `signed in as ${stop.as}` : "not signed in"}`,
    )
    .join("\n");
  return [
    `You are reading screenshots of a dive shop's web app as ${persona.name}, ${persona.lens}.`,
    "",
    "This is the persona's entry from the product's own standing frame. The list under",
    '"Hold the line on" is the contract you are checking, and nothing else is:',
    "",
    section,
    "",
    "The images that follow are full-page screenshots, in this order, of the surfaces",
    "this persona visits:",
    "",
    surfaces,
    "",
    "Report only concrete violations of the list above. For each one, name the surface",
    "path exactly as written, quote the words you read on the screenshot, and state in",
    "one sentence what line it breaks and why.",
    "",
    "Do not report anything you cannot quote off a screenshot. Do not report taste,",
    "layout preferences, or anything the list does not ask for. Do not report the same",
    `violation twice. Report at most ${JUDGED_FINDINGS_PER_PERSONA}, worst first.`,
    "",
    "Reporting nothing is the correct answer when nothing on the list is broken.",
    "",
    'Answer with JSON and nothing else: {"findings": [{"path": "...", "quote": "...", "claim": "..."}]}',
  ].join("\n");
}

/** The first JSON object in a reply, whether or not the model fenced it. */
function firstJsonObject(text) {
  const source = String(text ?? "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * A reply turned into walk-shaped findings, with everything unverifiable
 * dropped rather than repaired.
 *
 * A finding naming a surface the persona was not shown is the model answering
 * from the persona doc rather than from a picture, and one with no quotation is
 * an opinion with nothing behind it. Both are dropped silently: this pass is
 * allowed to report less than it saw, and is not allowed to report more.
 */
export function parseJudgeResponse(text, { stops = [], persona }) {
  const parsed = firstJsonObject(text);
  const shown = new Set(stops.map((stop) => stop.path));
  const raw = Array.isArray(parsed?.findings) ? parsed.findings : [];
  const findings = [];
  const seen = new Set();
  for (const item of raw) {
    const urlPath = typeof item?.path === "string" ? item.path.trim() : "";
    const quote = typeof item?.quote === "string" ? item.quote.trim() : "";
    const claim = typeof item?.claim === "string" ? item.claim.trim() : "";
    if (!shown.has(urlPath) || !quote || !claim) continue;
    const probe = judgedProbeId({ persona, path: urlPath, claim });
    if (seen.has(probe)) continue;
    seen.add(probe);
    findings.push({
      probe,
      path: urlPath,
      personas: [persona.id],
      detail: `“${quote}” — ${claim}`,
      impact: JUDGED_IMPACT,
    });
    if (findings.length >= JUDGED_FINDINGS_PER_PERSONA) break;
  }
  return findings;
}

/**
 * One persona's judged pass.
 *
 * `ask` is injected so the tests never reach the network, and `readImage` so
 * they never reach the disk. A stop with no screenshot is dropped — the whole
 * premise is that the model is reading a picture — and a persona left with no
 * pictures reports nothing rather than being asked to judge from prose.
 */
export async function judge({ persona, section, stops = [], readImage, ask = askAnthropic }) {
  const withImages = [];
  for (const stop of stops) {
    const image = await readImage(stop);
    if (image) withImages.push({ stop, image });
  }
  if (withImages.length === 0 || !section) return [];
  const prompt = renderJudgePrompt({
    persona,
    section,
    stops: withImages.map((entry) => entry.stop),
  });
  const text = await ask({ prompt, images: withImages.map((entry) => entry.image) });
  return parseJudgeResponse(text, { stops: withImages.map((entry) => entry.stop), persona });
}

/**
 * A screenshot read off disk as a base64 image block, or null.
 *
 * The walk writes the basename into its report; the file itself is in the run's
 * out directory, which `scripts/persona-bots.mjs` owns and passes in.
 */
export function imageReaderFor(outDir) {
  return (stop) => {
    if (!stop?.screenshot) return null;
    try {
      return {
        media_type: "image/png",
        data: readFileSync(path.join(outDir, stop.screenshot)).toString("base64"),
      };
    } catch {
      return null;
    }
  };
}

/**
 * The one impure function: the Messages API over the global `fetch`.
 *
 * Raw HTTP rather than `@anthropic-ai/sdk` because a new runtime dependency is
 * an ADR in this repository (AGENTS.md), and this is one request per persona,
 * once a week, from a workflow a human dispatched. Throwing is the contract —
 * the caller prints `DID NOT JUDGE` and carries on with the mechanical
 * findings, which is the same fail-open every other step of this bot has.
 */
export async function askAnthropic({ prompt, images, apiKey = process.env.ANTHROPIC_API_KEY }) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((image) => ({
              type: "image",
              source: { type: "base64", media_type: image.media_type, data: image.data },
            })),
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`the Messages API answered ${response.status}`);
  }
  const body = await response.json();
  return (body.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Every judged persona's pass, in registry order, with the sections read once.
 *
 * @param personasMarkdown the whole of `docs/product/personas.md`
 * @param judgeStops `{ path, personas, screenshot }` from the walk's report
 */
export async function judgeAll({ personasMarkdown, judgeStops = [], readImage, ask }) {
  const findings = [];
  for (const id of JUDGE_PERSONAS) {
    const persona = personaById(id);
    if (!persona) continue;
    const stops = judgeStops.filter((stop) => (stop.personas ?? []).includes(id));
    if (stops.length === 0) continue;
    findings.push(
      ...(await judge({
        persona,
        section: personaSection(personasMarkdown, persona),
        stops,
        readImage,
        ask,
      })),
    );
  }
  return findings;
}
