/**
 * Reading a `.env`-shaped document: one line, one value.
 *
 * Seven scripts used to carry their own copy of this three-line parser, and
 * every copy took the raw text after `=` as the value. That is right until a
 * value contains a space and therefore has to be written quoted --
 * `SES_FROM_EMAIL="DiveDay <noreply@ses.dive.day>"` -- at which point the
 * quotes become part of the value and travel wherever the script pushes it.
 *
 * The failure that found this was invisible everywhere it was cheap to notice.
 * Next.js loads `.env.local` through a real dotenv parser, which unquotes, so
 * local and CI runs were correct; `scripts/import-vercel-env.mjs` piped the
 * hand-parsed value to `vercel env add`, so Vercel Production stored the
 * quote characters. SES was then handed a quoted display name with no address
 * after it and refused every send with "Missing final '@domain'" -- all
 * outbound production mail, for as long as the value had been set, with
 * nothing failing anywhere a test could see it (issue #517).
 *
 * So this is the one parser, and unquoting is its whole reason to exist.
 * `sync-github-secrets.mjs` pushes the same documents into GitHub Actions
 * secrets, where the identical corruption is just as silent.
 */

const ENV_LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/;

/**
 * Strip one pair of matching surrounding quotes, the way dotenv does.
 *
 * Only a *matching* pair, and only the outermost one: a value that genuinely
 * begins with a quote character (`"` alone, or `"a` with no closer) is left
 * exactly as written rather than half-stripped into something new. Inner
 * quotes are untouched -- they are part of the value.
 */
export function unquoteEnvValue(value) {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return value;
  if (value.length < 2 || value.at(-1) !== quote) return value;
  return value.slice(1, -1);
}

/** Every `KEY=value` line in a dotenv document, as entries, values unquoted. */
export function dotenvEntries(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(ENV_LINE);
    return match ? [[match[1], unquoteEnvValue(match[2])]] : [];
  });
}

/** Every `KEY=value` line in a dotenv document, as an object. */
export function parseDotenv(text) {
  return Object.fromEntries(dotenvEntries(text));
}

/** Every `KEY=value` line in a dotenv document, as a Map. */
export function dotenvMap(text) {
  return new Map(dotenvEntries(text));
}

/**
 * Serialize one value back into a `KEY=value` line -- the exact inverse of
 * `unquoteEnvValue`, and the only thing that should ever write one.
 *
 * Quotes are added when the value would not survive the round trip without
 * them (whitespace, or a leading quote character that reading back would
 * strip) and omitted otherwise, so the generated files keep the plain
 * unquoted shape a reader expects for ordinary values.
 *
 * There is deliberately no escaping: `unquoteEnvValue` strips one pair of
 * matching quotes and unescapes nothing, so inventing a `\"` here would write
 * a line that reads back as something else. A value holding both kinds of
 * quote has no faithful representation and throws instead of being silently
 * mangled -- which is the failure mode this whole module exists to end.
 */
export function formatEnvValue(value) {
  const needsQuoting = /^\s|\s$|\s/.test(value) || value[0] === '"' || value[0] === "'";
  if (!needsQuoting) return value;
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  throw new Error(
    `A dotenv value containing both ' and " cannot be written faithfully: ${value.slice(0, 40)}`,
  );
}
