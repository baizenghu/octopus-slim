import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("octopus", 16)).toBe("octopus");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("octopus-status-output", 10)).toBe("octopus-…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});
