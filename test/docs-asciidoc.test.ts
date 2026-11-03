import { describe, expect, it } from "vitest";
import { parseDoc } from "../src/docs/parse.js";

describe("AsciiDoc docs", () => {
  it("collects inline monospace and source blocks when enabled", () => {
    const text = [
      "= API",
      "",
      "Call `Client.get()` and +Response.status_code+.",
      "",
      "[source,python]",
      "----",
      "client = Client()",
      "client.get(\"/\")",
      "----",
      "",
    ].join("\n");
    const result = parseDoc("docs/api.adoc", text, undefined, undefined, true);
    const tokens = result.anchors.map((anchor) => anchor.token);
    expect(tokens).toEqual(expect.arrayContaining(["Client.get()", "Response.status_code"]));
    expect(result.anchors.some((anchor) => anchor.surface === "fenceToken")).toBe(true);
    expect(result.anchors.find((anchor) => anchor.token === "Client.get()")?.line).toBe(3);
  });

  it("returns nothing when the flag is off", () => {
    const text = "Call `Client.get()`.\n\n[source,python]\n----\nclient.get(\"/\")\n----\n";
    expect(parseDoc("docs/api.adoc", text).anchors).toEqual([]);
  });

  it("tracks headings and ignores unsupported source languages", () => {
    const text = [
      "= One",
      "",
      "`alpha`",
      "",
      "== Two",
      "",
      "`alpha`",
      "",
      "[source,not-a-language]",
      "----",
      "`ignored`",
      "----",
      "",
    ].join("\n");
    const anchors = parseDoc("docs/api.adoc", text, undefined, undefined, true).anchors;
    expect(new Set(anchors.filter((anchor) => anchor.token === "alpha").map((anchor) => anchor.contextFp)).size).toBe(2);
    expect(anchors.map((anchor) => anchor.token)).not.toContain("ignored");
  });

  it("handles missing languages and invalid plus tokens", () => {
    expect(parseDoc("docs/api.adoc", "", undefined, undefined, true).anchors).toEqual([]);
    const text = "[source]\nnot a block\n\n[source,]\n----\nclient.get(\"/\")\n----\n\n+two words+ and +Client.get()+\n";
    const tokens = parseDoc("docs/api.adoc", text, undefined, undefined, true).anchors.map((anchor) => anchor.token);
    expect(tokens).not.toContain("two words");
    expect(tokens).toContain("Client.get()");
  });

  it("handles unclosed delimited blocks", () => {
    const text = "[source,python]\n----\nimport httpx\nhttpx.get(\"/\")\n";
    expect(() => parseDoc("docs/api.adoc", text, undefined, undefined, true)).not.toThrow();
  });
});
