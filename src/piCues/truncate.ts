/**
 * Injection of file content under a per-event character budget.
 *
 * Budget handling adapted from pi-rules truncator.ts / formatter.ts
 * (MIT License, Copyright (c) 2026 Yeongyu Kim). See NOTICE.
 */

export const MAX_FILE_CHARS = 12000;
export const MAX_RESULT_CHARS = 40000;

const TRUNCATION_NOTICE = "\n\n[Content truncated. Read full file: {path}]";

export interface FileContent {
  /** Absolute path shown in the attribution header. */
  path: string;
  body: string;
}

/**
 * Build one injection block for cue files, in the given (already prioritized)
 * order. Later files are dropped when the budget runs out.
 */
export function formatFileBlock(files: readonly FileContent[], header: string): string {
  if (files.length === 0) {
    return "";
  }

  const blockHeader = `\n\n${header}\n\n`;
  let remaining = MAX_RESULT_CHARS - blockHeader.length;

  const entries: string[] = [];
  for (const file of files) {
    const notice = TRUNCATION_NOTICE.replace("{path}", file.path);
    const entryHeader = `Instructions from: ${file.path}\n`;
    const separator = entries.length === 0 ? 0 : "\n\n".length;
    const budget = remaining - separator - entryHeader.length;
    if (budget <= notice.length) {
      break;
    }

    const body = truncateBody(file.body, Math.min(MAX_FILE_CHARS, budget), file.path);
    entries.push(`${entryHeader}${body}`);
    remaining -= separator + entryHeader.length + body.length;
  }

  return entries.length === 0 ? "" : `${blockHeader}${entries.join("\n\n")}`;
}

function truncateBody(body: string, maxChars: number, displayPath: string): string {
  if (body.length <= maxChars) {
    return body;
  }

  const notice = TRUNCATION_NOTICE.replace("{path}", displayPath);
  if (maxChars <= notice.length) {
    return notice;
  }

  return `${body.slice(0, safeSliceEnd(body, maxChars - notice.length))}${notice}`;
}

/** Avoid splitting a surrogate pair when the budget cuts the body. */
function safeSliceEnd(body: string, end: number): number {
  if (end <= 0) {
    return 0;
  }

  const lastCodeUnit = body.charCodeAt(end - 1);
  const isHighSurrogate = lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff;
  return isHighSurrogate ? end - 1 : end;
}
