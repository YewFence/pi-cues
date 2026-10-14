/**
 * Extension entry point: hooks `tool_result` / `user_bash`, loads config,
 * matches triggers, injects cue content, and registers `/cues`.
 */
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadConfig, type LoadedConfig } from "./config.js";
import { matchAnyValue } from "./match.js";
import { extractCommands } from "./parse.js";
import { extractToolPaths, pathBaseValues, toPathBases } from "./paths.js";
import { loadSkillBlock, resolveSkill } from "./skills.js";
import { formatFileBlock, type FileContent } from "./truncate.js";
import {
  claimOnce,
  clearSession,
  createSessionState,
  dedupKey,
  type SessionState,
} from "./triggers.js";
import type { Trigger } from "./types.js";
import {
  collectContextFiles,
  createWalkupCache,
  type WalkupCache,
  type WalkupFile,
} from "./walkup.js";

export default function piCues(pi: ExtensionAPI): void {
  let config: LoadedConfig = { triggers: [], diagnostics: [], files: [] };
  const session: SessionState = createSessionState();
  const walkupCache: WalkupCache = createWalkupCache();
  /** Paths (and realpaths) pi already injected into the system prompt; rebuilt per run. */
  const nativeContextPaths = new Set<string>();

  pi.on("session_start", (_event, ctx) => {
    clearSession(session);
    walkupCache.entries.clear();
    config = loadConfig({ cwd: ctx.cwd, homeDir: process.env["PI_CUES_HOME"] });
    if (ctx.hasUI) {
      for (const diagnostic of config.diagnostics) {
        ctx.ui.notify(`pi-cues: ${diagnostic.message} (${diagnostic.source})`, diagnostic.severity);
      }
    }
  });

  pi.on("session_compact", () => {
    clearSession(session);
    walkupCache.entries.clear();
  });

  pi.on("before_agent_start", (event) => {
    nativeContextPaths.clear();
    for (const file of event.systemPromptOptions.contextFiles ?? []) {
      for (const key of pathKeys(file.path)) {
        nativeContextPaths.add(key);
      }
    }
  });

  pi.on("tool_result", (event, ctx) => {
    try {
      const texts =
        event.toolName === "bash"
          ? fireBashTriggers(commandInput(event), ctx.cwd)
          : firePathTriggers(extractToolPaths(event, ctx.cwd), ctx.cwd);
      if (texts.length === 0) {
        return undefined;
      }
      return { content: [...event.content, { type: "text" as const, text: texts.join("\n") }] };
    } catch {
      // Cue loading must never break the tool pipeline.
      return undefined;
    }
  });

  pi.on("user_bash", (event, ctx) => {
    // A throwing user_bash handler blocks the user's command; swallow everything.
    try {
      if (event.excludeFromContext) {
        return undefined;
      }
      const texts = fireBashTriggers(extractCommands(event.command), ctx.cwd);
      if (texts.length > 0) {
        pi.sendMessage(
          { customType: "pi-cues", content: texts.join("\n"), display: false },
          { deliverAs: "nextTurn" },
        );
      }
    } catch {
      // intentional
    }
    return undefined;
  });

  pi.registerCommand("cues", {
    description: "Show pi-cues status (config, diagnostics, triggered cues).",
    getArgumentCompletions: (prefix) => {
      const matches = ["status"].filter((sub) => sub.startsWith(prefix));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (_args, ctx) => {
      ctx.ui.notify(buildStatusText(), "info");
    },
  });

  function commandInput(event: { input: Record<string, unknown> }): string[] {
    const command = event.input["command"];
    return typeof command === "string" ? extractCommands(command) : [];
  }

  function fireBashTriggers(commandNames: string[], cwd: string): string[] {
    if (commandNames.length === 0) {
      return [];
    }
    const texts: string[] = [];
    for (const trigger of config.triggers) {
      const patterns = trigger.when?.command;
      if (!trigger.tools.includes("bash") || patterns === undefined) {
        continue;
      }
      if (!matchAnyValue(patterns, commandNames)) {
        continue;
      }
      for (const target of trigger.targets) {
        const text = executeTarget(trigger, target, cwd);
        if (text !== null) {
          texts.push(text);
        }
      }
    }
    return texts;
  }

  function firePathTriggers(paths: string[], cwd: string): string[] {
    if (paths.length === 0) {
      return [];
    }
    const texts: string[] = [];
    const walkupFiles: Array<{ file: WalkupFile; source: string }> = [];
    const walkupSeen = new Set<string>();
    for (const trigger of config.triggers) {
      if (trigger.tools.includes("bash")) {
        continue;
      }
      const matched = paths.some((path) => {
        if (trigger.when?.path === undefined) {
          return true; // walkup without when: every path event matches
        }
        const bases = toPathBases(path, cwd, trigger.configDir);
        return matchAnyValue(trigger.when.path, pathBaseValues(bases));
      });
      if (!matched) {
        continue;
      }

      if (trigger.action === "walkup") {
        for (const path of paths) {
          for (const file of collectContextFiles({
            anchorDir: cwd,
            targetFile: path,
            fileNames: trigger.targets,
            cache: walkupCache,
          })) {
            if (walkupSeen.has(file.realPath)) {
              continue;
            }
            walkupSeen.add(file.realPath);
            walkupFiles.push({ file, source: trigger.source });
          }
        }
        continue;
      }

      for (const target of trigger.targets) {
        const text = executeTarget(trigger, target, cwd);
        if (text !== null) {
          texts.push(text);
        }
      }
    }

    const walkupText = injectWalkupFiles(walkupFiles, cwd, paths[0] ?? cwd);
    if (walkupText !== null) {
      texts.push(walkupText);
    }
    return texts;
  }

  function executeTarget(trigger: Trigger, target: string, cwd: string): string | null {
    if (trigger.action === "skill") {
      const record = claimOnce(session, dedupKey("skill", target), {
        action: "skill",
        target,
        source: trigger.source,
        loaded: false,
      });
      if (record === undefined) {
        return null;
      }
      const skill = resolveSkill(pi, target);
      const block = skill === null ? null : loadSkillBlock(skill);
      if (block === null) {
        diagnose(`Skill not found or unreadable: ${target}`, trigger.source);
        return null;
      }
      record.loaded = true;
      return block;
    }

    if (trigger.action === "file") {
      const path = isAbsolute(target) ? target : resolve(trigger.configDir, target);
      const record = claimOnce(session, dedupKey("file", path), {
        action: "file",
        target: path,
        source: trigger.source,
        loaded: false,
      });
      if (record === undefined) {
        return null;
      }
      let body: string;
      try {
        body = readFileSync(path, "utf8");
      } catch {
        diagnose(`Prompt file not found or unreadable: ${path}`, trigger.source);
        return null;
      }
      record.loaded = true;
      return formatFileBlock([{ path, body }], `Cue for ${displayPath(cwd, path)}:`);
    }

    return null;
  }

  /**
   * Walk-up files dedup per realPath, flattened and config-independent: the
   * same context file is injected once per session no matter which trigger
   * (builtin default or user config) collected it. Files not found claim
   * nothing, so a later event in another directory still discovers them.
   */
  function injectWalkupFiles(
    files: ReadonlyArray<{ file: WalkupFile; source: string }>,
    cwd: string,
    targetFile: string,
  ): string | null {
    const contents: FileContent[] = [];
    for (const { file, source } of files) {
      if (nativeContextPaths.has(file.path) || nativeContextPaths.has(file.realPath)) {
        continue;
      }
      const record = claimOnce(session, dedupKey("walkup", file.realPath), {
        action: "walkup",
        target: file.path,
        source,
        loaded: false,
      });
      if (record === undefined) {
        continue;
      }
      let body: string;
      try {
        body = readFileSync(file.path, "utf8");
      } catch {
        diagnose(`Context file unreadable: ${file.path}`, source);
        continue;
      }
      record.loaded = true;
      contents.push({ path: file.path, body });
    }

    const block = formatFileBlock(
      contents,
      `Additional context for ${displayPath(cwd, targetFile)}:`,
    );
    return block === "" ? null : block;
  }

  function diagnose(message: string, source: string): void {
    session.diagnostics.push({ severity: "warning", source, message });
  }

  function buildStatusText(): string {
    const lines = [
      `pi-cues: ${config.triggers.length} triggers from ${config.files.length} config file(s)`,
      ...config.files.map((file) => `  config: ${file}`),
    ];
    const diagnostics = [...config.diagnostics, ...session.diagnostics];
    if (diagnostics.length > 0) {
      lines.push(`diagnostics (${diagnostics.length}):`);
      for (const diagnostic of diagnostics) {
        lines.push(`  [${diagnostic.severity}] ${diagnostic.message} — ${diagnostic.source}`);
      }
    }
    if (session.triggered.length > 0) {
      lines.push(`triggered this session (${session.triggered.length}):`);
      for (const record of session.triggered) {
        lines.push(`  ${record.loaded ? "✓" : "✗"} ${record.action}: ${record.target}`);
      }
    }
    return lines.join("\n");
  }
}

function pathKeys(filePath: string): string[] {
  return [filePath, realPathOf(filePath)];
}

function realPathOf(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

function displayPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
}
