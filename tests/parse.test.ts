import { describe, expect, it } from "vitest";

import { extractCommands } from "../src/piCues/parse.js";

describe("extractCommands", () => {
  it("extracts a simple command", () => {
    // #given a single command #when extracting #then its basename is returned
    expect(extractCommands("jj log")).toEqual(["jj"]);
  });

  it("extracts both sides of a pipe", () => {
    expect(extractCommands("jj log | rg foo")).toEqual(["jj", "rg"]);
  });

  it("splits on && and ;", () => {
    expect(extractCommands("jj log && rg foo; ls")).toEqual(["jj", "rg", "ls"]);
  });

  it("strips environment assignment prefixes", () => {
    expect(extractCommands("FOO=1 BAR=2 jj log")).toEqual(["jj"]);
  });

  it("ignores a bare assignment", () => {
    expect(extractCommands("FOO=1")).toEqual([]);
  });

  it("strips single-word wrappers", () => {
    expect(extractCommands("sudo jj log")).toEqual(["jj"]);
    expect(extractCommands("npx -y some-cli --flag")).toEqual(["some-cli"]);
  });

  it("strips two-word wrappers", () => {
    expect(extractCommands("uv run pytest")).toEqual(["pytest"]);
  });

  it("strips mise x with a -- separator", () => {
    expect(extractCommands("mise x -- jj log")).toEqual(["jj"]);
  });

  it("does not treat redirection targets as commands", () => {
    expect(extractCommands("jj log > out.txt 2>&1")).toEqual(["jj"]);
  });

  it("skips command substitution contents", () => {
    expect(extractCommands("echo $(jj st)")).toEqual(["echo"]);
    expect(extractCommands("VAR=$(echo hi) jj log")).toEqual(["jj"]);
  });

  it("returns the basename of a path-qualified command", () => {
    expect(extractCommands("./node_modules/.bin/vitest run")).toEqual(["vitest"]);
  });

  it("deduplicates repeated commands", () => {
    expect(extractCommands("jj st; jj log")).toEqual(["jj"]);
  });

  it("returns no command for unbalanced quotes instead of throwing", () => {
    expect(() => extractCommands("'unclosed")).not.toThrow();
  });
});
