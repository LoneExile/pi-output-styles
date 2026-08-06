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

import { bundledStylesDir } from "../extensions/output-styles.ts";
import { existsSync } from "node:fs";

describe("bundled styles", () => {
  test("bundledStylesDir resolves to the shipped styles directory", () => {
    expect(existsSync(bundledStylesDir())).toBe(true);
  });

  test("all five starter styles discover with non-empty bodies", () => {
    const m = discoverStyles([bundledStylesDir()]);
    for (const name of ["concise", "explanatory", "teacher", "reviewer", "diagrams-first"]) {
      expect(m.has(name)).toBe(true);
      expect(m.get(name)!.body.length).toBeGreaterThan(0);
    }
  });
});

import outputStyles, { projectStateFile } from "../extensions/output-styles.ts";

interface Captured {
  commands: Record<string, (args: string, ctx: FakeCtx) => unknown>;
  handlers: Record<string, (event: unknown, ctx: FakeCtx) => unknown>;
  statuses: (string | undefined)[];
  notes: { message: string; type?: string }[];
}
interface FakeCtx {
  cwd: string;
  hasUI: boolean;
  ui: { setStatus: (k: string, t: string | undefined) => void; notify: (m: string, t?: string) => void };
}

function harness(cwd: string): { cap: Captured; ctx: FakeCtx } {
  const cap: Captured = { commands: {}, handlers: {}, statuses: [], notes: [] };
  const ctx: FakeCtx = {
    cwd,
    hasUI: true,
    ui: {
      setStatus: (_k, t) => cap.statuses.push(t),
      notify: (m, t) => cap.notes.push({ message: m, type: t }),
    },
  };
  const pi = {
    setLabel: () => {},
    on: (event: string, handler: (e: unknown, c: FakeCtx) => unknown) => {
      cap.handlers[event] = handler;
    },
    registerCommand: (name: string, def: { handler: (a: string, c: FakeCtx) => unknown }) => {
      cap.commands[name] = def.handler;
    },
  };
  // Fake pi implements only the surface the extension uses; its handler/ctx
  // types are intentionally narrower than the real ExtensionAPI, so bridge
  // via `unknown` rather than `any` (Parameters<> avoids importing the
  // module-local, unexported ExtensionAPI type by name).
  outputStyles(pi as unknown as Parameters<typeof outputStyles>[0]);
  return { cap, ctx };
}

describe("extension wiring", () => {
  test("no active style → before_agent_start leaves the prompt unchanged", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    const result = await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: ["BASE"] }, ctx);
    expect(result).toBeUndefined();
  });

  // NOTE: order deliberately deviates from the brief's literal listing.
  // `sessionActive` is module-level and persists across tests in this file;
  // "teacher" is a bundled style discoverable from any cwd, so running the
  // teacher-session test before this one would leave sessionActive="teacher"
  // and make this test's "no prompt change" expectation false. The brief's
  // own note permits reordering as long as "no active style" stays first:
  // "If you reorder tests, keep the 'no active' case first ...". This test
  // runs while sessionActive is still unset by any prior /style call.
  test("/style unknown → error notice and no prompt change", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("nope-not-real", ctx);
    expect(cap.notes.some(n => n.type === "error")).toBe(true);
    const result = await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: ["BASE"] }, ctx);
    expect(result).toBeUndefined();
  });

  test("/style teacher (session) → hook appends the teacher block", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher", ctx);
    const result = (await cap.handlers["before_agent_start"](
      { prompt: "hi", systemPrompt: ["BASE"] },
      ctx,
    )) as { systemPrompt: string[] };
    expect(result.systemPrompt[0]).toBe("BASE");
    expect(result.systemPrompt[1]).toContain("<!-- pi-output-styles:teacher -->");
    expect(cap.notes.some(n => n.type === "info")).toBe(true);
  });

  test("/style teacher --project persists to the project state file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --project", ctx);
    expect(readState(projectStateFile(cwd))).toEqual({ active: "teacher" });
  });
});
