/**
 * Bash command-name extraction on top of shell-quote.
 *
 * shell-quote's parse() output: strings for words, { op } objects for
 * operators. Only |, ||, &&, ; separate simple commands — redirection ops
 * (>, >>, <<, >&) must not split, or `jj log > out.txt` would report
 * "out.txt" as a command. $(...) content sits between { op: "(" } and
 * { op: ")" } and is skipped with depth tracking. parse() almost never
 * throws (unclosed quotes still return tokens); the try/catch is defensive.
 *
 * Full verification matrix lives in docs/design.md ("spike 结论").
 */
import { basename } from "node:path";

import { parse, type ParseEntry } from "shell-quote";

/** Shell operator that separates two simple commands. */
const SIMPLE_COMMAND_SEPARATORS = new Set(["|", "||", "&&", ";"]);

const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;

/**
 * Command wrappers stripped one layer. Entries are word sequences because
 * wrappers like `uv run` span two words. `mise x` additionally tolerates a
 * trailing `--` (`mise x -- jj log`).
 */
const WRAPPERS: ReadonlyArray<readonly string[]> = [
  ["sudo"],
  ["env"],
  ["npx"],
  ["bunx"],
  ["uv", "run"],
  ["mise", "x"],
  ["mise", "run"],
];

export function extractCommands(command: string): string[] {
  const commands = extractCommandTokens(command);
  return [...new Set(commands.map((token) => basename(token)).filter((name) => name.length > 0))];
}

function extractCommandTokens(command: string): string[] {
  let entries: ParseEntry[];
  try {
    entries = parse(command);
  } catch {
    return [];
  }

  const tokens: string[] = [];
  let depth = 0;
  let currentWords: string[] = [];

  const flush = (): void => {
    const token = firstCommandToken(currentWords);
    if (token !== undefined) {
      tokens.push(token);
    }
    currentWords = [];
  };

  for (const entry of entries) {
    if (typeof entry === "string") {
      if (depth === 0) {
        currentWords.push(entry);
      }
      continue;
    }
    if (!("op" in entry)) {
      // { pattern, ... } / { comment } entries: not a word, not a separator.
      continue;
    }
    if (entry.op === "(") {
      depth += 1;
      continue;
    }
    if (entry.op === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) {
      continue;
    }
    if (SIMPLE_COMMAND_SEPARATORS.has(entry.op)) {
      flush();
    }
    // Other ops (redirections, heredocs, glob) keep the current command open.
  }
  flush();

  return tokens;
}

function firstCommandToken(words: string[]): string | undefined {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === undefined) {
      break;
    }
    if (ENV_ASSIGNMENT.test(word)) {
      index += 1;
      continue;
    }
    const wrapperLength = matchWrapper(words, index);
    if (wrapperLength > 0) {
      index += wrapperLength;
      // Wrapper flags and the `mise x -- cmd` separator precede the command.
      while (words[index]?.startsWith("-")) {
        index += 1;
      }
      continue;
    }
    return word;
  }
  return undefined;
}

/** Number of words consumed by the wrapper starting at index, or 0. */
function matchWrapper(words: string[], index: number): number {
  for (const wrapper of WRAPPERS) {
    if (wrapper.every((word, offset) => words[index + offset] === word)) {
      return wrapper.length;
    }
  }
  return 0;
}
