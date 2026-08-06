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

import { readState, writeState, resolveActiveName } from "../extensions/output-styles.ts";

describe("state", () => {
  test("writeState then readState round-trips active", () => {
    const dir = mkdtempSync(join(tmpdir(), "pos-state-"));
    const file = join(dir, "nested", "state.json");
    writeState(file, { active: "teacher" });
    expect(readState(file)).toEqual({ active: "teacher" });
  });

  test("readState returns {} for missing or malformed files", () => {
    expect(readState("/no/such/file.json")).toEqual({});
    const dir = mkdtempSync(join(tmpdir(), "pos-state-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(readState(bad)).toEqual({});
    const noActive = join(dir, "noactive.json");
    writeFileSync(noActive, JSON.stringify({ other: 1 }));
    expect(readState(noActive)).toEqual({});
  });
});

describe("resolveActiveName", () => {
  test("session beats user beats project", () => {
    expect(resolveActiveName("s", { active: "u" }, { active: "p" })).toBe("s");
    expect(resolveActiveName(null, { active: "u" }, { active: "p" })).toBe("u");
    expect(resolveActiveName(null, {}, { active: "p" })).toBe("p");
    expect(resolveActiveName(null, {}, {})).toBe(null);
  });
});

import { applyStyle } from "../extensions/output-styles.ts";

describe("applyStyle", () => {
  const style = { name: "teacher", description: "", body: "Teach clearly." };

  test("appends exactly one marked block preserving base order", () => {
    const out = applyStyle(["A", "B"], style);
    expect(out.length).toBe(3);
    expect(out.slice(0, 2)).toEqual(["A", "B"]);
    expect(out[2]).toBe("<!-- pi-output-styles:teacher -->\nTeach clearly.");
  });

  test("coerces undefined base to empty array", () => {
    const out = applyStyle(undefined, style);
    expect(out).toEqual(["<!-- pi-output-styles:teacher -->\nTeach clearly."]);
  });

  test("is idempotent when a marker block is already present", () => {
    const once = applyStyle(["BASE"], style);
    const twice = applyStyle(once, style);
    expect(twice).toEqual(once);
  });

  test("does not append a second block when switching styles mid-prompt", () => {
    const other = { name: "concise", description: "", body: "Be brief." };
    const once = applyStyle(["BASE"], style);
    expect(applyStyle(once, other)).toEqual(once);
  });

  test("coerces a non-array base to empty", () => {
    // @ts-expect-error — exercising the runtime Array.isArray guard against a non-array
    expect(applyStyle(null, style)).toEqual(["<!-- pi-output-styles:teacher -->\nTeach clearly."]);
  });
});

import { parseStyleCommandArgs } from "../extensions/output-styles.ts";

describe("parseStyleCommandArgs", () => {
  test("bare name → session scope", () => {
    expect(parseStyleCommandArgs("teacher")).toEqual({ name: "teacher", persist: "none" });
  });
  test("--save → user scope", () => {
    expect(parseStyleCommandArgs("teacher --save")).toEqual({ name: "teacher", persist: "user" });
  });
  test("--global is an alias for user scope", () => {
    expect(parseStyleCommandArgs("teacher --global")).toEqual({ name: "teacher", persist: "user" });
  });
  test("--project (with or without --save) → project scope", () => {
    expect(parseStyleCommandArgs("teacher --save --project")).toEqual({ name: "teacher", persist: "project" });
    expect(parseStyleCommandArgs("teacher --project")).toEqual({ name: "teacher", persist: "project" });
  });
  test("flag order does not matter and empty input yields null name", () => {
    expect(parseStyleCommandArgs("--save teacher")).toEqual({ name: "teacher", persist: "user" });
    expect(parseStyleCommandArgs("   ")).toEqual({ name: null, persist: "none" });
  });
  test("flag order is irrelevant to precedence: --project before --save still yields project scope", () => {
    expect(parseStyleCommandArgs("teacher --project --save")).toEqual({ name: "teacher", persist: "project" });
  });
  test("only the first non-flag token is treated as the name", () => {
    expect(parseStyleCommandArgs("teacher concise")).toEqual({ name: "teacher", persist: "none" });
  });
  test("flag-only input yields a null name with the flag's persist scope", () => {
    expect(parseStyleCommandArgs("--save")).toEqual({ name: null, persist: "user" });
  });
});
