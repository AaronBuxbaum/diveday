// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings here are
// source-code fixtures, and a `${…}` in one is the template interpolation the
// masker under test has to keep the braces of. Making them real template
// literals would substitute the very thing being asserted about.

import { describe, expect, it } from "vitest";

import { findRedirectsInTry, maskSource } from "./check-redirect-in-try.mjs";

/**
 * A rule this narrow is only worth having if it sees the shape it was written
 * for and stays quiet on the several that look like it. The expensive half is
 * the second: `catch { redirect(…) }` is the *correct* pattern and appears in
 * this tree a dozen times, so a rule that flagged it would be turned off within
 * a week and the real bug would go back to being invisible.
 */

const calls = (source) => findRedirectsInTry(source).map((found) => found.call);
const lines = (source) => findRedirectsInTry(source).map((found) => found.line);

describe("the bug", () => {
  it("catches a redirect written in a try body", () => {
    expect(calls("try {\n  redirect('/sign-in');\n} catch (e) {\n  log(e);\n}")).toEqual([
      "redirect",
    ]);
  });

  it("catches the gate helpers, whose throw happens a frame down", () => {
    expect(
      calls(
        "try {\n  const { shop } = await requireShopSurface(slug);\n} catch {\n  return null;\n}",
      ),
    ).toEqual(["requireShopSurface"]);
    expect(calls("try {\n  await requireStaffSession();\n} catch {}")).toEqual([
      "requireStaffSession",
    ]);
  });

  it("catches notFound and the rest of the unwinding family", () => {
    expect(calls("try {\n  if (!shop) notFound();\n  forbidden();\n} catch {}")).toEqual([
      "notFound",
      "forbidden",
    ]);
  });

  it("reaches into a callback nested in the try body — it still runs inside it", () => {
    expect(
      calls("try {\n  await db.transaction(async (tx) => {\n    notFound();\n  });\n} catch {}"),
    ).toEqual(["notFound"]);
  });

  it("reports the line the call is really on", () => {
    expect(lines("const a = 1;\ntry {\n\n  redirect('/x');\n} catch {}")).toEqual([4]);
  });

  /**
   * The list of names was three helpers short on the day it was written —
   * `done()` in `settings/export/actions.ts` among them, which is the refusal
   * path of the full-shop data export. Reading the `: never` annotation closes
   * the class instead of chasing each new helper into a list.
   */
  it("finds a local helper the file itself declares as never-returning", () => {
    const source =
      'function done(path, notice): never {\n  revalidateAndRedirect(path, notice);\n}\nasync function page() {\n  try {\n    done(p, "invalid");\n  } catch {}\n}';
    expect(calls(source)).toEqual(["done"]);
  });

  it("finds one written as an arrow, and one returning Promise<never>", () => {
    expect(
      calls("const refuse = (a): never => {\n  redirect(a);\n};\ntry { refuse(1); } catch {}"),
    ).toEqual(["refuse"]);
    expect(
      calls(
        "async function land(x): Promise<never> {\n  redirect(x);\n}\ntry { await land(1); } catch {}",
      ),
    ).toEqual(["land"]);
  });

  /** The same swallow with no `try` anywhere to grep for. */
  it("catches a .catch() chained straight onto the gate", () => {
    const found = findRedirectsInTry(
      "const s = await requireShopSurface(slug, { allow: g }).catch(() => null);",
    );
    expect(found).toEqual([{ call: "requireShopSurface", line: 1, shape: "catch" }]);
  });

  it("leaves .then() alone — it does not swallow a throw", () => {
    expect(calls("await requireStaffSession().then((s) => s.user);")).toEqual([]);
  });
});

/**
 * The property that makes this a control rather than a decoration: a lexical
 * scan that loses its footing sees zero `try` blocks and would otherwise report
 * a clean file. It must be impossible to tell those two apart by accident.
 */
describe("failing loudly rather than open", () => {
  it("refuses to answer for a file whose braces it could not match", () => {
    expect(() => findRedirectsInTry("try {\n  redirect('/x');\n")).toThrow(/not scanned/);
  });

  it("does not let one apostrophe in JSX text blank the rest of the file", () => {
    // A raw apostrophe is not a string opener — a JS string cannot span a
    // newline — and reading it as one used to blank every brace up to the next
    // quote anywhere later in the file.
    const source =
      "const a = <p>Don't forget</p>;\nfunction page() {\n  try {\n    redirect('/x');\n  } catch {}\n}";
    expect(calls(source)).toEqual(["redirect"]);
  });
});

describe("the shapes that are correct", () => {
  it("allows a redirect in the catch — a refusal decided by the failure", () => {
    expect(
      calls("try {\n  await signIn();\n} catch (e) {\n  redirect('/sign-in?error=1');\n}"),
    ).toEqual([]);
  });

  it("allows a redirect after the try/catch has finished", () => {
    expect(calls("try {\n  await save();\n} catch {\n  log();\n}\nredirect('/done');")).toEqual([]);
  });

  it("allows a redirect in a sibling function that merely follows a try", () => {
    expect(
      calls(
        "function a() {\n  try {\n    read();\n  } catch {}\n}\nfunction b() {\n  redirect('/x');\n}",
      ),
    ).toEqual([]);
  });

  it("ignores a property or method that merely shares the name", () => {
    expect(
      calls(
        "try {\n  await fetch(url, { redirect: 'manual' });\n  router.redirect('/x');\n} catch {}",
      ),
    ).toEqual([]);
  });

  it("honours the escape hatch on the offending line", () => {
    expect(
      calls(
        "try {\n  redirect('/x'); // diveday:allow-redirect-in-try: re-thrown below\n} catch {}",
      ),
    ).toEqual([]);
  });

  it("refuses a hatch with no reason on it — the reason is the whole point", () => {
    expect(calls("try {\n  redirect('/x'); // diveday:allow-redirect-in-try\n} catch {}")).toEqual([
      "redirect",
    ]);
  });
});

describe("text that only looks like code", () => {
  it("ignores a redirect named in a comment inside a try", () => {
    expect(
      calls("try {\n  // redirect('/x') is what the catch does\n  await save();\n} catch {}"),
    ).toEqual([]);
    expect(calls("try {\n  /* notFound() */\n  await save();\n} catch {}")).toEqual([]);
  });

  it("ignores a redirect named in a string inside a try", () => {
    expect(calls('try {\n  log("redirect(/x)");\n} catch {}')).toEqual([]);
  });

  it("does not read a `try` written in prose as a block", () => {
    expect(calls("// try { redirect('/x') } is the bug\nredirect('/x');")).toEqual([]);
  });
});

describe("the masker, which every other answer rests on", () => {
  const braces = (source) => {
    let depth = 0;
    for (const character of maskSource(source)) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
    return depth;
  };

  it("keeps a template literal's interpolation braces and blanks the rest", () => {
    expect(braces("const a = `${x} } } `;\n")).toBe(0);
  });

  it("survives an emoji, which shifts every later offset if indexed by code point", () => {
    // Real shape, from src/lib/demo-roles.ts: one astral character per row.
    expect(braces('const roles = [\n  { id: "captain", icon: "⚓", name: "Sal" },\n];\n')).toBe(0);
    expect(braces('const roles = [\n  { id: "diver", icon: "🐬", name: "Guest" },\n];\n')).toBe(0);
  });

  it("does not read a JSX closing tag as a regex literal", () => {
    // `</` was the costly false positive: read as a regex, it swallowed the rest
    // of the line — braces included — and silently lost whole try blocks.
    expect(braces("const a = <div>{x}</div>;\nfunction b() { return 1; }\n")).toBe(0);
  });

  it("still blanks a real regex literal, quotes and braces and all", () => {
    expect(braces("const a = /[{'\"]/;\nfunction b() { return 1; }\n")).toBe(0);
    expect(braces('const a = list.filter((x) => /[}"]/.test(x));\n')).toBe(0);
  });

  it("keeps every offset, so a reported line is the real one", () => {
    const source = 'const a = "xx";\n// yy\nredirect();\n';
    expect(maskSource(source)).toHaveLength(source.length);
    expect(maskSource(source).split("\n")).toHaveLength(source.split("\n").length);
  });
});
