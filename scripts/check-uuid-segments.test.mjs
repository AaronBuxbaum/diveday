import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

const run = (files) => runGuard("check-uuid-segments.mjs", files);
const page = "src/app/shop/[shopSlug]/trips/[id]/page.tsx";

describe("check-uuid-segments", () => {
  it("passes a page that narrows its [id] before reading", () => {
    const result = run({
      [page]:
        "export default async function Page({ params }) {\n  const { id } = await params;\n  if (!uuidParam(id)) notFound();\n}\n",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("refuses one that reads it unguarded, naming the segment and the fix", () => {
    const result = run({
      [page]:
        "export default async function Page({ params }) {\n  const { id } = await params;\n}\n",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${page}: [id] reaches a query unguarded`);
    expect(result.stderr).toContain("if (!uuidParam(<segment>)) notFound();");
  });

  it("follows a destructuring rename to the local the guard must see", () => {
    const renamed = "src/app/shop/[shopSlug]/divers/[personId]/page.tsx";
    const guarded = run({
      [renamed]:
        "const { personId: diverId } = await params;\nif (!uuidParam(diverId)) notFound();\n",
    });
    expect(guarded.status).toBe(0);
    const unguarded = run({ [renamed]: "const { personId: diverId } = await params;\n" });
    expect(unguarded.stderr).toContain("expected uuidParam(personId) or uuidParam(diverId)");
  });

  it("does not read a type annotation as a rename", () => {
    const file = "src/app/x/[tripId]/page.tsx";
    const { stderr } = run({ [file]: "type P = { tripId: string };\n" });
    expect(stderr).toContain("expected uuidParam(tripId))");
  });

  it("checks every id segment on the path, not only the last", () => {
    const file = "src/app/x/[tripId]/y/[bookingId]/page.tsx";
    const { stderr } = run({ [file]: "if (!uuidParam(bookingId)) notFound();\n" });
    expect(stderr).toContain(`${file}: [tripId] reaches a query unguarded`);
    expect(stderr).not.toContain("[bookingId] reaches");
  });

  it("leaves segments that are not ids, and files that are not pages, alone", () => {
    expect(
      run({
        "src/app/s/[shopSlug]/page.tsx": "export default function P() {}\n",
        "src/app/s/[shopSlug]/[token]/page.tsx": "export default function P() {}\n",
        "src/app/x/[id]/route.ts": "export function GET() {}\n",
      }).status,
    ).toBe(0);
  });
});
