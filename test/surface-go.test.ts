import { describe, expect, it } from "vitest";
import { extractGo } from "../src/surface/go.js";
import { tempProject } from "./helpers.js";

function goProject(): string {
  return tempProject({
    "go.mod": "module example.com/goapp\n\ngo 1.24\n",
    "pkg/users.go": `
package users

import "fmt"

const (
    Version = "1.0"
    internal = 2
)

var (
    Enabled = true
    hidden = false
)

type User struct {
    ID string \`json:"id"\`
    Name, Alias string
    email string
    *Base
}

type Repo interface {
    Get(id string) (*User, error)
    Put(*User) error
    hidden()
}

type Alias = User
type Count int
type (
    Code string
    Flag bool
)

func NewUser(id string) *User { return &User{ID: id} }

func (u *User) Rename(name string) error { u.Name = name; return nil }
func (u *User) reset() {}

func Fetch[T any](id string, opts ...string) (User, error) {
    return User{}, nil
}

func (u *User) Values() []string { return nil }

// Deprecated: use NewUser.
func Old() {}

func (u *User) hiddenMethod() {}
`,
    "pkg/bad.go": "func broken( {",
  });
}

describe("Go surface", () => {
  it("extracts exported declarations and methods", () => {
    const root = goProject();
    const result = extractGo(root, ["pkg/users.go"]);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining([
      "Version", "Enabled", "User", "Repo", "Alias", "Count", "Code", "Flag",
      "NewUser", "Fetch", "Old", "Rename", "Values", "ID", "Name", "Alias",
    ]));
    expect(names).not.toContain("internal");
    expect(names).not.toContain("hidden");
    expect(names).not.toContain("reset");
    expect(names).not.toContain("hiddenMethod");
    expect(result.symbols.find((symbol) => symbol.name === "Old")?.contractFlags).toContain("deprecated");
    expect(result.symbols.find((symbol) => symbol.name === "User")?.modulePath).toBe("pkg/users");
  });

  it("builds struct, interface and function shapes", () => {
    const root = goProject();
    const result = extractGo(root, ["pkg/users.go"]);
    const user = result.symbols.find((symbol) => symbol.name === "User");
    expect(user?.shape.members?.map((member) => member.name)).toEqual(expect.arrayContaining([
      "ID", "Name", "Alias", "email", "Base",
    ]));
    const repo = result.symbols.find((symbol) => symbol.name === "Repo");
    expect(repo?.shape.members?.map((member) => member.name)).toEqual(expect.arrayContaining(["Get", "Put"]));
    const fetch = result.symbols.find((symbol) => symbol.name === "Fetch");
    expect(fetch?.shape.params?.map((param) => param.name)).toEqual(["id", "opts"]);
    expect(fetch?.shape.params?.[1].rest).toBe(true);
    expect(fetch?.shape.typeParams).toBe("T any");
    expect(fetch?.shape.returnType).toBe("User,error");
    const rename = result.symbols.find((symbol) => symbol.name === "Rename");
    expect(rename?.shape.params?.[0]).toMatchObject({ name: "receiver", type: "User" });
    expect(rename?.shape.params?.[1]).toMatchObject({ name: "name", type: "string" });
  });

  it("handles type aliases and value blocks", () => {
    const root = goProject();
    const result = extractGo(root, ["pkg/users.go"]);
    expect(result.symbols.find((symbol) => symbol.name === "Alias")?.shape.typeShape).toBe("User");
    expect(result.symbols.find((symbol) => symbol.name === "Count")?.shape.typeShape).toBe("int");
    expect(result.symbols.find((symbol) => symbol.name === "Version")?.shape.literalKind).toBe("string");
    expect(result.symbols.find((symbol) => symbol.name === "Enabled")?.shape.literalKind).toBe("boolean");
  });

  it("counts parse failures and handles empty input", () => {
    const root = goProject();
    expect(extractGo(root, ["pkg/bad.go", "pkg/missing.go"]).parseFailures).toBeGreaterThan(0);
    expect(extractGo(root, [])).toEqual({ symbols: [], parseFailures: 0, filesScanned: 0 });
  });
});
