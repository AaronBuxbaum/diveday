import { describe, expect, it } from "vitest";

import { lintFixtures, refusals } from "./lint-fixtures.mjs";

/**
 * The Biome rules in this folder, run through the repository's real `biome.json` on fixture
 * files, so each case exercises the rule *and* the override that scopes it. They replaced
 * five `check:repo` guards (check-clock, check-intl-cache, check-timezone,
 * check-redirect-in-try, check-soft-delete); the cases below are those guards' cases, and the "leaves alone"
 * ones carry as much weight as the refusals.
 */

describe("clock", () => {
  const wallClock = "export const a = new Date();\nexport const b = Date.now();\n";

  it.each(["src/lib/x.ts", "src/db/x.ts", "src/features/f/x.tsx"])(
    "refuses a bare wall-clock read in %s",
    (file) => {
      expect(refusals({ [file]: wallClock }, "clock")).toEqual([`${file}:1`, `${file}:2`]);
    },
  );

  it("refuses one in a test under a guarded root — real time running ahead of the freeze", () => {
    expect(refusals({ "src/db/x.test.ts": wallClock }, "clock")).toEqual([
      "src/db/x.test.ts:1",
      "src/db/x.test.ts:2",
    ]);
  });

  it("leaves a parameterised parse alone", () => {
    expect(refusals({ "src/lib/x.ts": "export const a = new Date(startsAt);\n" }, "clock")).toEqual(
      [],
    );
  });

  it("leaves the clock module and its own test alone", () => {
    expect(
      refusals({ "src/lib/clock.ts": wallClock, "src/lib/clock.test.ts": wallClock }, "clock"),
    ).toEqual([]);
  });

  it("leaves src/app alone, where client components read the browser clock", () => {
    expect(refusals({ "src/app/x.tsx": wallClock }, "clock")).toEqual([]);
  });

  it("leaves the words in a comment or a string alone", () => {
    expect(
      refusals(
        { "src/lib/x.ts": '// not `new Date()`\nexport const s = "Date.now()";\n' },
        "clock",
      ),
    ).toEqual([]);
  });
});

describe("intlCache", () => {
  it.each([
    ["a constructor", 'export const f = new Intl.NumberFormat("en");\n'],
    ["a list formatter", 'export const f = new Intl.ListFormat("en", { type: "and" });\n'],
    ["a toLocale* call", 'export const s = d.toLocaleDateString("en", { timeZone: z });\n'],
    ["an optional-chained one", "export const s = d?.toLocaleString();\n"],
  ])("refuses %s", (_name, source) => {
    expect(refusals({ "src/components/x.tsx": source }, "intlCache")).toEqual([
      "src/components/x.tsx:1",
    ]);
  });

  it.each(["src/app", "src/components", "src/lib", "src/db", "src/features", "src/i18n"])(
    "covers %s",
    (root) => {
      const file = `${root}/x.ts`;
      expect(
        refusals({ [file]: 'export const f = new Intl.PluralRules("en");\n' }, "intlCache"),
      ).toEqual([`${file}:1`]);
    },
  );

  it("leaves Intl.Locale alone — a parsed value, nothing to compile", () => {
    expect(
      refusals({ "src/lib/x.ts": 'export const l = new Intl.Locale("es-ES");\n' }, "intlCache"),
    ).toEqual([]);
  });

  it("leaves case folding alone", () => {
    expect(
      refusals({ "src/lib/x.ts": 'export const s = name.toLocaleLowerCase("es");\n' }, "intlCache"),
    ).toEqual([]);
  });

  it("leaves the cache itself, tests, and code outside the roots alone", () => {
    const source = 'export const f = new Intl.NumberFormat("en");\n';
    expect(
      refusals(
        {
          "src/lib/intl-cache.ts": source,
          "src/lib/format.test.ts": source,
          "src/test/x.ts": source,
          "scripts/x.mjs": source,
        },
        "intlCache",
      ),
    ).toEqual([]);
  });
});

describe("timezone", () => {
  it.each([
    ["a formatter with no options", 'export const f = new Intl.DateTimeFormat("en");\n'],
    [
      "a formatter whose options name no zone",
      'export const f = new Intl.DateTimeFormat("en", { hour: "numeric" });\n',
    ],
    ["a bare toLocaleString", "export const s = d.toLocaleString();\n"],
    ["an optional-chained toLocaleTimeString", 'export const s = d?.toLocaleTimeString("en");\n'],
    [
      "timeZoneName, which names how to print a zone, not which one",
      'export const f = new Intl.DateTimeFormat("en", { timeZoneName: "short" });\n',
    ],
  ])("refuses %s", (_name, source) => {
    expect(refusals({ "src/app/x.tsx": source }, "timezone")).toEqual(["src/app/x.tsx:1"]);
  });

  it.each([
    ["shorthand", 'new Intl.DateTimeFormat("en", { timeZone });'],
    ["a deliberate UTC", 'new Intl.DateTimeFormat("en", { timeZone: "UTC" });'],
    ["a zone read off a value", 'd.toLocaleString("en", { tz: shop.timeZone });'],
    ["a spread beside it", 'd.toLocaleDateString("en", { ...base, timeZone: z });'],
    [
      "options spanning lines and nesting",
      'd.toLocaleString("en", {\n  hour: cond ? "numeric" : "2-digit",\n  timeZone: z,\n});',
    ],
  ])("leaves %s alone", (_name, statement) => {
    expect(refusals({ "src/lib/x.ts": `export const v = ${statement}\n` }, "timezone")).toEqual([]);
  });

  it("leaves tests and src/i18n alone", () => {
    const source = "export const s = d.toLocaleString();\n";
    expect(refusals({ "src/lib/x.test.ts": source, "src/i18n/x.ts": source }, "timezone")).toEqual(
      [],
    );
  });
});

describe("redirectInTry: the bug", () => {
  const lines = (source, file = "src/app/x.ts") => refusals({ [file]: source }, "redirectInTry");

  it("catches a redirect written in a try body", () => {
    expect(lines("try {\n  redirect('/sign-in');\n} catch (e) {\n  log(e);\n}\n")).toEqual([
      "src/app/x.ts:2",
    ]);
  });

  it("catches the gate helpers, whose throw happens a frame down", () => {
    expect(
      lines(
        "async function f() {\n  try {\n    const { shop } = await requireShopSurface(slug);\n  } catch {\n    return null;\n  }\n  try {\n    await requireStaffSession();\n  } catch {}\n}\n",
      ),
    ).toEqual(["src/app/x.ts:3", "src/app/x.ts:8"]);
  });

  it("catches every unwinding call in one try, not only the first", () => {
    expect(lines("try {\n  if (!shop) notFound();\n  forbidden();\n} catch {}\n")).toEqual([
      "src/app/x.ts:2",
      "src/app/x.ts:3",
    ]);
  });

  it("catches one under a try/finally", () => {
    expect(lines("try {\n  unauthorized();\n} finally {\n  done();\n}\n")).toEqual([
      "src/app/x.ts:2",
    ]);
  });

  it("reaches into a callback nested in the try body — it still runs inside it", () => {
    expect(
      lines(
        "async function f() {\n  try {\n    await db.transaction(async (tx) => {\n      notFound();\n    });\n  } catch {}\n}\n",
      ),
    ).toEqual(["src/app/x.ts:4"]);
  });

  it("finds a local helper the file itself declares as never-returning", () => {
    expect(
      lines(
        'function done(path: string, notice: string): never {\n  revalidateAndRedirect(path, notice);\n}\nasync function page() {\n  try {\n    done(p, "invalid");\n  } catch {}\n}\n',
      ),
    ).toEqual(["src/app/x.ts:6"]);
  });

  it("finds one written as an arrow, one returning Promise<never>, and one declared with let", () => {
    expect(
      lines(
        "const refuse = (a: string): never => {\n  redirect(a);\n};\nasync function land(x: string): Promise<never> {\n  redirect(x);\n}\nlet late = async function (x: string): Promise<never> {\n  redirect(x);\n};\nasync function f() {\n  try {\n    refuse('1');\n    await land('1');\n    await late('1');\n  } catch {}\n}\n",
      ),
    ).toEqual(["src/app/x.ts:12", "src/app/x.ts:13", "src/app/x.ts:14"]);
  });

  it("catches a .catch() chained straight onto the gate", () => {
    expect(
      lines("const s = await requireShopSurface(slug, { allow: g }).catch(() => null);\n"),
    ).toEqual(["src/app/x.ts:1"]);
  });

  it("refuses a file it cannot parse rather than calling it clean", () => {
    const { status, diagnostics } = lintFixtures({ "src/app/x.ts": "try {\n  redirect('/x');\n" });
    expect(status).not.toBe(0);
    expect(diagnostics.some((diagnostic) => diagnostic.category === "parse")).toBe(true);
  });
});

describe("redirectInTry: the shapes that are correct", () => {
  const lines = (source, file = "src/app/x.ts") => refusals({ [file]: source }, "redirectInTry");

  it("leaves .then() alone — it does not swallow a throw", () => {
    expect(lines("await requireStaffSession().then((s) => s.user);\n")).toEqual([]);
  });

  it("allows a redirect in the catch — a refusal decided by the failure", () => {
    expect(
      lines("try {\n  await signIn();\n} catch (e) {\n  redirect('/sign-in?error=1');\n}\n"),
    ).toEqual([]);
  });

  it("allows a redirect after the try/catch has finished", () => {
    expect(lines("try {\n  await save();\n} catch {\n  log();\n}\nredirect('/done');\n")).toEqual(
      [],
    );
  });

  it("allows a redirect in a sibling function that merely follows a try", () => {
    expect(
      lines(
        "function a() {\n  try {\n    read();\n  } catch {}\n}\nfunction b() {\n  redirect('/x');\n}\n",
      ),
    ).toEqual([]);
  });

  it("ignores a property or method that merely shares the name", () => {
    expect(
      lines(
        "try {\n  await fetch(url, { redirect: 'manual' });\n  router.redirect('/x');\n} catch {}\n",
      ),
    ).toEqual([]);
  });

  it("ignores a redirect named in a comment or a string inside a try", () => {
    expect(
      lines(
        "try {\n  // redirect('/x') is what the catch does\n  /* notFound() */\n  log(\"redirect(/x)\");\n} catch {}\n",
      ),
    ).toEqual([]);
  });

  it("leaves a test alone — asserting a helper throws means catching the sentinel", () => {
    expect(lines("try {\n  redirect('/x');\n} catch {}\n", "src/lib/session.test.ts")).toEqual([]);
  });

  it("honours a biome-ignore with its reason on the offending line", () => {
    expect(
      lines(
        "try {\n  // biome-ignore lint/plugin/redirectInTry: re-thrown below\n  redirect('/x');\n} catch (e) {\n  throw e;\n}\n",
      ),
    ).toEqual([]);
  });

  it("refuses a hatch with no reason on it — the reason is the whole point", () => {
    const { status, diagnostics } = lintFixtures({
      "src/app/x.ts":
        "try {\n  // biome-ignore lint/plugin/redirectInTry\n  redirect('/x');\n} catch {}\n",
    });
    expect(status).not.toBe(0);
    expect(diagnostics.map((diagnostic) => diagnostic.line)).toContain(3);
  });
});

/**
 * softDelete reads the message bundles, so its fixtures are JSON: one key per line, and a
 * refusal is reported as the key path on that line. Every case is one the deleted
 * check-soft-delete guard carried.
 */
describe("softDelete", () => {
  const bundle = (locale, entries) => {
    const file = `src/i18n/locales/${locale}/x.json`;
    const text = `{\n${entries.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n")}\n}\n`;
    return refusals({ [file]: text }, "softDelete").map(
      (at) => entries[Number(at.split(":")[1]) - 2]?.[0] ?? at,
    );
  };

  it("catches the exact strings the diver roster shipped before 2026-08-20", () => {
    expect(
      bundle("en-US", [
        ["noticeDeleted", "Diver archived. Their bookings stay on file."],
        ["viewRemoved", "Archived"],
        ["restore", "Unarchive"],
        ["removing", "Archiving…"],
      ]).sort(),
    ).toEqual(["noticeDeleted", "removing", "restore", "viewRemoved"]);
  });

  // The euphemism does not have to be one of the banned words: these shipped on the diver
  // record while the old guard passed (issue #779).
  it.each([
    ["the caption that would not say Delete", "Takes this diver off your active lists."],
    ["its twin on the way back", "Diver restored. They're back on your active lists."],
    [
      "the sentence AGENTS.md forbids by name",
      "Certification removed. It no longer counts toward readiness; its history is kept for records.",
    ],
    ["the shorter form of it", "Deleted. Kept for records."],
    ["a quoted word inside the string", 'Say "Retire" to take it off the list'],
    ["the other renamings", "Deactivate this course"],
    ["the storage word itself", "This is a soft delete"],
  ])("catches %s", (_label, value) => {
    expect(bundle("en-US", [["notice", value]])).toEqual(["notice"]);
  });

  // "Remove" is not banned, and must not be: it is right for taking something out of a
  // collection it belongs to.
  it.each([
    ["a landmark off a site's list", "Remove this landmark"],
    ["a photo out of a gallery", "Removed from the gallery."],
    ["a member out of a buddy team", "Remove Priya from this team"],
    ["a heading about lists that are active", "Your active lists"],
    [
      "the delete vocabulary the rule asks for",
      "No undo. Deleting them instead is the reversible option.",
    ],
  ])("leaves %s alone", (_label, value) => {
    expect(bundle("en-US", [["label", value]])).toEqual([]);
  });

  it("catches the key name too — it is what the next author reads first", () => {
    expect(bundle("en-US", [["archiveSite", "Delete site"]])).toEqual(["archiveSite"]);
  });

  it("catches a nested key, and holds a Spanish bundle's keys to the same list", () => {
    const file = "src/i18n/locales/es-ES/x.json";
    expect(
      refusals({ [file]: '{\n  "row": {\n    "retireGear": "Eliminar"\n  }\n}\n' }, "softDelete"),
    ).toEqual([`${file}:3`]);
  });

  it("catches the Spanish action forms", () => {
    expect(
      bundle("es-ES", [
        ["one", "Archivar"],
        ["two", "Archivando…"],
        ["three", "Desarchivar"],
        ["four", "Lo quitamos de tus listas activas."],
      ]).sort(),
    ).toEqual(["four", "one", "three", "two"]);
  });

  it("leaves `archivo` alone — it is the ordinary Spanish word for a file", () => {
    expect(
      bundle("es-ES", [
        ["a", "Guarda el archivo donde lo encuentres."],
        ["b", "44 archivos, con el número de filas de cada uno"],
        ["c", "Trae el archivo a DiveDay"],
        ["d", "Eliminar"],
        ["e", "Restaurar"],
      ]),
    ).toEqual([]);
  });

  it("fails a locale nobody has written a word list for, rather than passing it", () => {
    const file = "src/i18n/locales/pt-BR/x.json";
    expect(refusals({ [file]: '{\n  "a": "Excluir"\n}\n' }, "softDelete")).toEqual([`${file}:1`]);
  });

  it("leaves JSON outside the bundles alone", () => {
    expect(
      refusals({ "src/content/x.json": '{\n  "archived": "Archived"\n}\n' }, "softDelete"),
    ).toEqual([]);
  });
});
