import { describe, expect, it } from "vitest";
import { parseDoc, parseDocstring } from "../src/docs/parse.js";

describe("reStructuredText docs", () => {
  it("collects literals, roles, and code blocks", () => {
    const text = [
      "API",
      "===",
      "",
      "Call ``Client.get()`` and :func:`Client.request`.",
      "",
      ".. code-block:: python",
      "",
      "   client = Client()",
      "   client.get(\"/\")",
      "",
    ].join("\n");
    const result = parseDoc("docs/api.rst", text);
    const tokens = result.anchors.map((anchor) => anchor.token);
    expect(tokens).toEqual(expect.arrayContaining(["Client.get()", "Client.request"]));
    expect(result.anchors.find((anchor) => anchor.token === "Client.request")?.surface).toBe("explicitRef");
    expect(result.anchors.some((anchor) => anchor.surface === "fenceToken")).toBe(true);
    expect(result.anchors.find((anchor) => anchor.token === "Client.get()")?.line).toBe(4);
  });

  it("uses the nearest heading for context", () => {
    const text = ["One", "---", "", "``alpha``", "", "Two", "---", "", "``alpha``", ""].join("\n");
    const anchors = parseDoc("docs/api.rst", text).anchors;
    const fingerprints = anchors.filter((anchor) => anchor.token === "alpha").map((anchor) => anchor.contextFp);
    expect(new Set(fingerprints).size).toBe(2);
  });

  it("ignores unsupported directives and negative context", () => {
    const text = [
      ".. code-block:: not-a-language",
      "",
      "   ``ignored``",
      "",
      "This was renamed in v2. Use ``oldName``.",
      "",
    ].join("\n");
    const tokens = parseDoc("docs/api.rst", text).anchors.map((anchor) => anchor.token);
    expect(tokens).not.toContain("ignored");
    expect(tokens).not.toContain("oldName");
  });

  it("handles empty literals and empty code blocks", () => {
    const text = ["Blank ```` literal.", "", ".. code-block:: python", "", "Text follows.", ""].join("\n");
    expect(() => parseDoc("docs/api.rst", text)).not.toThrow();
  });

  it("handles empty docstrings and role overlaps", () => {
    expect(parseDocstring("pkg/models.py", "", 1).anchors).toEqual([]);
    const anchors = parseDocstring("pkg/models.py", ":meth:`Client.send` and `Client.get`", 1).anchors;
    expect(anchors.map((anchor) => anchor.token)).toEqual(["Client.send", "Client.get"]);
    expect(anchors.map((anchor) => anchor.surface)).toEqual(["explicitRef", "inlineCode"]);
  });

  it("ignores option lines before code", () => {
    const text = [
      ".. code-block:: python",
      "   :linenos:",
      "",
      "   import httpx",
      "   httpx.get(\"/\")",
      "",
    ].join("\n");
    const tokens = parseDoc("docs/api.rst", text).anchors.map((anchor) => anchor.token);
    expect(tokens).toContain("httpx.get");
  });
});
