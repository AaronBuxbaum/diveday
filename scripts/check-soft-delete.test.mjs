import { describe, expect, it } from "vitest";

import { findArchiveVocabulary, UnknownLocaleError } from "./check-soft-delete.mjs";

const paths = (bundle, locale = "en-US") =>
  findArchiveVocabulary(bundle, locale).violations.map((v) => `${v.kind}:${v.keyPath}`);

describe("English bundles", () => {
  it("catches the exact strings the diver roster shipped before 2026-08-20", () => {
    expect(
      paths({
        page: { noticeDeleted: "Diver archived. Their bookings stay on file." },
        list: { viewRemoved: "Archived", restore: "Unarchive" },
        remove: { removing: "Archiving…" },
      }),
    ).toEqual([
      "value:page.noticeDeleted",
      "value:list.viewRemoved",
      "value:list.restore",
      "value:remove.removing",
    ]);
  });

  it("catches the key name too — it is what the next author reads first", () => {
    expect(paths({ edit: { archiveSite: "Delete site" } })).toEqual(["key:edit.archiveSite"]);
  });

  it("catches the other ways a soft delete gets renamed on screen", () => {
    expect(paths({ a: "Deactivate this course", b: "This is a soft delete" })).toEqual([
      "value:a",
      "value:b",
    ]);
  });

  it("passes the delete vocabulary the rule asks for", () => {
    expect(
      paths({
        page: { noticeDeleted: "Diver deleted." },
        list: { viewRemoved: "Deleted", restore: "Restore" },
        erase: { noUndoNote: "No undo. Deleting them instead is the reversible option." },
      }),
    ).toEqual([]);
  });

  it("leaves an unrelated archive alone — the public review archive is a place, not an action", () => {
    // Deliberately still caught: English cannot tell the two apart cheaply, so
    // this is what the `allowed` map in the script exists for.
    expect(paths({ reviews: { heading: "Review archive" } })).toEqual(["value:reviews.heading"]);
  });
});

describe("Spanish bundles", () => {
  it("catches the action forms", () => {
    expect(
      paths(
        {
          row: { archive: "Archivar", archiving: "Archivando…", restore: "Desarchivar" },
        },
        "es-ES",
      ),
    ).toEqual([
      "key:row.archive",
      "value:row.archive",
      "key:row.archiving",
      "value:row.archiving",
      "value:row.restore",
    ]);
  });

  it("leaves `archivo` alone — it is the ordinary Spanish word for a file", () => {
    // Real strings from diver.json: the import and export copy is full of these,
    // and an English-shaped rule would refuse every one of them.
    expect(
      paths(
        {
          a: { value: "Guarda el archivo donde lo encuentres." },
          b: { value: "44 archivos, con el número de filas de cada uno" },
          c: { value: "Trae el archivo a DiveDay" },
        },
        "es-ES",
      ),
    ).toEqual([]);
  });

  it("passes the delete vocabulary", () => {
    expect(paths({ row: { delete: "Eliminar", restore: "Restaurar" } }, "es-ES")).toEqual([]);
  });
});

describe("a locale nobody has written a word list for", () => {
  it("fails rather than passing by default", () => {
    expect(() => findArchiveVocabulary({ a: "archived" }, "pt-BR")).toThrow(UnknownLocaleError);
  });
});
