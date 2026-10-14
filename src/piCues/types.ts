/**
 * Shared types for pi-cues.
 */

export type ToolName = "bash" | "read" | "edit" | "write";

export type ActionKind = "skill" | "file" | "walkup";

export interface CueDiagnostic {
  severity: "warning" | "error";
  /** Config file path or runtime context the diagnostic belongs to. */
  source: string;
  message: string;
}

export interface TriggerWhen {
  command?: string[];
  path?: string[];
}

export interface Trigger {
  tools: ToolName[];
  /** Undefined only for walkup triggers (match every listed tool event). */
  when?: TriggerWhen;
  action: ActionKind;
  targets: string[];
  /** Directory containing the config file that declared this trigger; base for `file` targets. */
  configDir: string;
  /** Config file path, for diagnostics and `/cues status`. */
  source: string;
}
