import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import piCues from "../src/piCues/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakePi {
  pi: ExtensionAPI;
  handlers: Map<string, (event: any, ctx: any) => unknown>;
  sent: Array<{ message: any; options: any }>;
  commands: Map<string, { handler: (args: string, ctx: any) => Promise<void> }>;
  notices: string[];
}

function createFakePi(skillPaths: Record<string, string> = {}): FakePi {
  const fake: FakePi = {
    handlers: new Map(),
    sent: [],
    commands: new Map(),
    notices: [],
    pi: {
      on: (event: string, handler: any) => {
        fake.handlers.set(event, handler);
        return () => {};
      },
      registerCommand: (name: string, def: any) => {
        fake.commands.set(name, def);
      },
      sendMessage: (message: any, options: any) => {
        fake.sent.push({ message, options });
      },
      getCommands: () =>
        Object.entries(skillPaths).map(([name, path]) => ({
          name: `skill:${name}`,
          description: name,
          source: "skill",
          sourceInfo: { path, source: "test", scope: "user", origin: "top-level" },
        })),
    } as unknown as ExtensionAPI,
  };
  return fake;
}

const dirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

interface Fixture {
  fake: FakePi;
  project: string;
  home: string;
  ctx: any;
}

function setup(configToml: string | null, skillPaths: Record<string, string> = {}): Fixture {
  const project = makeDir("pi-cues-it-project-");
  const home = makeDir("pi-cues-it-home-");
  if (configToml !== null) {
    writeFile(join(project, ".pi", "extensions", "pi-cues", "config.toml"), configToml);
  }
  writeFile(
    join(home, ".pi", "agent", "trust.json"),
    JSON.stringify({ [realpathSync(project)]: true }),
  );

  process.env["PI_CODING_AGENT_DIR"] = join(home, ".pi", "agent");
  const fake = createFakePi(skillPaths);
  piCues(fake.pi);

  const ctx = {
    cwd: project,
    hasUI: true,
    sessionManager: { getSessionId: () => "session-test-id" },
    ui: { notify: (message: string) => fake.notices.push(message) },
  };
  fake.handlers.get("session_start")?.({ type: "session_start" }, ctx);
  return { fake, project, home, ctx };
}

function bashResult(command: string, isError = false): any {
  return {
    type: "tool_result",
    toolCallId: "1",
    toolName: "bash",
    input: { command },
    content: [{ type: "text", text: "output" }],
    details: undefined,
    isError,
  };
}

function editResult(filePath: string): any {
  return {
    type: "tool_result",
    toolCallId: "2",
    toolName: "edit",
    input: { path: filePath },
    content: [{ type: "text", text: "edited" }],
    details: { filePath },
    isError: false,
  };
}

function injectedText(result: unknown): string | undefined {
  const content = (result as { content?: Array<{ type: string; text?: string }> } | undefined)
    ?.content;
  return content?.at(-1)?.text;
}

beforeEach(() => {
  process.env["PI_CODING_AGENT_DIR"] = undefined;
});

afterEach(() => {
  delete process.env["PI_CODING_AGENT_DIR"];
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("skill cue", () => {
  it("injects the skill block on a matching bash command, once per session", () => {
    // #given jj → jj-cli trigger #when `jj log` runs twice #then one injection
    const skillPath = join(makeDir("pi-cues-it-skill-"), "SKILL.md");
    writeFile(skillPath, "---\nname: jj-cli\n---\n\nJJ body.");
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "jj-cli"\n`,
      { "jj-cli": skillPath },
    );

    const handler = fake.handlers.get("tool_result");
    const first = handler?.(bashResult("jj log"), ctx);
    expect(injectedText(first)).toContain('<skill name="jj-cli"');
    expect(injectedText(first)).toContain("JJ body.");

    const second = handler?.(bashResult("jj log"), ctx);
    expect(second).toBeUndefined();
  });

  it("also fires for failed bash calls", () => {
    const skillPath = join(makeDir("pi-cues-it-skill-"), "SKILL.md");
    writeFile(skillPath, "body");
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "jj-cli"\n`,
      { "jj-cli": skillPath },
    );
    expect(
      injectedText(fake.handlers.get("tool_result")?.(bashResult("jj bad-flag", true), ctx)),
    ).toContain('<skill name="jj-cli"');
  });

  it("records a diagnostic and dedups when the skill is missing", () => {
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "ghost"\n`,
    );
    const handler = fake.handlers.get("tool_result");
    expect(handler?.(bashResult("jj st"), ctx)).toBeUndefined();
    expect(handler?.(bashResult("jj log"), ctx)).toBeUndefined();

    const status = fake.commands.get("cues");
    void status?.handler("status", ctx);
    expect(fake.notices.at(-1)).toContain("Skill not found or unreadable: ghost");
    expect(fake.notices.at(-1)?.match(/Skill not found/g)).toHaveLength(1);
  });
});

describe("file cue", () => {
  it("injects a prompt file for a matching path, resolved relative to the config dir", () => {
    const { fake, project, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["read", "edit"]\nwhen.path = "mise.toml"\naction = "file"\ntarget = "./triggers/mise.md"\n`,
    );
    writeFile(
      join(project, ".pi", "extensions", "pi-cues", "triggers", "mise.md"),
      "Mise conventions.",
    );
    writeFile(join(project, "mise.toml"), "[tools]");

    const result = fake.handlers.get("tool_result")?.(editResult(join(project, "mise.toml")), ctx);
    expect(injectedText(result)).toContain("Mise conventions.");
  });
});

describe("walkup cue", () => {
  it("fires out of the box via the builtin default", () => {
    // #given no config file at all #when editing under a dir with AGENTS.md #then injected
    const { fake, project, ctx } = setup(null);
    writeFile(join(project, "src", "AGENTS.md"), "src rules");
    writeFile(join(project, "src", "a.ts"), "code");

    const result = fake.handlers.get("tool_result")?.(
      editResult(join(project, "src", "a.ts")),
      ctx,
    );
    expect(injectedText(result)).toContain("src rules");
  });

  it("collects nothing without an explicit trust decision", () => {
    const project = makeDir("pi-cues-it-project-");
    const home = makeDir("pi-cues-it-home-");
    process.env["PI_CODING_AGENT_DIR"] = join(home, ".pi", "agent");
    const fake = createFakePi();
    piCues(fake.pi);
    const ctx = {
      cwd: project,
      hasUI: true,
      sessionManager: { getSessionId: () => "session-test-id" },
      ui: { notify: (m: string) => fake.notices.push(m) },
    };
    fake.handlers.get("session_start")?.({ type: "session_start" }, ctx);
    writeFile(join(project, "AGENTS.md"), "root agents");
    writeFile(join(project, "a.ts"), "code");

    const result = fake.handlers.get("tool_result")?.(editResult(join(project, "a.ts")), ctx);
    expect(result).toBeUndefined();
    expect(fake.notices.some((n) => n.includes("no trust decision"))).toBe(true);
  });

  it("collects nothing when the project trust decision is false", () => {
    const project = makeDir("pi-cues-it-project-");
    const home = makeDir("pi-cues-it-home-");
    writeFile(
      join(home, ".pi", "agent", "trust.json"),
      JSON.stringify({ [realpathSync(project)]: false }),
    );
    process.env["PI_CODING_AGENT_DIR"] = join(home, ".pi", "agent");
    const fake = createFakePi();
    piCues(fake.pi);
    const ctx = {
      cwd: project,
      hasUI: true,
      sessionManager: { getSessionId: () => "session-test-id" },
      ui: { notify: (m: string) => fake.notices.push(m) },
    };
    fake.handlers.get("session_start")?.({ type: "session_start" }, ctx);
    writeFile(join(project, "AGENTS.md"), "root agents");
    writeFile(join(project, "a.ts"), "code");

    const result = fake.handlers.get("tool_result")?.(editResult(join(project, "a.ts")), ctx);
    expect(result).toBeUndefined();
    expect(fake.notices.some((n) => n.includes("trust declined"))).toBe(true);
  });

  it("skips walk-up files matching exclude patterns", () => {
    const { fake, project, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["read", "edit"]\naction = "walkup"\ntarget = ["README.md"]\nexclude = "README.md"\n`,
    );
    writeFile(join(project, "README.md"), "root readme");
    writeFile(join(project, "sub", "README.md"), "sub readme");
    writeFile(join(project, "sub", "a.ts"), "code");

    const text =
      injectedText(
        fake.handlers.get("tool_result")?.(editResult(join(project, "sub", "a.ts")), ctx),
      ) ?? "";
    expect(text).toContain("sub readme");
    expect(text).not.toContain("root readme");
  });

  it("stays silent with defaults = false and no user walkup trigger", () => {
    const { fake, project, ctx } = setup("version = 1\ndefaults = false\n");
    writeFile(join(project, "src", "AGENTS.md"), "src rules");
    writeFile(join(project, "src", "a.ts"), "code");

    const result = fake.handlers.get("tool_result")?.(
      editResult(join(project, "src", "a.ts")),
      ctx,
    );
    expect(result).toBeUndefined();
  });

  it("injects each context file once across builtin and user walkup triggers", () => {
    const { fake, project, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["edit"]\naction = "walkup"\ntarget = ["AGENTS.md", "CONTEXT.md"]\n`,
    );
    writeFile(join(project, "AGENTS.md"), "root agents");
    writeFile(join(project, "CONTEXT.md"), "root context");
    writeFile(join(project, "a.ts"), "code");

    const result = fake.handlers.get("tool_result")?.(editResult(join(project, "a.ts")), ctx);
    const text = injectedText(result) ?? "";
    // #then AGENTS.md appears once despite matching both the default and the user trigger
    expect(text.match(/root agents/g)).toHaveLength(1);
    expect(text).toContain("root context");
  });

  it("discovers context files of directories first touched later in the session", () => {
    const { fake, project, ctx } = setup(null);
    writeFile(join(project, "one", "AGENTS.md"), "one rules");
    writeFile(join(project, "one", "a.ts"), "code");
    writeFile(join(project, "two", "AGENTS.md"), "two rules");
    writeFile(join(project, "two", "b.ts"), "code");

    const handler = fake.handlers.get("tool_result");
    expect(injectedText(handler?.(editResult(join(project, "one", "a.ts")), ctx))).toContain(
      "one rules",
    );
    // #then a different directory's AGENTS.md still loads later
    expect(injectedText(handler?.(editResult(join(project, "two", "b.ts")), ctx))).toContain(
      "two rules",
    );
  });

  it("collects context files near to far and skips native ones", () => {
    const { fake, project, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["read", "edit", "write"]\naction = "walkup"\ntarget = "AGENTS.md"\n`,
    );
    writeFile(join(project, "AGENTS.md"), "root rules");
    writeFile(join(project, "src", "AGENTS.md"), "src rules");
    writeFile(join(project, "src", "a.ts"), "code");

    // #given pi natively loaded the root AGENTS.md
    fake.handlers.get("before_agent_start")?.(
      {
        type: "before_agent_start",
        systemPromptOptions: { contextFiles: [{ path: join(project, "AGENTS.md") }] },
      },
      ctx,
    );

    const result = fake.handlers.get("tool_result")?.(
      editResult(join(project, "src", "a.ts")),
      ctx,
    );
    const text = injectedText(result);
    expect(text).toContain("src rules");
    expect(text).not.toContain("root rules");
  });

  it("keeps quiet when nothing is found", () => {
    const { fake, project, ctx } = setup(
      `version = 1\ndefaults = false\n[[triggers]]\ntools = ["edit"]\naction = "walkup"\ntarget = "AGENTS.md"\n`,
    );
    writeFile(join(project, "empty", "a.ts"), "code");

    const handler = fake.handlers.get("tool_result");
    expect(handler?.(editResult(join(project, "empty", "a.ts")), ctx)).toBeUndefined();

    writeFile(join(project, "full", "AGENTS.md"), "late rules");
    writeFile(join(project, "full", "b.ts"), "code");
    const result = handler?.(editResult(join(project, "full", "b.ts")), ctx);
    expect(injectedText(result)).toContain("late rules");
  });
});

describe("inline cue", () => {
  it("injects the target text itself, once per session", () => {
    // #given an inline trigger on jj #when jj runs twice #then the text is injected once
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "inline"\ntarget = "Commit messages in Chinese."\n`,
    );
    const handler = fake.handlers.get("tool_result");
    const first = handler?.(bashResult("jj st"), ctx);
    expect(injectedText(first)).toContain("Commit messages in Chinese.");
    expect(injectedText(first)).toContain("(inline)");
    expect(handler?.(bashResult("jj log"), ctx)).toBeUndefined();
  });
});

describe("user_bash cues", () => {
  it("queues matched cues for the next turn instead of interrupting", () => {
    const skillPath = join(makeDir("pi-cues-it-skill-"), "SKILL.md");
    writeFile(skillPath, "body");
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "jj-cli"\n`,
      { "jj-cli": skillPath },
    );

    const handler = fake.handlers.get("user_bash");
    const result = handler?.(
      { type: "user_bash", command: "jj log", excludeFromContext: false, cwd: ctx.cwd },
      ctx,
    );
    expect(result).toBeUndefined();
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.options).toEqual({ deliverAs: "nextTurn" });
    expect(fake.sent[0]?.message.content).toContain('<skill name="jj-cli"');
  });

  it("ignores !! commands excluded from context", () => {
    const skillPath = join(makeDir("pi-cues-it-skill-"), "SKILL.md");
    writeFile(skillPath, "body");
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "jj-cli"\n`,
      { "jj-cli": skillPath },
    );
    fake.handlers.get("user_bash")?.(
      { type: "user_bash", command: "jj log", excludeFromContext: true, cwd: ctx.cwd },
      ctx,
    );
    expect(fake.sent).toHaveLength(0);
  });
});

describe("trust and attribution", () => {
  it("ignores project config and notifies when the project is untrusted", () => {
    const project = makeDir("pi-cues-it-project-");
    const home = makeDir("pi-cues-it-home-");
    writeFile(
      join(project, ".pi", "extensions", "pi-cues", "config.toml"),
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "jj-cli"\n`,
    );
    process.env["PI_CODING_AGENT_DIR"] = join(home, ".pi", "agent");
    const fake = createFakePi();
    piCues(fake.pi);
    const ctx = {
      cwd: project,
      hasUI: true,
      isProjectTrusted: () => false,
      sessionManager: { getSessionId: () => "session-test-id" },
      ui: { notify: (message: string) => fake.notices.push(message) },
    };
    fake.handlers.get("session_start")?.({ type: "session_start" }, ctx);

    const result = fake.handlers.get("tool_result")?.(bashResult("jj log"), ctx);
    expect(result).toBeUndefined();
    expect(fake.notices.some((n) => n.includes("not trusted"))).toBe(true);
  });

  it("does not walk up for operated files outside the cwd subtree", () => {
    const { fake, project, ctx } = setup(null);
    writeFile(join(project, "AGENTS.md"), "root rules");

    const result = fake.handlers.get("tool_result")?.(editResult("/etc/hosts"), ctx);
    expect(result).toBeUndefined();
  });

  it("marks injections with a pi-cues attribution header", () => {
    const skillPath = join(makeDir("pi-cues-it-skill-"), "SKILL.md");
    writeFile(skillPath, "body");
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "jj-cli"\n`,
      { "jj-cli": skillPath },
    );
    const text = injectedText(fake.handlers.get("tool_result")?.(bashResult("jj log"), ctx));
    expect(text).toContain("pi-cues: trigger: command `jj` source: ");
  });

  it("announces pi-cues once in the system prompt", () => {
    const { fake, ctx } = setup(null);
    const result = fake.handlers.get("before_agent_start")?.(
      { type: "before_agent_start", systemPrompt: "BASE", systemPromptOptions: {} },
      ctx,
    ) as { systemPrompt: string };
    expect(result.systemPrompt).toMatch(/^BASE/);
    expect(result.systemPrompt).toContain("pi-cues: this session has the pi-cues extension");
  });
});

describe("session lifecycle", () => {
  it("re-fires cues after compaction", () => {
    const skillPath = join(makeDir("pi-cues-it-skill-"), "SKILL.md");
    writeFile(skillPath, "body");
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "jj-cli"\n`,
      { "jj-cli": skillPath },
    );

    const handler = fake.handlers.get("tool_result");
    handler?.(bashResult("jj log"), ctx);
    expect(handler?.(bashResult("jj log"), ctx)).toBeUndefined();

    fake.handlers.get("session_compact")?.({ type: "session_compact" }, ctx);
    expect(injectedText(handler?.(bashResult("jj log"), ctx))).toContain('<skill name="jj-cli"');
  });

  it("notifies config diagnostics on session start", () => {
    const { fake } = setup('version = 1\n[[triggers]]\ntools = ["bash"]\naction = "skill"\n');
    expect(fake.notices.some((n) => n.includes("pi-cues:"))).toBe(true);
  });
});

describe("telemetry", () => {
  afterEach(() => {
    delete process.env["XDG_CACHE_HOME"];
  });

  function readEvents(cache: string): Array<Record<string, unknown>> {
    return readFileSync(join(cache, "pi-cues", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("appends one event per fired cue, tagged with the pi session id", () => {
    // #given a jj → jj-cli trigger #when `jj log` runs twice #then one event, deduped like the injection
    const cache = makeDir("pi-cues-it-cache-");
    process.env["XDG_CACHE_HOME"] = cache;
    const skillPath = join(makeDir("pi-cues-it-skill-"), "SKILL.md");
    writeFile(skillPath, "body");
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "jj-cli"\n`,
      { "jj-cli": skillPath },
    );

    const handler = fake.handlers.get("tool_result");
    handler?.(bashResult("jj log"), ctx);
    handler?.(bashResult("jj log"), ctx);

    const events = readEvents(cache);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sessionId: "session-test-id",
      action: "skill",
      target: "jj-cli",
      loaded: true,
    });
    expect(typeof events[0]?.["ts"]).toBe("string");
  });

  it("records failed loads as loaded: false", () => {
    const cache = makeDir("pi-cues-it-cache-");
    process.env["XDG_CACHE_HOME"] = cache;
    const { fake, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "skill"\ntarget = "ghost"\n`,
    );

    fake.handlers.get("tool_result")?.(bashResult("jj st"), ctx);

    expect(readEvents(cache)[0]).toMatchObject({ action: "skill", target: "ghost", loaded: false });
  });

  it("writes nothing when the global config disables telemetry", () => {
    const cache = makeDir("pi-cues-it-cache-");
    process.env["XDG_CACHE_HOME"] = cache;
    const { fake, home, ctx } = setup(
      `version = 1\n[[triggers]]\ntools = ["bash"]\nwhen.command = "jj"\naction = "inline"\ntarget = "note"\n`,
    );
    writeFile(
      join(home, ".pi", "agent", "pi-cues.toml"),
      "version = 1\n[telemetry]\nenabled = false\n",
    );
    fake.handlers.get("session_start")?.({ type: "session_start" }, ctx);

    fake.handlers.get("tool_result")?.(bashResult("jj st"), ctx);

    expect(existsSync(join(cache, "pi-cues"))).toBe(false);
  });
});
