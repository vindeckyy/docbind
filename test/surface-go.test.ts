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
    "pkg/types.go": "package users\ntype Team struct{}\n",
    "pkg/team_methods.go": "package users\nfunc (t *Team) Add(name string) {}\n",
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
    expect(result.symbols.find((symbol) => symbol.name === "User")?.aliases).toContain("users.User");
    expect(result.symbols.find((symbol) => symbol.name === "Version")?.aliases).toContain("users.Version");
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
    expect(rename?.shape.params?.[0]).toMatchObject({ name: "receiver", type: "*User" });
    expect(rename?.shape.params?.[1]).toMatchObject({ name: "name", type: "string" });
  });

  it("resolves cross-package re-exports", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "internal/client/client.go": "package client\ntype Client struct{}\nfunc (c *Client) Do() error { return nil }\n",
      "root.go": "package app\nimport \"example.com/app/internal/client\"\ntype Client = client.Client\n",
    });
    const result = extractGo(root, ["internal/client/client.go", "root.go"]);
    const method = result.symbols.find((symbol) => symbol.name === "Do");
    expect(method?.aliases).toEqual(expect.arrayContaining(["client.Client.Do", "app.Client.Do"]));
  });

  it("resolves variable and constant re-exports", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "internal/config/config.go": "package config\nconst Limit = 5\nvar ErrX = 1\n",
      "root.go": "package app\nimport \"example.com/app/internal/config\"\nconst Limit = config.Limit\nvar ErrX = config.ErrX\n",
    });
    const result = extractGo(root, ["internal/config/config.go", "root.go"]);
    const limits = result.symbols.filter((symbol) => symbol.name === "Limit");
    const errors = result.symbols.filter((symbol) => symbol.name === "ErrX");
    expect(limits).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(limits[0].aliases).toEqual(expect.arrayContaining(["config.Limit", "app.Limit"]));
    expect(errors[0].aliases).toEqual(expect.arrayContaining(["config.ErrX", "app.ErrX"]));
  });

  it("keeps unresolved constant re-exports as local symbols", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "root.go": "package app\nimport \"example.com/missing/config\"\nconst Limit = config.Limit\n",
    });
    const result = extractGo(root, ["root.go"]);
    const limit = result.symbols.find((symbol) => symbol.name === "Limit");
    expect(limit?.aliases).toEqual(expect.arrayContaining(["root.Limit", "app.Limit"]));
  });

  it("resolves wrapper-function re-exports", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "internal/client/client.go": "package client\nfunc Target(value int) int { return value }\n",
      "root.go": "package app\nimport \"example.com/app/internal/client\"\nfunc Wrap(value int) int { return client.Target(value) }\n",
    });
    const result = extractGo(root, ["internal/client/client.go", "root.go"]);
    const targets = result.symbols.filter((symbol) => symbol.name === "Target");
    expect(targets).toHaveLength(1);
    expect(targets[0].aliases).toContain("app.Wrap");
    expect(result.symbols.some((symbol) => symbol.name === "Wrap")).toBe(false);
  });

  it("resolves multi-step value and wrapper re-export chains", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "lib/lib.go": "package lib\nconst Limit = 5\nfunc Target(value int) int { return value }\n",
      "mid/mid.go": "package mid\nimport \"example.com/app/lib\"\nconst MidLimit = lib.Limit\nfunc Mid(value int) int { return lib.Target(value) }\n",
      "app.go": "package app\nimport \"example.com/app/mid\"\nconst AppLimit = mid.MidLimit\nfunc App(value int) int { return mid.Mid(value) }\n",
    });
    const result = extractGo(root, ["lib/lib.go", "mid/mid.go", "app.go"]);
    const limits = result.symbols.filter((symbol) => symbol.name === "Limit");
    const targets = result.symbols.filter((symbol) => symbol.name === "Target");
    expect(limits).toHaveLength(1);
    expect(targets).toHaveLength(1);
    expect(limits[0].aliases).toContain("app.AppLimit");
    expect(targets[0].aliases).toContain("app.App");
    expect(result.symbols.some((symbol) => ["MidLimit", "AppLimit", "Mid", "App"].includes(symbol.name))).toBe(false);
  });

  it("resolves multi-step type alias chains", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "internal/client/client.go": "package client\ntype Client struct{}\nfunc (c *Client) Special() error { return nil }\n",
      "internal/middle/middle.go": "package middle\nimport \"example.com/app/internal/client\"\ntype MidClient = client.Client\n",
      "root.go": "package app\nimport \"example.com/app/internal/middle\"\ntype AppClient = middle.MidClient\n",
    });
    const result = extractGo(root, ["internal/client/client.go", "internal/middle/middle.go", "root.go"]);
    const method = result.symbols.find((symbol) => symbol.name === "Special");
    expect(method?.aliases).toContain("app.AppClient.Special");
  });

  it("resolves method-valued and computed aliases", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "lib/lib.go": "package lib\ntype Client struct{}\nfunc (c *Client) Computed(value int) error { return nil }\nfunc (c *Client) Wrapped(value int) error { return nil }\n",
      "root.go": "package app\nimport \"example.com/app/lib\"\nvar MethodValue = lib.Client.Computed\nfunc WrapComputed(c *lib.Client, value int) error { return lib.Client.Wrapped(c, value) }\n",
    });
    const result = extractGo(root, ["lib/lib.go", "root.go"]);
    expect(result.symbols.find((symbol) => symbol.name === "Computed")?.aliases).toContain("app.MethodValue");
    expect(result.symbols.find((symbol) => symbol.name === "Wrapped")?.aliases).toContain("app.WrapComputed");
    expect(result.symbols.some((symbol) => ["MethodValue", "WrapComputed"].includes(symbol.name))).toBe(false);
  });

  it("resolves instance-method wrapper re-exports", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "lib/lib.go": "package lib\ntype Client struct{}\nfunc (c *Client) Instance(value int) error { return nil }\n",
      "root.go": "package app\nimport \"example.com/app/lib\"\nfunc WrapInstance(c *lib.Client, value int) error { return c.Instance(value) }\n",
    });
    const result = extractGo(root, ["lib/lib.go", "root.go"]);
    expect(result.symbols.find((symbol) => symbol.name === "Instance")?.aliases).toContain("app.WrapInstance");
    expect(result.symbols.some((symbol) => symbol.name === "WrapInstance")).toBe(false);
  });

  it("falls back when the re-export file matches the package name", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "internal/client/client.go": "package client\ntype Client struct{}\nfunc (c *Client) Do() error { return nil }\n",
      "app.go": "package app\nimport \"example.com/app/internal/client\"\ntype Client = client.Client\n",
    });
    const result = extractGo(root, ["internal/client/client.go", "app.go"]);
    const method = result.symbols.find((symbol) => symbol.name === "Do");
    expect(method?.aliases).toContain("app.Client.Do");
  });

  it("ignores re-exports without a local target", () => {
    const root = tempProject({
      "go.mod": "module example.com/app\n",
      "root.go": "package app\nimport \"example.com/other/client\"\ntype Client = client.Client\n",
    });
    const result = extractGo(root, ["root.go"]);
    expect(result.symbols.map((symbol) => symbol.name)).toContain("Client");
    expect(result.symbols.find((symbol) => symbol.name === "Client")?.aliases).toEqual(
      expect.arrayContaining(["root.Client", "app.Client"]),
    );
  });

  it("attaches methods declared in another file", () => {
    const root = goProject();
    const result = extractGo(root, ["pkg/types.go", "pkg/team_methods.go"]);
    const method = result.symbols.find((symbol) => symbol.name === "Add");
    expect(method?.parentId).toContain("Team");
    expect(method?.modulePath).toBe("pkg/types");
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
