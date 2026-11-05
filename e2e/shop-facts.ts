import type { APIRequestContext } from "@playwright/test";

/**
 * One entry of a fact list: a fact or a named set by name, or a fact with its
 * arguments as `{ name, ...args }`. The names are the registry's
 * (`src/db/facts/index.ts`); `pnpm check:e2e-fixtures` refuses one it does not
 * hold.
 */
export type FactRequest = string | ({ name: string } & Record<string, unknown>);

/**
 * **Put a shop into a state, through the one test door** (`POST /api/test/shop`,
 * issue #2759), and answer each fact's value keyed by its name. No `slug` is the
 * canonical `blue-mantis` fixture; a minted shop is named by its slug. The
 * registry writes the facts in its own order, whatever order they are named
 * in. A refusal fails the test here, naming the facts and the door's reason,
 * rather than leaving a capture of the wrong state.
 */
export async function seedFacts(
  request: APIRequestContext,
  facts: FactRequest[],
  options: { slug?: string } = {},
) {
  const response = await request.post("/api/test/shop", {
    data: { ...(options.slug ? { slug: options.slug } : {}), facts },
  });
  if (!response.ok()) {
    throw new Error(
      `POST /api/test/shop ${JSON.stringify(facts)} returned ${response.status()}: ${await response.text()}`,
    );
  }
  const body = await response.json();
  return body.values;
}
