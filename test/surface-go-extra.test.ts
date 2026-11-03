import { describe, expect, it } from "vitest";
import { extractGo } from "../src/surface/go.js";
import { tempProject } from "./helpers.js";

function extraProject(): string {
  return tempProject({
    "go.mod": "module example.com/extra\n\ngo 1.24\n",
    "extra/extra.go": `
package extra

import (
    "fmt"
    alias "example.com/x"
)

func NoBody() {}
func NoParams() {}
func Named(a, b int, c *User, d []string, e map[string]int, f chan int, g func(int) error) (result string, err error) { return }

type (
    Alias2 = User
    Number int
)

type Box[T any] struct {
    Value T
    *Base
    Inline struct{ X int }
}

type Reader interface {
    io.Reader
    Read(p []byte) (n int, err error)
}

const (
    A = iota
    B int = 1
    C, D = 2, 3
    I, J int = 5, 6
    Typed int = 4
    NoValue
    Expr = 1 + 2
)

var (
    E = 3.14
    F string = "x"
    G, H = true, false
)

type hidden int
type hiddenType struct{}

func EmptyReturns() () { return }
func (h *hiddenType) Orphan() {}
func (h hiddenType) PrivateReceiver() {}

func (b *Box[T]) ValueOf() T { return b.Value }
`,
  });
}

describe("Go surface edge cases", () => {
  it("parses grouped declarations and complex parameters", () => {
    const root = extraProject();
    const result = extractGo(root, ["extra/extra.go"]);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining([
      "NoBody", "NoParams", "Named", "Alias2", "Number", "Box", "Reader",
      "A", "B", "C", "D", "E", "F", "G", "H", "ValueOf",
    ]));
    const named = result.symbols.find((symbol) => symbol.name === "Named");
    expect(named?.shape.params?.map((param) => param.name)).toEqual(expect.arrayContaining([
      "a", "c", "d", "e", "f", "g",
    ]));
    expect(named?.shape.returnType).toContain("result");
    expect(result.symbols.find((symbol) => symbol.name === "Box")?.shape.typeParams).toBe("T any");
    expect(result.symbols.find((symbol) => symbol.name === "ValueOf")?.parentId).toContain("Box");
  });

  it("handles empty files and syntax errors", () => {
    const root = tempProject({ "empty.go": "package empty\n" });
    expect(extractGo(root, ["empty.go"]).symbols).toEqual([]);
    const bad = tempProject({
      "bad.go": "type Broken struct {\n",
      "bad2.go": "type Other interface {\n",
      "bad3.go": "const (\n",
      "bad4.go": "func Broken( {\n",
      "bad5.go": "func ( {\n",
      "bad6.go": "func 1() {}\n",
      "bad7.go": "type\n",
      "bad8.go": "func NoParams {\n",
      "bad9.go": "import (\n",
      "bad10.go": "func NoReturn() (\n",
      "bad11.go": 'var s = "open\n',
      "bad12.go": "func F[T any( {}\n",
      "bad13.go": "func F() (\n",
      "bad14.go": "type (\n",
      "bad15.go": "import (\n",
      "bad16.go": "func F() {\n",
      "bad17.go": "func (u *T) {\n",
      "bad18.go": "func F[T any]\n",
      "bad19.go": "type X =\n",
      "bad20.go": "var = 1\n",
      "bad21.go": "const (\n()\n)\n",
      "bad22.go": "type (\nA\n)\n",
      "bad23.go": "type (\nhidden int\n)\n",
      "bad24.go": "type (\nA =\n)\n",
      "bad25.go": "type X interface {\nBad(\n}\n",
    });
    expect(extractGo(bad, Object.keys({
      "bad.go": 1, "bad2.go": 1, "bad3.go": 1, "bad4.go": 1, "bad5.go": 1,
      "bad6.go": 1, "bad7.go": 1, "bad8.go": 1, "bad9.go": 1, "bad10.go": 1,
      "bad11.go": 1, "bad12.go": 1, "bad13.go": 1, "bad14.go": 1, "bad15.go": 1,
      "bad16.go": 1, "bad17.go": 1, "bad18.go": 1, "bad19.go": 1, "bad20.go": 1,
      "bad21.go": 1, "bad22.go": 1, "bad23.go": 1, "bad24.go": 1, "bad25.go": 1,
    })).parseFailures).toBeGreaterThan(0);
  });

  it("parses struct field variants", () => {
    const root = tempProject({
      "go.mod": "module example.com/fields\n",
      "fields.go": "package fields\ntype Fields struct {\n*\nA,\nB []string\nC map[string]int\n}\n",
    });
    const result = extractGo(root, ["fields.go"]);
    expect(result.symbols.find((symbol) => symbol.name === "Fields")?.shape.members?.map((member) => member.name)).toEqual(
      expect.arrayContaining(["B", "C"]),
    );
  });
});
