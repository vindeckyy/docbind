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
    expect(anchors.find((anchor) => anchor.token === "get")?.surface).toBe("explicitRef");
    expect(anchors.find((anchor) => anchor.token === "Client#status")?.surface).toBe("inlineCode");
    expect(anchors.find((anchor) => anchor.token === "Client#name")?.line).toBe(11);
  });

  it("qualifies relative links with the enclosing type", () => {
    expect(parseJavadoc("src/Client.java", "{@link #get()}", 1, "Client").anchors.map((anchor) => anchor.token)).toEqual([
      "Client#get",
    ]);
    expect(parseJavadoc("src/Client.java", "{@link Other#get}", 1, "Client").anchors.map((anchor) => anchor.token)).toEqual([
      "Other#get",
    ]);
    expect(parseJavadoc("src/Client.java", "{@link #get()}", 1).anchors.map((anchor) => anchor.token)).toEqual([
      "get",
    ]);
  });

  it("strips parameter lists with spaces", () => {
    expect(parseJavadoc("src/Client.java", "{@link #get(int, String)}", 1, "Client").anchors.map((anchor) => anchor.token)).toEqual([
      "Client#get",
    ]);
    expect(
      parseJavadoc("src/Client.java", "{@link Other#get(int, String) the getter}", 1, "Client").anchors.map(
        (anchor) => anchor.token,
      ),
    ).toEqual(["Other#get"]);
    expect(parseJavadoc("src/Client.java", "{@link Client the client}", 1).anchors.map((anchor) => anchor.token)).toEqual([
      "Client",
    ]);
  });

  it("drops historical references", () => {
    const anchors = parseJavadoc("src/Client.java", "Renamed in v2. Use `oldName`.", 1).anchors;
    expect(anchors).toEqual([]);
  });
});
