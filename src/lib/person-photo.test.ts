import { describe, expect, it } from "vitest";
import {
  diverPhotoDisplayPath,
  personPhotoDisplayPath,
  privatePersonPhotoId,
  privatePersonPhotoResponse,
} from "./person-photo";

const id = "abcdefghijklmnopqrstuv.jpg";

describe("private person photo delivery", () => {
  it("only creates a same-origin URL for an opaque key in the private namespace", () => {
    const url = `https://media.example/private-person-photos/${id}`;
    expect(privatePersonPhotoId(url)).toBe(id);
    expect(personPhotoDisplayPath("person-id", url)).toBe(`/api/person-photos/person-id/${id}`);
    expect(privatePersonPhotoId("https://media.example/person-photos/jane.jpg")).toBeNull();
    expect(
      privatePersonPhotoId(`https://media.example/private-person-photos/${id}?x=1`),
    ).toBeNull();
    expect(privatePersonPhotoId("/demo-divers/priya.webp")).toBeNull();
    expect(diverPhotoDisplayPath({ id: "x", staffPhotoPath: "/demo-divers/priya.webp" })).toBe(
      "/demo-divers/priya.webp",
    );
    expect(
      diverPhotoDisplayPath({
        id: "x",
        staffPhotoPath: "/demo-divers/priya.webp",
        diverPhotoSuppressed: true,
      }),
    ).toBeNull();
  });

  it("sends private uncacheable image bytes and refuses unexpected types", () => {
    const response = privatePersonPhotoResponse({
      bytes: new ArrayBuffer(0),
      contentType: "image/jpeg",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(
      privatePersonPhotoResponse({ bytes: new ArrayBuffer(0), contentType: "text/html" }).status,
    ).toBe(404);
  });
});
