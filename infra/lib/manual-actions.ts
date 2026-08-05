/**
 * One shape for every step a human has to perform by hand.
 *
 * Before this existed, "what is still manual" was spread across eight
 * `*AccessKeyInstructions` outputs whose descriptions named their destination in
 * five different registers (a glob, a mechanism with no name, "that runner's
 * secret settings", nothing at all), plus a `ManualActionItems` output that
 * claimed to be the complete remainder and listed one provider's remainder.
 *
 * The fix is not better prose in each place; it is one record type that every
 * step must fill in, so a step with no stated destination cannot be written. A
 * `ManualAction` is only well-formed when it says *when* it applies, *why* the
 * stack cannot do it, *what* to run, and *where* the result goes.
 *
 * The registry renders to two surfaces from the same data: grouped `CfnOutput`s
 * printed by every `cdk deploy`, and docs/engineering/manual-actions.md. A test
 * asserts the committed doc matches, so the two can never drift.
 *
 * Deliberately free of CDK tokens: every field is a plain string, and
 * `infra/lib/manual-actions.test.ts` fails on an unresolved `${Token[...]}`
 * reaching the rendered text. A step that needs a deploy-time value (a topic
 * ARN, the DKIM records) names the stack output carrying it rather than
 * embedding it, which also survives being read outside a deploy.
 */

/** Rendering order. Each becomes one `CfnOutput` and one doc section. */
export const MANUAL_ACTION_CATEGORIES = [
  "Prerequisites",
  "Credentials",
  "DNS",
  "AWS account",
  "Verification",
] as const;

export type ManualActionCategory = (typeof MANUAL_ACTION_CATEGORIES)[number];

export interface ManualAction {
  /** Stable kebab-case id. Referenced from runbooks; do not renumber. */
  readonly id: string;
  /** Imperative, one line. */
  readonly title: string;
  readonly category: ManualActionCategory;
  /**
   * When this applies — "once per account", "after every deploy", "after
   * rotating credentials", "only after `cdk destroy`". Without it a checklist
   * reads as a fresh-account script and the recurring items get skipped.
   */
  readonly when: string;
  /** Why the stack structurally cannot do it. A step with no answer here is a bug, not a chore. */
  readonly why: string;
  /** Exact commands, in order. */
  readonly run?: readonly string[];
  /** What running it gives you, if anything. */
  readonly produces?: string;
  /**
   * Exactly where the result goes: the platform *and* the names it takes there.
   * Only a destination — a caveat belongs in `note`, a recovery in `onFailure`.
   * The moment this field starts carrying other things, the registry is back to
   * being prose with a label on it.
   */
  readonly store?: string;
  /** Commands that prove it landed, and what a good answer looks like. */
  readonly verify?: readonly string[];
  /** What to do when `verify` says no. */
  readonly onFailure?: string;
  /** A caveat that is neither a destination nor a recovery. */
  readonly note?: string;
}

const LABEL_WIDTH = 9;

function block(label: string, lines: readonly string[]): string[] {
  return lines.map((line, index) =>
    index === 0 ? `${label.padEnd(LABEL_WIDTH)}${line}` : `${" ".repeat(LABEL_WIDTH)}${line}`,
  );
}

/** One action, as the uniform indented block both surfaces share. */
export function renderManualAction(action: ManualAction, number: number): string {
  const lines = [`[${number}] ${action.title}`];
  const indented: string[] = [];
  indented.push(...block("when", [action.when]));
  indented.push(...block("why", [action.why]));
  if (action.run) indented.push(...block("run", action.run));
  if (action.produces) indented.push(...block("produces", [action.produces]));
  if (action.store) indented.push(...block("store", [action.store]));
  if (action.verify) indented.push(...block("verify", action.verify));
  if (action.onFailure) indented.push(...block("if not", [action.onFailure]));
  if (action.note) indented.push(...block("note", [action.note]));
  lines.push(...indented.map((line) => `    ${line}`));
  return lines.join("\n");
}

/**
 * Every action in one category, numbered by its position in the whole registry
 * so the numbers in a stack output and in the doc are the same numbers.
 */
export function renderCategory(
  actions: readonly ManualAction[],
  category: ManualActionCategory,
): string {
  return actions
    .map((action, index) => ({ action, number: index + 1 }))
    .filter((entry) => entry.action.category === category)
    .map((entry) => renderManualAction(entry.action, entry.number))
    .join("\n\n");
}

/**
 * A category's actions packed into as few strings as fit under `maxLength`,
 * splitting only on action boundaries.
 *
 * CloudFormation caps an output value at 4096 characters, and the Credentials
 * group crossed it the first time this registry was written — a limit worth
 * absorbing here rather than paying for in shortened prose, because the reason
 * these entries are long is that they name every variable and platform they
 * touch, which is the whole point.
 */
export function renderCategoryChunks(
  actions: readonly ManualAction[],
  category: ManualActionCategory,
  maxBytes: number,
): string[] {
  const blocks = actions
    .map((action, index) => ({ action, number: index + 1 }))
    .filter((entry) => entry.action.category === category)
    .map((entry) => renderManualAction(entry.action, entry.number));

  // Bytes, not `String.length`. CloudFormation states its output ceiling in
  // bytes and this prose is full of em dashes, so UTF-16 code units undercount
  // — today's largest chunk is 3302 units and 3309 bytes, and that gap widens
  // with the text rather than staying put.
  const size = (text: string) => Buffer.byteLength(text, "utf8");

  const chunks: string[] = [];
  for (const block of blocks) {
    if (size(block) > maxBytes) {
      // Packing cannot honour the limit for a single oversized block, and
      // silently emitting it anyway would turn a caught problem into a failed
      // deploy. Split the action instead.
      throw new Error(
        `A single manual action renders to ${size(block)} bytes, over the ${maxBytes}-byte limit for one CloudFormation output. Split it into two actions.`,
      );
    }
    const current = chunks[chunks.length - 1];
    if (current !== undefined && size(current) + size(block) + 2 <= maxBytes) {
      chunks[chunks.length - 1] = `${current}\n\n${block}`;
    } else {
      chunks.push(block);
    }
  }
  return chunks;
}

/** The generated checklist at docs/engineering/manual-actions.md. */
export function renderManualActionsDoc(actions: readonly ManualAction[]): string {
  const sections = MANUAL_ACTION_CATEGORIES.filter((category) =>
    actions.some((action) => action.category === category),
  ).map((category) => `## ${category}\n\n\`\`\`text\n${renderCategory(actions, category)}\n\`\`\``);

  return `${[
    "# Manual actions",
    "",
    "> [!NOTE]",
    "> Generated from the registry in [infra/lib/infra-stack.ts](../../infra/lib/infra-stack.ts).",
    "> Do not edit by hand — run `pnpm test infra -u` to regenerate after changing the registry.",
    "",
    "Every step `cdk deploy` cannot perform itself, in one place, in one shape: **when** it",
    "applies, **why** the stack cannot do it, **what** to run, and **where** the result goes.",
    "The same blocks are printed as stack outputs after every deploy, so the checklist is in",
    "front of whoever just deployed rather than in a document they have to remember to open.",
    "",
    "Reasoning for each item lives in [infrastructure-runbook.md](infrastructure-runbook.md);",
    "this file is the checklist, not the argument.",
    "",
    sections.join("\n\n"),
  ].join("\n")}\n`;
}
