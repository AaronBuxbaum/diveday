import { type DbFunction, type Param, SHOP_SLOT_NAMES, takesDb, takesShop } from "./discover";

/**
 * **What the sweep does with each exported database function.**
 *
 * - `swept`: it takes a shop, and the sweep can fill every other required
 *   parameter by name;
 * - `notShopScoped`: it takes no shop, and the allowlist says why;
 * - `notFillable`: it takes a shop, but a required parameter has a name the
 *   sweep does not know (listed in `missing`);
 * - `unclassified`: it takes no shop and the allowlist does not name it. The
 *   sweep fails on these, so a new function is covered or says why not;
 * - `staleAllowlist`: the allowlist names it but it takes a shop now.
 */
export type Verdict =
  | { kind: "swept"; fn: DbFunction }
  | { kind: "notShopScoped"; fn: DbFunction; reason: string }
  | { kind: "notFillable"; fn: DbFunction; missing: string[] }
  | { kind: "unclassified"; fn: DbFunction }
  | { kind: "staleAllowlist"; fn: DbFunction };

/** `file.ts:functionName`, the key the allowlist and the report use. */
export function functionKey(fn: Pick<DbFunction, "file" | "name">): string {
  return `${fn.file}:${fn.name}`;
}

function missingSlots(fn: DbFunction, fillable: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  for (const param of fn.params.slice(1)) {
    if (param.name === "shop" || SHOP_SLOT_NAMES.has(param.name)) continue;
    if (param.fields) {
      if (param.optional) continue;
      for (const field of param.fields) {
        const shop = SHOP_SLOT_NAMES.has(field.name) || field.name === "shop";
        if (!field.optional && !shop && !fillable.has(field.name)) {
          missing.push(`${param.name}.${field.name}`);
        }
      }
      continue;
    }
    if (!param.optional && !fillable.has(param.name)) missing.push(param.name);
  }
  return missing;
}

export function classify(
  fn: DbFunction,
  fillable: ReadonlySet<string>,
  allowlist: ReadonlyMap<string, string>,
): Verdict {
  const reason = allowlist.get(functionKey(fn));
  if (!takesShop(fn)) {
    return reason === undefined
      ? { kind: "unclassified", fn }
      : { kind: "notShopScoped", fn, reason };
  }
  if (reason !== undefined) return { kind: "staleAllowlist", fn };
  const missing = missingSlots(fn, fillable);
  return missing.length === 0 ? { kind: "swept", fn } : { kind: "notFillable", fn, missing };
}

/** Every exported function that takes a database handle, classified. */
export function classifyAll(
  functions: DbFunction[],
  fillable: ReadonlySet<string>,
  allowlist: ReadonlyMap<string, string>,
): Verdict[] {
  return functions.filter(takesDb).map((fn) => classify(fn, fillable, allowlist));
}

/** The values one call is made with: the caller's shop, and a value for each known name. */
export type Perspective = { shop: { id: string }; values: Readonly<Record<string, unknown>> };

function fillParam(param: Param, perspective: Perspective): unknown {
  if (param.name === "shop") return perspective.shop;
  if (SHOP_SLOT_NAMES.has(param.name)) return perspective.shop.id;
  if (param.fields) {
    if (param.optional) return undefined;
    const object: Record<string, unknown> = {};
    for (const field of param.fields) {
      if (SHOP_SLOT_NAMES.has(field.name)) object[field.name] = perspective.shop.id;
      else if (field.name === "shop") object[field.name] = perspective.shop;
      else if (field.name in perspective.values)
        object[field.name] = perspective.values[field.name];
      else if (!field.optional) throw new Error(`no value for ${param.name}.${field.name}`);
    }
    return object;
  }
  if (param.name in perspective.values) return perspective.values[param.name];
  if (param.optional) return undefined;
  throw new Error(`no value for ${param.name}`);
}

/** The arguments after `db` for one call of a swept function. */
export function argumentsFor(fn: DbFunction, perspective: Perspective): unknown[] {
  const args = fn.params.slice(1).map((param) => fillParam(param, perspective));
  while (args.length > 0 && args.at(-1) === undefined) args.pop();
  return args;
}
