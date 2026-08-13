import { describe, expect, it } from "vitest";
import { dotenvMap, formatEnvValue, parseDotenv, unquoteEnvValue } from "./dotenv.mjs";

/**
 * The regression these cover is issue #517: `SES_FROM_EMAIL` reached Vercel
 * Production with its dotenv quotes still attached, SES read the result as a
 * display name with no address after it, and every production email failed
 * with "Missing final '@domain'". Nothing local could see it -- Next.js reads
 * `.env.local` through a real dotenv parser, which unquotes.
 */

describe("unquoteEnvValue", () => {
  it("strips one matching pair of surrounding quotes", () => {
    expect(unquoteEnvValue('"DiveDay <noreply@ses.dive.day>"')).toBe(
      "DiveDay <noreply@ses.dive.day>",
    );
    expect(unquoteEnvValue("'single'")).toBe("single");
  });

  it("leaves an ordinary unquoted value alone", () => {
    expect(unquoteEnvValue("https://dive.day")).toBe("https://dive.day");
    expect(unquoteEnvValue("")).toBe("");
  });

  it("keeps quotes that are part of the value rather than half-stripping them", () => {
    // A lone quote, an unterminated one, and a mismatched pair are all values
    // in their own right -- stripping either end would invent a new string.
    expect(unquoteEnvValue('"')).toBe('"');
    expect(unquoteEnvValue('"unterminated')).toBe('"unterminated');
    expect(unquoteEnvValue("'mismatched\"")).toBe("'mismatched\"");
  });

  it("leaves inner quotes untouched", () => {
    expect(unquoteEnvValue('"say \\"hi\\""')).toBe('say \\"hi\\"');
  });
});

describe("parseDotenv", () => {
  it("unquotes a value that had to be written quoted", () => {
    const document = 'SES_FROM_EMAIL="DiveDay <noreply@ses.dive.day>"\nAPP_HOST=https://dive.day\n';
    expect(parseDotenv(document)).toEqual({
      SES_FROM_EMAIL: "DiveDay <noreply@ses.dive.day>",
      APP_HOST: "https://dive.day",
    });
  });

  it("keeps a deliberately blank value, so a cleared secret still syncs", () => {
    expect(parseDotenv("STRIPE_SECRET_KEY=\n")).toEqual({ STRIPE_SECRET_KEY: "" });
  });

  it("ignores comments and blank lines", () => {
    expect(parseDotenv("# a comment\n\nAPP_HOST=https://dive.day\n")).toEqual({
      APP_HOST: "https://dive.day",
    });
  });

  it("reads CRLF documents", () => {
    expect(parseDotenv("APP_HOST=https://dive.day\r\n")).toEqual({ APP_HOST: "https://dive.day" });
  });

  it("dotenvMap is the same parse as a Map", () => {
    expect(dotenvMap('A="one two"\n').get("A")).toBe("one two");
  });
});

describe("formatEnvValue", () => {
  it("quotes only what would not survive being read back", () => {
    expect(formatEnvValue("DiveDay <noreply@ses.dive.day>")).toBe(
      '"DiveDay <noreply@ses.dive.day>"',
    );
    expect(formatEnvValue("https://dive.day")).toBe("https://dive.day");
    expect(formatEnvValue("")).toBe("");
  });

  it("quotes a value that merely starts with a quote character", () => {
    // Written bare it would read back with that quote stripped as if it were
    // a delimiter.
    expect(formatEnvValue('"quoted-looking')).toBe("'\"quoted-looking'");
  });

  it("refuses a value it cannot represent faithfully", () => {
    expect(() => formatEnvValue("both ' and \" quotes")).toThrow(/cannot be written faithfully/);
  });
});

describe("the write/read round trip", () => {
  const values = [
    "DiveDay <noreply@ses.dive.day>",
    "https://dive.day",
    "postgres://user:pass@host/db?sslmode=verify-full",
    "MzQ2MAICY1ND/ZTMstSUxEp9QxNLS1NzI0tTfcfEovw8p9KKpMTSXAA=",
    "",
    "  leading and trailing  ",
    "value with 'inner' single quotes",
  ];

  /**
   * The property that protects production. A value crosses this pair of
   * functions four times on its way to a deployment: written into
   * `.env.example`, embedded into the credentials secret, distributed into
   * `.env.vercel`, and pushed to Vercel. Anything that does not survive the
   * round trip arrives at runtime as a different string than the one written
   * -- which is exactly what happened to the SES sender in issue #517, where
   * the quotes its space required became part of the address.
   *
   * The cases are held here as literals rather than read from the registry:
   * every checked-in constant has since moved into the code that reads it
   * (`src/lib/configured.ts`), so the registry has none left to enumerate, and
   * the parser still has to be right for the values that do flow through it.
   */
  it.each(values)("survives being written and read back: %j", (value) => {
    expect(parseDotenv(`KEY=${formatEnvValue(value)}\n`).KEY).toBe(value);
  });
});
