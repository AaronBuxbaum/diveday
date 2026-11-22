import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";

/**
 * **Which `src/db` functions take a shop, and what each parameter is called.**
 *
 * The cross-shop sweep (ADR 20261122-cross-shop-sweep) calls every database
 * function that takes a shop. It finds them by parsing the source with
 * `oxc-parser`, so a parameter's name is read, never guessed: a positional
 * `shopId`, a `shop` row, or a field of an object parameter. An object's fields
 * are read from a destructuring pattern or from its type: written inline, or a
 * type alias or interface declared in the file or imported from `src/`, through
 * intersections, unions (the first branch that reads fully), `Partial`, `Omit`
 * and `Pick`. A list of such objects (`Request[]`, `readonly Request[]`,
 * `Array<Request>`) is read as its element's fields and marked `each`, so a
 * shop named inside every request counts as taking a shop. A part of a type it
 * cannot read becomes one required field named
 * `…`, which nothing fills, so the function is "not fillable yet" rather than
 * called with a guess.
 */

/** One value a function takes: a positional parameter or a field of an object parameter. */
export type Slot = { name: string; optional: boolean };

/**
 * A parameter: a plain value, an object whose fields were read, or (`each`) a
 * list of such objects.
 */
export type Param = Slot & { fields?: Slot[]; each?: true };

export type DbFunction = { file: string; name: string; params: Param[] };

/** The names a database handle goes by as a first parameter. */
export const DB_PARAMETER_NAMES = new Set(["db", "tx"]);

/** The names that say "this is the shop the caller acts for". */
export const SHOP_SLOT_NAMES = new Set(["shopId", "expectedShopId"]);

/** The field that stands for a part of a type the reader could not see. */
export const UNSEEN = "…";

// oxc's ESTree output, typed only as far as this file reads it.
type Node = { type: string; [key: string]: unknown };

/** Finds a type declaration by name, as seen from one file. */
type TypeLookup = (name: string) => Node | undefined;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value;
}

function keyName(key: unknown): string | null {
  if (!isNode(key)) return null;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

const unseen: Slot[] = [{ name: UNSEEN, optional: false }];
const isSeen = (slots: Slot[]) => !slots.some((slot) => slot.name === UNSEEN);

/** The string literal keys of `"a" | "b"`. */
function literalKeys(type: unknown): string[] {
  if (!isNode(type)) return [];
  if (type.type === "TSUnionType") return (type.types as Node[]).flatMap(literalKeys);
  if (type.type === "TSLiteralType") {
    const literal = type.literal as Node;
    return typeof literal.value === "string" ? [literal.value] : [];
  }
  return [];
}

/** The fields of a type, or null when it is not an object type. */
function fieldsOf(type: unknown, lookup: TypeLookup, depth = 0): Slot[] | null {
  if (!isNode(type) || depth > 8) return null;
  switch (type.type) {
    case "TSParenthesizedType":
      return fieldsOf(type.typeAnnotation, lookup, depth + 1);
    case "TSTypeLiteral":
      return membersToSlots(type.members as Node[]);
    case "TSInterfaceBody":
      return membersToSlots(type.body as Node[]);
    case "TSIntersectionType":
      return (type.types as Node[]).flatMap((part) => fieldsOf(part, lookup, depth + 1) ?? unseen);
    case "TSUnionType": {
      const branches = (type.types as Node[]).map((part) => fieldsOf(part, lookup, depth + 1));
      const objects = branches.filter((slots): slots is Slot[] => slots !== null);
      if (objects.length === 0) return null;
      return objects.find(isSeen) ?? objects[0] ?? null;
    }
    case "TSTypeReference":
      return referencedFields(type, lookup, depth);
    case "TSInterfaceDeclaration": {
      const own = fieldsOf(type.body, lookup, depth + 1) ?? unseen;
      const inherited = ((type.extends as Node[] | undefined) ?? []).flatMap(
        (heritage) =>
          fieldsOf({ type: "TSTypeReference", typeName: heritage.expression }, lookup, depth + 1) ??
          unseen,
      );
      return [...inherited, ...own];
    }
    case "TSTypeAliasDeclaration":
      return fieldsOf(type.typeAnnotation, lookup, depth + 1);
    default:
      return null;
  }
}

function referencedFields(type: Node, lookup: TypeLookup, depth: number): Slot[] | null {
  const name = keyName(type.typeName);
  if (!name) return null;
  const args = ((type.typeArguments as Node | undefined)?.params as Node[] | undefined) ?? [];
  const inner = () => fieldsOf(args[0], lookup, depth + 1) ?? unseen;
  switch (name) {
    case "Partial":
      return inner().map((slot) => ({ ...slot, optional: true }));
    case "Readonly":
      return inner();
    case "Omit": {
      const dropped = new Set(literalKeys(args[1]));
      return inner().filter((slot) => !dropped.has(slot.name));
    }
    case "Pick": {
      const kept = new Set(literalKeys(args[1]));
      const from = inner();
      return isSeen(from) ? from.filter((slot) => kept.has(slot.name)) : unseen;
    }
    default: {
      const declared = lookup(name);
      return declared ? fieldsOf(declared, lookup, depth + 1) : null;
    }
  }
}

function membersToSlots(members: Node[]): Slot[] {
  return members.flatMap((member) => {
    const name = member.type === "TSPropertySignature" ? keyName(member.key) : null;
    return name ? [{ name, optional: Boolean(member.optional) }] : [];
  });
}

function annotation(node: Node): unknown {
  return (node.typeAnnotation as Node | undefined)?.typeAnnotation;
}

/** The element type of `T[]`, `readonly T[]`, `Array<T>` or `ReadonlyArray<T>`, or null. */
function elementOf(type: unknown): Node | null {
  if (!isNode(type)) return null;
  if (type.type === "TSArrayType") return type.elementType as Node;
  if (type.type === "TSTypeOperator" && type.operator === "readonly") {
    return elementOf(type.typeAnnotation);
  }
  if (type.type === "TSTypeReference") {
    const name = keyName(type.typeName);
    const args = ((type.typeArguments as Node | undefined)?.params as Node[] | undefined) ?? [];
    if ((name === "Array" || name === "ReadonlyArray") && args[0]) return args[0];
  }
  return null;
}

/** One declared parameter, as the sweep sees it. */
function readParam(node: Node, lookup: TypeLookup): Param {
  let target = node;
  let optional = false;
  if (target.type === "TSParameterProperty") target = target.parameter as Node;
  if (target.type === "AssignmentPattern") {
    optional = true;
    target = target.left as Node;
  }
  if (target.type === "Identifier") {
    const name = target.name as string;
    // A `shop` row is filled whole; its fields are the shop's, not the call's.
    const element = elementOf(annotation(target));
    const fields =
      name === "shop" ? undefined : (fieldsOf(element ?? annotation(target), lookup) ?? undefined);
    const param: Param = { name, optional: optional || Boolean(target.optional), fields };
    if (element && fields) param.each = true;
    return param;
  }
  if (target.type === "ObjectPattern") {
    const typed = fieldsOf(annotation(target), lookup) ?? [];
    const fields: Slot[] = [];
    for (const property of target.properties as Node[]) {
      const name = property.type === "Property" ? keyName(property.key) : null;
      if (!name) {
        fields.push(...unseen);
        continue;
      }
      const hasDefault = isNode(property.value) && property.value.type === "AssignmentPattern";
      const declared = typed.find((slot) => slot.name === name);
      fields.push({ name, optional: hasDefault || Boolean(declared?.optional) });
    }
    return { name: "{}", optional: optional || fields.every((slot) => slot.optional), fields };
  }
  return { name: UNSEEN, optional: false };
}

/** The type aliases and interfaces a program declares, by name. */
function typeDeclarations(program: Node): Map<string, Node> {
  const index = new Map<string, Node>();
  for (const statement of program.body as Node[]) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? (statement.declaration as Node | null)
        : statement;
    if (
      declaration &&
      (declaration.type === "TSInterfaceDeclaration" ||
        declaration.type === "TSTypeAliasDeclaration")
    ) {
      const name = keyName(declaration.id);
      if (name && !index.has(name)) index.set(name, declaration);
    }
  }
  return index;
}

/** Imported names (local name to source specifier and imported name). */
function importsOf(program: Node): Map<string, { from: string; name: string }> {
  const imports = new Map<string, { from: string; name: string }>();
  for (const statement of program.body as Node[]) {
    if (statement.type !== "ImportDeclaration") continue;
    const from = (statement.source as Node).value as string;
    for (const specifier of statement.specifiers as Node[]) {
      if (specifier.type !== "ImportSpecifier") continue;
      const local = keyName(specifier.local);
      const imported = keyName(specifier.imported);
      if (local && imported) imports.set(local, { from, name: imported });
    }
  }
  return imports;
}

function exportedFunctions(file: string, program: Node, lookup: TypeLookup): DbFunction[] {
  const found: DbFunction[] = [];
  const seen = new Set<string>();
  const add = (name: string | null, params: Node[]) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    found.push({ file, name, params: params.map((param) => readParam(param, lookup)) });
  };
  for (const statement of program.body as Node[]) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration as Node | null;
    if (declaration?.type === "FunctionDeclaration") {
      add(keyName(declaration.id), declaration.params as Node[]);
    } else if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations as Node[]) {
        const init = declarator.init as Node | null;
        if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
          add(keyName(declarator.id), init.params as Node[]);
        }
      }
    }
  }
  return found;
}

/**
 * Parse `sources` (file name to text) and list each exported function.
 * `readImport(specifier, fromFile)` returns an imported module's text (or null),
 * so a type declared outside the sources is read where it lives.
 */
export function readFunctions(
  sources: Record<string, string>,
  readImport: (specifier: string, fromFile: string) => { file: string; text: string } | null = () =>
    null,
): DbFunction[] {
  const parsed = new Map<string, Node>();
  const parse = (file: string, text: string) => {
    let program = parsed.get(file);
    if (!program) {
      program = parseSync(file, text).program as unknown as Node;
      parsed.set(file, program);
    }
    return program;
  };
  const lookupFrom = (file: string, program: Node, hops: number): TypeLookup => {
    const own = typeDeclarations(program);
    const imports = importsOf(program);
    return (name) => {
      const local = own.get(name);
      if (local || hops > 3) return local;
      const imported = imports.get(name);
      const module = imported && readImport(imported.from, file);
      if (!imported || !module) return undefined;
      const program = parse(module.file, module.text);
      return lookupFrom(module.file, program, hops + 1)(imported.name);
    };
  };
  return Object.entries(sources).flatMap(([file, text]) => {
    const program = parse(file, text);
    return exportedFunctions(file, program, lookupFrom(file, program, 0));
  });
}

/** The database modules the sweep covers: `src/db/*.ts`, no tests, no test support. */
export function dbModuleSources(root: string): Record<string, string> {
  const dir = path.join(root, "src/db");
  const files = readdirSync(dir).filter(
    (file) =>
      file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes(".test-support."),
  );
  return Object.fromEntries(
    files.sort().map((file) => [file, readFileSync(path.join(dir, file), "utf8")]),
  );
}

/** Reads a module a `src/db` file imports, by `@/` alias or relative path. */
export function importReader(root: string) {
  return (specifier: string, fromFile: string): { file: string; text: string } | null => {
    const fromDir = path.dirname(path.join(root, "src/db", fromFile));
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? path.join(fromDir, specifier)
        : null;
    if (!base) return null;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) {
        return {
          file: path.relative(path.join(root, "src/db"), candidate),
          text: readFileSync(candidate, "utf8"),
        };
      }
    }
    return null;
  };
}

/** True when the function's first parameter is a database handle. */
export function takesDb(fn: DbFunction): boolean {
  return DB_PARAMETER_NAMES.has(fn.params[0]?.name ?? "");
}

/** True when the function says which shop it acts for. */
export function takesShop(fn: DbFunction): boolean {
  return fn.params
    .slice(1)
    .some(
      (param) =>
        SHOP_SLOT_NAMES.has(param.name) ||
        param.name === "shop" ||
        Boolean(
          param.fields?.some((field) => SHOP_SLOT_NAMES.has(field.name) || field.name === "shop"),
        ),
    );
}
