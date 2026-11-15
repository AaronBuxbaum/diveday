import {
  isShopQuestionId,
  isShopQuestionKind,
  newShopQuestionId,
  SHOP_QUESTIONS_FIELD_MAX,
  SHOP_QUESTIONS_MAX,
  type ShopQuestion,
} from "@/lib/waiver-questions";

/**
 * **What a refused publish hands back to the release editor** (dive-domain
 * review 2, S2), on the pattern of `src/lib/paper-waiver-form.ts`.
 *
 * A refusal used to redirect to `?notice=` and re-render the page from the
 * published version, so an owner who had rewritten two paragraphs and added
 * five questions lost all of it to one option too many. A refusal now stops
 * navigating and answers through `useActionState`, carrying what was typed
 * back in the action's own response, never in the URL. The editor checks the
 * same rules first (`shopQuestionProblem`), so this is the server's second
 * word, for a POST the editor did not shape. Success still redirects with its
 * `?notice=`.
 *
 * Its own module rather than `./actions.ts`, because a `"use server"` file
 * exports only async functions, and the idle value below is not one.
 */

/**
 * - `body` — the release is too short or too long to be one.
 * - `materiality` — signatures stand and the publish did not say whether the
 *   edit is a correction or a material change (H-20260822-may-shop-explicitly-declare).
 * - `questions` — the list breaks a rule; `questionNumber` names the question
 *   (1-based) when the refusal is about one.
 */
export type ReleaseFormRefusal = "body" | "materiality" | "questions";

export type ReleaseFormState =
  | { status: "idle" }
  | {
      status: "refused";
      refusal: ReleaseFormRefusal;
      questionNumber?: number;
      typed: {
        body: string;
        /** The list as typed, shaped enough to stand the editor back up; never trusted. */
        questions: ShopQuestion[] | null;
        material: "material" | "non-material" | null;
      };
    };

export const RELEASE_FORM_IDLE: ReleaseFormState = { status: "idle" };

/**
 * The posted `questions` field shaped back into rows the editor can show, so
 * nothing the staffer typed is lost to a refusal. Lenient where
 * `parseShopQuestions` is strict: an unreadable id gets a fresh one, an
 * unknown kind reads as short text, a missing prompt as blank. Null when the
 * field is absent, too long to read (security review M2) or not a list.
 */
export function typedShopQuestions(raw: FormDataEntryValue | null): ShopQuestion[] | null {
  if (typeof raw !== "string" || raw.length > SHOP_QUESTIONS_FIELD_MAX) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<string>();
  const questions: ShopQuestion[] = [];
  for (const entry of parsed.slice(0, SHOP_QUESTIONS_MAX)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const id = isShopQuestionId(item.id) && !seen.has(item.id) ? item.id : newShopQuestionId();
    seen.add(id);
    const kind = isShopQuestionKind(item.kind) ? item.kind : "text";
    questions.push({
      id,
      kind,
      prompt: typeof item.prompt === "string" ? item.prompt : "",
      required: item.required === true,
      ...(kind === "choice"
        ? {
            options: Array.isArray(item.options)
              ? item.options.filter((option): option is string => typeof option === "string")
              : [],
          }
        : {}),
    });
  }
  return questions;
}
