import { describe, expect, it } from "vitest";
import { parseCsv } from "./import";

describe("parseCsv", () => {
  it("reads quoted fields, embedded commas, doubled quotes, and CRLF", () => {
    const text = 'a,b,c\r\n"x,y","she said ""hi""",z\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x,y", 'she said "hi"', "z"],
    ]);
  });

  it("handles bare LF, a trailing row without a newline, and a leading BOM", () => {
    const text = "﻿name,email\nAda\n";
    expect(parseCsv(text)).toEqual([["name", "email"], ["Ada"]]);
  });

  it("keeps embedded newlines inside quotes", () => {
    expect(parseCsv('a\n"line1\nline2",b\n')).toEqual([["a"], ["line1\nline2", "b"]]);
  });

  it("reads old-Mac CR and a file that mixes line endings, one row per line", () => {
    expect(parseCsv("a,b\rc,d\r")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\r\nc,d\ne,f\rg,h\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("keeps blank rows mid-file and drops only the one after a final line break", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a\n")).toEqual([["a"]]);
    expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
    expect(parseCsv("a\n\n")).toEqual([["a"], [""]]);
    expect(parseCsv("a,b,")).toEqual([["a", "b", ""]]);
  });

  // The malformed-quote policy: read leniently, never refused, so the preview shows exactly what
  // the server will import. Papa Parse replaced a hand-written reader (ADR
  // 20261102-papaparse-csv-reader); each "Changed" case below is one where the two differ.
  describe("malformed quoting", () => {
    it("takes the rest of the file into one cell after an unclosed quote", () => {
      expect(parseCsv('a,"b,c\nd,e')).toEqual([["a", "b,c\nd,e"]]);
      // Changed: the old reader read a doubled quote here as one quote.
      expect(parseCsv('"a""b')).toEqual([['a""b']]);
    });

    it("keeps a quote that does not open a cell as a literal character", () => {
      // Changed: the old reader opened a quoted run mid-cell and dropped the quotes, reading
      // this as `Bob Bobby Smith`.
      expect(parseCsv('Bob "Bobby" Smith,x')).toEqual([['Bob "Bobby" Smith', "x"]]);
      // Changed: the old reader read this as `5'10,x`, one cell.
      expect(parseCsv("5'10\",x")).toEqual([["5'10\"", "x"]]);
    });

    it("keeps reading after text that follows a closing quote, up to a quote that closes", () => {
      // Changed: the old reader appended the text (`abcd`) and ended the cell at the comma.
      expect(parseCsv('"ab"cd,e\nf,g')).toEqual([['ab"cd,e\nf,g']]);
      expect(parseCsv('"ab"cd,e\n"f",g')).toEqual([['ab"cd,e\n"f', "g"]]);
      // Spaces between a closing quote and the comma are allowed and dropped.
      expect(parseCsv('"ab" ,c')).toEqual([["ab", "c"]]);
    });

    it("reads a quoted CRLF as LF", () => {
      // Changed: the old reader kept a quoted CR byte for byte.
      expect(parseCsv('"x\r\ny",z')).toEqual([["x\ny", "z"]]);
    });
  });
});
