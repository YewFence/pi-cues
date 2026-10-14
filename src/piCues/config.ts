/**
 * Config discovery, parsing and validation.
 *
 * Two levels (global ~/.pi/agent, project <cwd>/.pi). At each level
 * `pi-cues.toml` wins over `extensions/pi-cues/config.toml`; triggers of the
 * two levels are appended (global baseline first). Invalid entries become
 * diagnostics and are skipped; the rest of the config stays active.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseToml } from "smol-toml";

import type { ActionKind, CueDiagnostic, ToolName, Trigger, TriggerWhen } from "./types.js";

const TOOL_NAMES: ReadonlySet<string> = new Set(["bash", "read", "edit", "write"]);
const PATH_TOOL_NAMES: ReadonlySet<string> = new Set(["read", "edit", "write"]);
const ACTION_NAMES: ReadonlySet<string> = new Set(["skill", "file", "walkup"]);
const WHEN_KEYS: ReadonlySet<string> = new Set(["command", "path"]);
const CONFIG_VERSION = 1;

export interface LoadedConfig {
  triggers: Trigger[];
  diagnostics: CueDiagnostic[];
  /** Config files actually loaded, global first. */
  files: string[];
}

export function loadConfig(options: { cwd: string; homeDir?: string }): LoadedConfig {
  const home = options.homeDir ?? homedir();
  const config: LoadedConfig = { triggers: [], diagnostics: [], files: [] };
  loadLevel(join(home, ".pi", "agent"), config);
  loadLevel(join(options.cwd, ".pi"), config);
  return config;
}

function loadLevel(baseDir: string, config: LoadedConfig): void {
  const preferred = join(baseDir, "pi-cues.toml");
  const nested = join(baseDir, "extensions", "pi-cues", "config.toml");
  const hasPreferred = existsSync(preferred);
  const hasNested = existsSync(nested);
  if (hasPreferred && hasNested) {
    config.diagnostics.push({
      severity: "warning",
      source: nested,
      message: `Ignored: ${preferred} takes precedence at the same level`,
    });
  }

  const file = hasPreferred ? preferred : hasNested ? nested : undefined;
  if (file === undefined) {
    return;
  }

  const parsed = parseConfigFile(file, config);
  if (parsed === undefined) {
    return;
  }
  config.files.push(file);

  const rawTriggers = parsed["triggers"];
  if (!Array.isArray(rawTriggers)) {
    config.diagnostics.push({
      severity: "error",
      source: file,
      message: "`triggers` must be an array",
    });
    return;
  }

  for (const [index, raw] of rawTriggers.entries()) {
    const source = `${file} triggers[${index}]`;
    if (!isRecord(raw)) {
      config.diagnostics.push({
        severity: "warning",
        source,
        message: "Entry must be a table; skipped",
      });
      continue;
    }

    const result = validateTrigger(raw, dirname(file), source);
    if (result.trigger !== undefined) {
      config.triggers.push(result.trigger);
      continue;
    }
    config.diagnostics.push(...result.diagnostics);
  }
}

function parseConfigFile(file: string, config: LoadedConfig): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = parseToml(readFileSync(file, "utf8"));
  } catch (error) {
    config.diagnostics.push({ severity: "error", source: file, message: errorMessage(error) });
    return undefined;
  }
  if (!isRecord(parsed)) {
    config.diagnostics.push({
      severity: "error",
      source: file,
      message: "Top level must be a table",
    });
    return undefined;
  }

  const version = parsed["version"];
  if (version !== CONFIG_VERSION) {
    config.diagnostics.push({
      severity: "error",
      source: file,
      message: `Unsupported version: ${JSON.stringify(version)} (expected ${CONFIG_VERSION})`,
    });
    return undefined;
  }

  return parsed;
}

interface TriggerValidation {
  trigger?: Trigger;
  diagnostics: CueDiagnostic[];
}

function validateTrigger(
  raw: Record<string, unknown>,
  configDir: string,
  source: string,
): TriggerValidation {
  const reject = (message: string): TriggerValidation => ({
    diagnostics: [{ severity: "warning", source, message: `${message}; skipped` }],
  });

  const tools = parseTools(raw["tools"]);
  if (tools === undefined) {
    return reject(`Invalid tools: ${JSON.stringify(raw["tools"])}`);
  }

  const action = raw["action"];
  if (typeof action !== "string" || !ACTION_NAMES.has(action)) {
    return reject(`Invalid action: ${JSON.stringify(raw["action"])}`);
  }
  const actionKind = action as ActionKind;

  const targets = parseStringList(raw["target"]);
  if (targets === undefined || targets.length === 0) {
    return reject(`Invalid target: ${JSON.stringify(raw["target"])}`);
  }

  if (actionKind === "walkup" && tools.some((tool) => !PATH_TOOL_NAMES.has(tool))) {
    // Walk-up collects context files for path operations only.
    return reject("walkup triggers must not listen to bash");
  }

  const when = parseWhen(raw["when"], tools, actionKind);
  if (!when.ok) {
    return reject(`Invalid when: ${JSON.stringify(raw["when"])}`);
  }

  return {
    trigger: { tools, when: when.when, action: actionKind, targets, configDir, source },
    diagnostics: [],
  };
}

function parseTools(value: unknown): ToolName[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const tools: ToolName[] = [];
  for (const tool of value) {
    if (typeof tool !== "string" || !TOOL_NAMES.has(tool)) {
      return undefined;
    }
    tools.push(tool as ToolName);
  }
  return tools;
}

function parseStringList(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return value.length === 0 ? undefined : [value];
  }
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      return undefined;
    }
    list.push(item);
  }
  return list;
}

type WhenValidation = { ok: true; when: TriggerWhen | undefined } | { ok: false };

function parseWhen(value: unknown, tools: ToolName[], action: ActionKind): WhenValidation {
  if (value === undefined) {
    // Only walkup may omit `when`: every listed path event triggers it.
    return action === "walkup" ? { ok: true, when: undefined } : { ok: false };
  }
  if (!isRecord(value)) {
    return { ok: false };
  }

  const when: TriggerWhen = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!WHEN_KEYS.has(key)) {
      return { ok: false };
    }
    const patterns = parseStringList(raw);
    if (patterns === undefined) {
      return { ok: false };
    }
    if (key === "command") {
      if (!tools.includes("bash")) {
        return { ok: false };
      }
      when.command = patterns;
      continue;
    }
    if (!tools.some((tool) => PATH_TOOL_NAMES.has(tool))) {
      return { ok: false };
    }
    when.path = patterns;
  }

  return Object.keys(when).length === 0 ? { ok: false } : { ok: true, when };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
