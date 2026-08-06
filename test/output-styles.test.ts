import { describe, test, expect } from "bun:test";
import { parseStyle } from "../extensions/output-styles.ts";

describe("parseStyle", () => {
  test("parses frontmatter name, description, and body", () => {
    const text = "---\nname: teacher\ndescription: teaches the why\n---\nAct as a teacher.\nExplain first.";
    const s = parseStyle(text, "fallback");
    expect(s.name).toBe("teacher");
    expect(s.description).toBe("teaches the why");
    expect(s.body).toBe("Act as a teacher.\nExplain first.");
  });

  test("uses fallback name when frontmatter omits name", () => {
    const text = "---\ndescription: no name here\n---\nBody text.";
    const s = parseStyle(text, "concise");
    expect(s.name).toBe("concise");
    expect(s.body).toBe("Body text.");
  });

  test("treats a file with no frontmatter as all-body with fallback name", () => {
    const s = parseStyle("Just a plain body.", "plain");
    expect(s.name).toBe("plain");
    expect(s.description).toBe("");
    expect(s.body).toBe("Just a plain body.");
  });

  test("strips surrounding quotes from frontmatter values", () => {
    const s = parseStyle('---\nname: "quoted"\n---\nx', "fb");
    expect(s.name).toBe("quoted");
  });

  test("falls back to fallbackName when name value is empty", () => {
    const s = parseStyle("---\nname:\n---\nB", "fb");
    expect(s.name).toBe("fb");
  });

  test("preserves an unmatched trailing apostrophe instead of stripping it", () => {
    const s = parseStyle("---\ndescription: the devs'\n---\nB", "fb");
    expect(s.description).toBe("the devs'");
  });

  test("does not treat a line merely starting with --- as the closing fence", () => {
    const s = parseStyle("---\nname: x\n--- junk\nB", "fb");
    expect(s.name).toBe("fb");
    expect(s.body).toContain("name: x");
  });

  test("parses CRLF frontmatter and preserves CRLF body line endings", () => {
    const text = "---\r\nname: teacher\r\ndescription: why\r\n---\r\nBody one\r\nBody two";
    const s = parseStyle(text, "fb");
    expect(s.name).toBe("teacher");
    expect(s.description).toBe("why");
    expect(s.body).toBe("Body one\r\nBody two");
  });
});

import { discoverStyles } from "../extensions/output-styles.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmpStylesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pos-styles-"));
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe("discoverStyles", () => {
  test("reads .md styles from a directory keyed by name", () => {
    const dir = tmpStylesDir({
      "teacher.md": "---\nname: teacher\n---\nteach body",
      "notes.txt": "ignored",
    });
    const m = discoverStyles([dir]);
    expect(m.has("teacher")).toBe(true);
    expect(m.get("teacher")!.body).toBe("teach body");
    expect(m.size).toBe(1); // .txt ignored
  });

  test("higher-precedence dir overrides same-named style", () => {
    const low = tmpStylesDir({ "x.md": "---\nname: x\n---\nlow" });
    const high = tmpStylesDir({ "x.md": "---\nname: x\n---\nhigh" });
    const m = discoverStyles([low, high]);
    expect(m.get("x")!.body).toBe("high");
  });

  test("skips missing dirs and empty-body files", () => {
    const dir = tmpStylesDir({ "empty.md": "---\nname: empty\n---\n   " });
    const m = discoverStyles(["/no/such/dir", dir]);
    expect(m.size).toBe(0);
  });
});
