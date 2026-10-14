import { describe, expect, it } from "vitest";

import { formatFileBlock, MAX_FILE_CHARS, MAX_RESULT_CHARS } from "../src/piCues/truncate.js";

describe("formatFileBlock", () => {
  it("returns empty for no files", () => {
    expect(formatFileBlock([], "Header:")).toBe("");
  });

  it("formats a single file with attribution header", () => {
    const block = formatFileBlock([{ path: "/repo/f.md", body: "hello" }], "Header:");
    expect(block).toBe("\n\nHeader:\n\nsource: /repo/f.md\nhello");
  });

  it("joins multiple files in order", () => {
    const block = formatFileBlock(
      [
        { path: "/a.md", body: "A" },
        { path: "/b.md", body: "B" },
      ],
      "Header:",
    );
    expect(block.indexOf("A")).toBeLessThan(block.indexOf("B"));
  });

  it("truncates an oversized file with a notice", () => {
    const body = "x".repeat(MAX_FILE_CHARS + 100);
    const block = formatFileBlock([{ path: "/big.md", body }], "Header:");
    expect(block).toContain("[Content truncated. Read full file: /big.md]");
    expect(block.length).toBeLessThan(MAX_FILE_CHARS + 1000);
  });

  it("drops files that exceed the shared result budget", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `/f${i}.md`,
      body: "y".repeat(MAX_FILE_CHARS),
    }));
    const block = formatFileBlock(files, "Header:");
    expect(block.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 200);
    expect(block).not.toContain("/f9.md");
  });

  it("does not split a surrogate pair at the cut point", () => {
    const body = `${"x".repeat(MAX_FILE_CHARS - 60)}😀${"y".repeat(500)}`;
    const block = formatFileBlock([{ path: "/emoji.md", body }], "Header:");
    expect(block).not.toContain("\uFFFD");
  });
});
