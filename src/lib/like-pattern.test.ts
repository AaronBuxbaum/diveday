import { describe, expect, it } from "vitest";
import { containsPattern, escapeLikePattern } from "./like-pattern";

describe("like patterns", () => {
  it("takes wildcards and the escape character literally", () => {
    expect(escapeLikePattern("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(containsPattern("a%b")).toBe("%a\\%b%");
  });
});
