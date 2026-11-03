import { describe, expect, it } from "vitest";
import { parseJavadoc } from "../src/docs/parse.js";

describe("Javadoc comments", () => {
  it("collects links, code tags, and backticks with line offsets", () => {
    const text = [
      "Call {@link #get()} and {@code Client#status}.",
      "Also see `Client#name`.",
      "",
    ].join("\n");
    const anchors = parseJavadoc("src/Client.java", text, 10).anchors;
    expect(anchors.find((anchor) => anchor.token === "get()")?.surface).toBe("explicitRef");
    expect(anchors.find((anchor) => anchor.token === "Client#status")?.surface).toBe("inlineCode");
    expect(anchors.find((anchor) => anchor.token === "Client#name")?.line).toBe(11);
  });

  it("drops historical references", () => {
    const anchors = parseJavadoc("src/Client.java", "Renamed in v2. Use `oldName`.", 1).anchors;
    expect(anchors).toEqual([]);
  });
});
