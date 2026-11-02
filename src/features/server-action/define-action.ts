import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { getDb } from "@/db/client";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession, type ShopSurfaceGate, type ShopSurfaceOptions } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/* -------------------------------------------------------------------------- *
 * One declared server action (issue #2763)
 *
 * A staff mutation used to be assembled by hand in every `*-actions.ts` file:
 * read the session, ask one or two live permission gates through a per-area
 * preamble, read the form, then end every branch with `redirect(noticeUrl(…))` or `revalidateAndRedirect(…)`,
 * spelled once per branch. The preambles drifted (one action asked both
 * gates, its neighbour one), and the three ways out of an action —
 * `redirect`, `revalidateAndRedirect`, a returned value — were chosen per
 * line rather than per action.
 *
 * `defineAction` turns a declaration into the action:
 *
 * - `gate` — `"staff"` (any live staff member) or the live permission gates
 *   the action needs, each with the refusal it lands on. They are asked in
 *   order, against the database rather than the sign-in token, before the
 *   form is read.
 * - `input` — a zod schema over the posted form (`formFields`).
 * - `run(ctx, input)` — the work, answering where the staffer lands and with
 *   which notice (`land(…)`). Every branch answers; none redirects itself.
 *
 * The pipeline is then the only code in the action that reads the session,
 * calls a gate, revalidates or redirects. A notice code is spelled once, at
 * the `land(…)` that produces it, and its kebab spelling is a type: `land(page,
 * "rentals_saved")` does not compile. The codes an action can land with are
 * its type (`NoticeOf<typeof action>`), so the page's notice map can be typed
 * `NoticeMessages<NoticeOf<typeof saveRentalsAction>>` and a code with no
 * words is a compile error at the map.
 *
 * **Every refusal throws.** The gates and the landing go through
 * `revalidateAndRedirect`, which never returns, so nothing after a refusal
 * runs; the pipeline holds no `try`, and a caller may not wrap one around it
 * (`redirectInTry`, `scripts/lint-rules/redirectInTry.grit`).
 *
 * Paths are built from the session's own shop (`ctx.path(…)`, through
 * `shopPath`), never from a posted slug, so an action declared here takes no
 * `shopSlug` argument and stays outside `check-slug-actions`' rule by shape.
 * -------------------------------------------------------------------------- */

/** The session `requireStaffSession` resolves. */
export type StaffSession = Awaited<ReturnType<typeof requireStaffSession>>;

/** Where a refused gate lands, typed exactly as `requireShopSurface`'s refusal is. */
export type ActionRefusal = Extract<ShopSurfaceOptions, { allow: ShopSurfaceGate }>["refusal"];

/**
 * A live permission gate and the refusal it lands on. A gate with nowhere to
 * send the staffer it refuses does not type-check, for the reason
 * `ShopSurfaceOptions` gives.
 */
export type ActionGate = { readonly allow: ShopSurfaceGate; readonly refusal: ActionRefusal };

/** What `run` is handed: who is asking, on which shop, and the connection to ask on. */
export type ActionContext = {
  readonly session: StaffSession;
  readonly db: AppDb;
  readonly shopId: string;
  readonly personId: string;
  readonly shopSlug: string;
  /** A path under this session's shop, every segment escaped (`shopPath`). */
  readonly path: (...segments: (string | number)[]) => string;
  /**
   * Asks one more gate mid-run, for a write only some submissions make (a
   * currency field only payment managers are shown). Refuses exactly as a
   * declared gate does: it lands on the gate's refusal and never returns.
   */
  readonly demand: (gate: ActionGate) => Promise<void>;
};

type NoticeExtra = Record<string, string | number | undefined>;

/**
 * Where an action sends the staffer, and what it says there. Built with
 * {@link land}; `path` may end in a `#fragment` (the section the notice is
 * about), and `also` names other pages whose data the write changed.
 */
export type Landing<Code extends string> = {
  readonly path: string;
  /** Absent: the page itself is the answer (a switched-off feature's post lands on its page). */
  readonly notice?: Code;
  readonly extra?: NoticeExtra;
  readonly also?: readonly string[];
};

type Kebab<Code extends string> = Code extends `${infer Head}_${infer Rest}`
  ? `${Head}-${Kebab<Rest>}`
  : Code;

/**
 * A notice code's one spelling, as a type: lower-case kebab. `land` takes its
 * code as `Code & KebabCode<Code>`, which is `never` — a compile error — for
 * an upper-case or snake_case literal (`NOTICE_CODE_PATTERN`, staff-notices.ts).
 */
export type KebabCode<Code extends string> = Lowercase<Kebab<Code>>;

/** The landing `run` answers with. */
export function land<Code extends string>(
  path: string,
  notice: Code & KebabCode<Code>,
  options?: { extra?: NoticeExtra; also?: readonly string[] },
): Landing<Code>;
/** A landing with no notice: the page itself is the answer. */
export function land(path: string): Landing<never>;
export function land<Code extends string>(
  path: string,
  notice?: Code,
  options: { extra?: NoticeExtra; also?: readonly string[] } = {},
): Landing<Code> {
  return { path, notice, extra: options.extra, also: options.also };
}

declare const landsWith: unique symbol;

/**
 * The action a declaration builds: a form action that never returns, carrying
 * the codes it can land with as a type only.
 */
export type DeclaredAction<Code extends string> = ((formData?: FormData) => Promise<never>) & {
  readonly [landsWith]?: Code;
};

/** The notice codes a declared action can land with, for its page's notice map. */
export type NoticeOf<Action> = Action extends { readonly [landsWith]?: infer Code }
  ? Exclude<Code, undefined>
  : never;

export type ActionSpec<Schema extends z.ZodType, Code extends string> = {
  /** `"staff"`: any live staff member. Otherwise every gate, asked in order. */
  readonly gate: "staff" | readonly [ActionGate, ...ActionGate[]];
  /** The posted form, read through `formFields`. Absent: the action reads no field. */
  readonly input?: Schema;
  /**
   * Where a form the schema refuses lands. Absent, a refusal throws as
   * `readForm` does: the schema reads raw values (`formValue`, `text`) and
   * cannot refuse an honest form, so `run` narrows and lands on its own.
   */
  readonly invalid?: (ctx: ActionContext) => Landing<Code>;
  readonly run: (ctx: ActionContext, input: z.infer<Schema>) => Promise<Landing<Code>>;
};

const noFields = z.object({});

/**
 * The action a declaration describes. See the block comment above for the
 * pipeline; `define-action.test.ts` pins it.
 */
export function defineAction<
  Schema extends z.ZodType = typeof noFields,
  Code extends string = never,
>(spec: ActionSpec<Schema, Code>): DeclaredAction<Code> {
  return async (formData?: FormData): Promise<never> => {
    const ctx = await actionContext(spec.gate);
    const parsed = parseForm(spec.input ?? noFields, formData ?? new FormData());
    if (!parsed.ok) {
      if (!spec.invalid) throw new Error(`form refused: ${parsed.fields.join(", ")}`);
      return arrive(spec.invalid(ctx));
    }
    return arrive(await spec.run(ctx, parsed.data as z.infer<Schema>));
  };
}

/**
 * The session, the connection and the gates, resolved — the first half of the
 * pipeline, for the few actions that answer inline rather than by landing (an
 * in-place picker returning `{ ok: true }`). Every refusal throws, as in
 * `defineAction`.
 */
export async function actionContext(
  gate: ActionSpec<z.ZodType, string>["gate"],
): Promise<ActionContext> {
  const session = await requireStaffSession();
  const db = await getDb();
  const { shopId, personId, shopSlug } = session.user;
  const path = (...segments: (string | number)[]) => shopPath(shopSlug, ...segments);
  const demand = async ({ allow, refusal }: ActionGate): Promise<void> => {
    if (await allow(db, shopId, personId)) return;
    const to = path(...(refusal.landing ?? []));
    revalidateAndRedirect(to, noticeUrl(to, refusal.notice));
  };
  if (gate !== "staff") {
    for (const each of gate) await demand(each);
  }
  return { session, db, shopId, personId, shopSlug, path, demand };
}

/**
 * The one way out of a declared action: revalidate what changed, then land.
 * Exported for an inline-answer action's refusal (`saveAddressAction`), which
 * has no `run` to return it from.
 */
export function arrive<Code extends string>(landing: Landing<Code>): never {
  for (const path of landing.also ?? []) revalidatePath(path);
  const to =
    landing.notice === undefined
      ? landing.path
      : noticeUrl(landing.path, landing.notice, landing.extra);
  revalidateAndRedirect(pathOnly(landing.path), to);
}

/** `revalidatePath` keys on the pathname: no query, no fragment. */
function pathOnly(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}
