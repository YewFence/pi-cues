import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/piCues/config.js";

const dirs: string[] = [];

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pi-cues-config-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const VALID = `
version = 1

[[triggers]]
tools = ["bash"]
when.command = "jj"
action = "skill"
target = "jj-cli"

[[triggers]]
tools = ["read", "edit"]
when.path = "src/**"
action = "walkup"
target = ["AGENTS.md"]
`;

describe("loadConfig", () => {
  it("loads and merges global then project config", () => {
    // #given valid config at both levels #when loading #then triggers append, global first
    const home = makeTree({ ".pi/agent/pi-cues.toml": VALID });
    const project = makeTree({ ".pi/pi-cues.toml": VALID });
    const config = loadConfig({ cwd: project, homeDir: home });
    expect(config.files).toEqual([
      join(home, ".pi/agent/pi-cues.toml"),
      join(project, ".pi/pi-cues.toml"),
    ]);
    expect(config.triggers).toHaveLength(5); // 2 global + 2 project + builtin default
    expect(config.triggers[0]?.source).toBe("<builtin defaults>");
    expect(config.diagnostics).toEqual([]);
  });

  it("prefers pi-cues.toml over the nested extensions path at the same level", () => {
    const project = makeTree({
      ".pi/pi-cues.toml": VALID,
      ".pi/extensions/pi-cues/config.toml": VALID.replace('target = "jj-cli"', 'target = "other"'),
    });
    const config = loadConfig({ cwd: project, homeDir: makeTree({}) });
    expect(config.files).toEqual([join(project, ".pi/pi-cues.toml")]);
    expect(
      config.diagnostics.some((d) => d.severity === "warning" && d.source.endsWith("config.toml")),
    ).toBe(true);
    expect(config.triggers[1]?.targets).toEqual(["jj-cli"]);
  });

  it("ships a builtin walkup default when no config exists", () => {
    const config = loadConfig({ cwd: makeTree({}), homeDir: makeTree({}) });
    expect(config.triggers).toHaveLength(1);
    expect(config.triggers[0]).toMatchObject({
      action: "walkup",
      targets: ["AGENTS.md"],
      tools: ["read", "edit", "write"],
    });
    expect(config.triggers[0]?.when).toBeUndefined();
  });

  it("disables builtin defaults with `defaults = false` in either level", () => {
    const home = makeTree({ ".pi/agent/pi-cues.toml": "version = 1\ndefaults = false\n" });
    const project = makeTree({ ".pi/pi-cues.toml": VALID });
    const config = loadConfig({ cwd: project, homeDir: home });
    expect(config.triggers).toHaveLength(2);
    expect(config.triggers.every((t) => t.source !== "<builtin defaults>")).toBe(true);
  });

  it("falls back to the nested path when pi-cues.toml is absent", () => {
    const project = makeTree({ ".pi/extensions/pi-cues/config.toml": VALID });
    const config = loadConfig({ cwd: project, homeDir: makeTree({}) });
    expect(config.files).toEqual([join(project, ".pi/extensions/pi-cues/config.toml")]);
    expect(config.triggers).toHaveLength(3); // builtin default + 2 configured
  });

  it("tolerates missing config files", () => {
    const config = loadConfig({ cwd: makeTree({}), homeDir: makeTree({}) });
    expect(config.files).toEqual([]);
    expect(config.diagnostics).toEqual([]);
  });

  it("diagnoses invalid TOML and continues with other files", () => {
    const home = makeTree({ ".pi/agent/pi-cues.toml": "not [valid" });
    const project = makeTree({ ".pi/pi-cues.toml": VALID });
    const config = loadConfig({ cwd: project, homeDir: home });
    expect(config.diagnostics).toHaveLength(1);
    expect(config.diagnostics[0]?.severity).toBe("error");
    expect(config.triggers).toHaveLength(3); // builtin default + 2 from project
  });

  it("rejects a wrong version for the whole file", () => {
    const project = makeTree({ ".pi/pi-cues.toml": "version = 99\n" });
    const config = loadConfig({ cwd: project, homeDir: makeTree({}) });
    expect(config.triggers.map((t) => t.action)).toEqual(["walkup"]);
    expect(config.diagnostics[0]?.message).toContain("version");
  });

  it("skips entries whose when key does not fit tools", () => {
    const project = makeTree({
      ".pi/pi-cues.toml": `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.path = "x"\naction = "file"\ntarget = "a.md"\n`,
    });
    const config = loadConfig({ cwd: project, homeDir: makeTree({}) });
    expect(config.triggers.map((t) => t.source)).toEqual(["<builtin defaults>"]);
    expect(config.diagnostics[0]?.severity).toBe("warning");
  });

  it("rejects skill/file triggers without when but allows walkup", () => {
    const project = makeTree({
      ".pi/pi-cues.toml": `version = 1
[[triggers]]
tools = ["bash"]
action = "skill"
target = "jj-cli"

[[triggers]]
tools = ["read"]
action = "walkup"
target = "AGENTS.md"
`,
    });
    const config = loadConfig({ cwd: project, homeDir: makeTree({}) });
    expect(config.triggers).toHaveLength(2);
    expect(config.triggers[1]?.action).toBe("walkup");
    expect(config.triggers[1]?.when).toBeUndefined();
  });

  it("rejects walkup triggers listening to bash", () => {
    const project = makeTree({
      ".pi/pi-cues.toml": `version = 1\n[[triggers]]\ntools = ["bash"]\naction = "walkup"\ntarget = "AGENTS.md"\n`,
    });
    const config = loadConfig({ cwd: project, homeDir: makeTree({}) });
    expect(config.triggers.map((t) => t.source)).toEqual(["<builtin defaults>"]);
  });

  it("normalizes target to a list and records the config dir", () => {
    const project = makeTree({ ".pi/pi-cues.toml": VALID });
    const config = loadConfig({ cwd: project, homeDir: makeTree({}) });
    expect(config.triggers[1]?.targets).toEqual(["jj-cli"]);
    expect(config.triggers[1]?.configDir).toBe(join(project, ".pi"));
  });
});
