import { describe, test, expect } from "bun:test";
import outputStyles, {
  parseStyle,
  discoverStyles,
  readState,
  writeState,
  resolveActiveName,
  applyStyle,
  parseStyleCommandArgs,
  bundledStylesDir,
  projectStateFile,
  userStateFile,
  styleCompletions,
  styleHintFor,
  startHintPoller,
  resolveActiveStyle,
} from "../extensions/output-styles.ts";

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

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmpStylesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pos-styles-"));
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

  test("same-tier same-name collision resolves deterministically to the alphabetically-last filename", () => {
    const dir = tmpStylesDir({
      "a.md": "---\nname: dup\n---\nBODY-A",
      "z.md": "---\nname: dup\n---\nBODY-Z",
    });
    const m = discoverStyles([dir]);
    expect(m.get("dup")!.body).toBe("BODY-Z");
  });
});

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

import { existsSync } from "node:fs";

describe("bundled styles", () => {
  test("bundledStylesDir resolves to the shipped styles directory", () => {
    expect(existsSync(bundledStylesDir())).toBe(true);
  });

  test("all seven starter styles discover with non-empty bodies", () => {
    const m = discoverStyles([bundledStylesDir()]);
    for (const name of ["concise", "explanatory", "teacher", "reviewer", "diagrams-first", "ste", "eli5"]) {
      expect(m.has(name)).toBe(true);
      expect(m.get(name)!.body.length).toBeGreaterThan(0);
      expect(m.get(name)!.description.length).toBeGreaterThan(0);
      expect(m.get(name)!.body.startsWith("---")).toBe(false);
    }
  });
});

interface Captured {
  commands: Record<string, (args: string, ctx: FakeCtx) => unknown>;
  handlers: Record<string, (event: unknown, ctx: FakeCtx) => unknown>;
  statuses: (string | undefined)[];
  notes: { message: string; type?: string }[];
  widgets: { key: string; lines: string[] | null }[];
  timers: (() => void)[];
  editorText: string;
}
interface FakeCtx {
  cwd: string;
  hasUI: boolean;
  ui: {
    setStatus: (k: string, t: string | undefined) => void;
    setWidget: (k: string, lines: string[] | undefined) => void;
    getEditorText: () => string;
    notify: (m: string, t?: string) => void;
  };
  setInterval: (cb: () => void, ms?: number) => unknown;
}

function harness(cwd: string): { cap: Captured; ctx: FakeCtx } {
  const cap: Captured = { commands: {}, handlers: {}, statuses: [], notes: [], widgets: [], timers: [], editorText: "" };
  const ctx: FakeCtx = {
    cwd,
    hasUI: true,
    ui: {
      setStatus: (_k, t) => cap.statuses.push(t),
      setWidget: (k, lines) => cap.widgets.push({ key: k, lines: lines ?? null }),
      getEditorText: () => cap.editorText,
      notify: (m, t) => cap.notes.push({ message: m, type: t }),
    },
    setInterval: cb => {
      cap.timers.push(cb);
      return 0;
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
    // Personal-by-default: a bare /style (no --save/--project flag) must not
    // persist anything to disk — only sessionActive (in-memory) changes.
    expect(readState(projectStateFile(cwd))).toEqual({});
    expect(readState(userStateFile())).toEqual({});
  });

  test("/style teacher --project persists to the project state file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --project", ctx);
    expect(readState(projectStateFile(cwd))).toEqual({ active: "teacher" });
    expect(readState(userStateFile())).toEqual({});
  });

  test("/style teacher --save persists to the user state file only", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --save", ctx);
    expect(readState(userStateFile())).toEqual({ active: "teacher" });
    expect(readState(projectStateFile(cwd))).toEqual({});
  });

  // sessionActive is "teacher" here (set by the session-scope test above),
  // and each harness() call below builds a fresh `cap`, so these tests
  // observe only their own captured statuses/notes.
  test("session_start sets the status line", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.handlers["session_start"](undefined, ctx);
    expect(cap.statuses).toContain("style: teacher");
  });

  test("hasUI:false suppresses status", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    const noUiCtx: FakeCtx = { ...ctx, hasUI: false };
    await cap.handlers["before_agent_start"]({ prompt: "hi", systemPrompt: ["BASE"] }, noUiCtx);
    expect(cap.statuses).toEqual([]);
  });

  test("/style <unknown> does not clobber the active style", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher", ctx);
    const first = (await cap.handlers["before_agent_start"](
      { prompt: "hi", systemPrompt: ["BASE"] },
      ctx,
    )) as { systemPrompt: string[] };
    expect(first.systemPrompt[1]).toContain("<!-- pi-output-styles:teacher -->");

    await cap.commands["style"]("nope-not-real", ctx);
    const second = (await cap.handlers["before_agent_start"](
      { prompt: "hi", systemPrompt: ["BASE"] },
      ctx,
    )) as { systemPrompt: string[] };
    expect(second.systemPrompt[1]).toContain("<!-- pi-output-styles:teacher -->");
  });

  test("/style teacher resolves the project-local definition over the bundled one", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    mkdirSync(join(cwd, ".omp", "output-styles"), { recursive: true });
    writeFileSync(
      join(cwd, ".omp", "output-styles", "teacher.md"),
      "---\nname: teacher\ndescription: local\n---\nPROJECT-OVERRIDE-BODY",
    );
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher", ctx);
    const result = (await cap.handlers["before_agent_start"](
      { prompt: "hi", systemPrompt: ["BASE"] },
      ctx,
    )) as { systemPrompt: string[] };
    expect(result.systemPrompt[1]).toContain("PROJECT-OVERRIDE-BODY");
  });

  test("before_agent_start never throws even if applyStyle would (malformed base)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher", ctx);
    const malformedEvent = { prompt: "hi", systemPrompt: ["ok", 42] };
    const result = await cap.handlers["before_agent_start"](malformedEvent, ctx);
    expect(result).toBeUndefined();
  });

  test("/style teacher --project notifies a warning and does not throw when saving fails", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    writeFileSync(join(cwd, ".omp"), "not a directory");
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --project", ctx);
    expect(cap.notes.some(n => n.type === "warning" && n.message.includes("saving failed"))).toBe(true);
  });

  test("/style teacher --saev warns about the unknown flag and still applies teacher", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("teacher --saev", ctx);
    expect(cap.notes.some(n => n.type === "warning" && n.message.includes("--saev"))).toBe(true);
    const result = (await cap.handlers["before_agent_start"](
      { prompt: "hi", systemPrompt: ["BASE"] },
      ctx,
    )) as { systemPrompt: string[] };
    expect(result.systemPrompt[1]).toContain("<!-- pi-output-styles:teacher -->");
  });

  test("/style (no args) lists styles with their descriptions", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    await cap.commands["style"]("", ctx);
    const info = cap.notes.find(n => n.type === "info");
    expect(info?.message).toContain("Teach as you go; explain concepts before applying them");
  });

  test("/style off overrides a saved default and clears the session", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" }); // a saved default exists
    await cap.commands["style"]("teacher", ctx);
    expect(resolveActiveStyle(cwd)?.name).toBe("teacher");
    await cap.commands["style"]("off", ctx);
    expect(resolveActiveStyle(cwd)).toBeNull();
    expect(cap.notes.some(n => n.type === "info" && n.message.toLowerCase().includes("off"))).toBe(true);
  });

  test("/style none is an alias for off", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" });
    await cap.commands["style"]("none", ctx);
    expect(resolveActiveStyle(cwd)).toBeNull();
  });

  test("/style off --save clears the saved user default", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-wire-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    const { cap, ctx } = harness(cwd);
    writeState(userStateFile(), { active: "teacher" });
    await cap.commands["style"]("off --save", ctx);
    expect(readState(userStateFile())).toEqual({});
  });
});

describe("styleCompletions", () => {
  const freshCwd = () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-comp-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-home-"));
    return cwd;
  };

  test("completes bundled style names filtered by prefix, with descriptions", () => {
    const items = styleCompletions("te", freshCwd())!;
    expect(items.map(i => i.value)).toEqual(["teacher"]);
    expect(items[0].label).toBe("teacher");
    expect(items[0].description!.length).toBeGreaterThan(0);
  });

  test("advertises the persist flags as a hint on every item", () => {
    const items = styleCompletions("", freshCwd())!;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.hint).toBe("[--save] [--project]");
  });

  test("empty prefix returns all bundled styles, sorted", () => {
    const items = styleCompletions("", freshCwd())!;
    expect(items.map(i => i.value)).toEqual([
      "concise",
      "diagrams-first",
      "eli5",
      "explanatory",
      "reviewer",
      "ste",
      "teacher",
      "off",
    ]);
  });

  test("returns null once a space is present (name already typed)", () => {
    expect(styleCompletions("teacher ", freshCwd())).toBe(null);
  });

  test("returns null when nothing matches", () => {
    expect(styleCompletions("zzz", freshCwd())).toBe(null);
  });

  test("offers 'off' to clear the active style", () => {
    expect(styleCompletions("of", freshCwd())!.map(i => i.value)).toEqual(["off"]);
  });

  test("offers a project style and can shadow a bundled name", () => {
    const cwd = freshCwd();
    mkdirSync(join(cwd, ".omp", "output-styles"), { recursive: true });
    writeFileSync(join(cwd, ".omp", "output-styles", "custom.md"), "---\nname: custom\ndescription: mine\n---\nX");
    expect(styleCompletions("cu", cwd)!.map(i => i.value)).toEqual(["custom"]);
  });
});

describe("styleHintFor", () => {
  test("shows the flag hint while a /style command is composed", () => {
    for (const text of ["/style", "/style ", "/style concise", "/style concise --save", "  /style off --project"]) {
      const lines = styleHintFor(text);
      expect(lines).not.toBeNull();
      expect(lines![0]).toContain("--save");
      expect(lines![1]).toContain("--project");
    }
  });

  test("hides the hint when the input is not a /style command", () => {
    for (const text of ["", "hello", "/styl", "/stylex", "x /style", "/mcp add", "/style:other"]) {
      expect(styleHintFor(text)).toBeNull();
    }
  });
});

describe("startHintPoller", () => {
  test("shows the flag widget while /style is composed, then clears it", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pos-poll-"));
    process.env.PI_OUTPUT_STYLES_HOME = mkdtempSync(join(tmpdir(), "pos-poll-home-"));
    const { cap, ctx } = harness(cwd);
    startHintPoller(ctx);
    expect(cap.timers).toHaveLength(1);

    cap.editorText = "/style concise";
    cap.timers[0](); // tick 1: text changed → debounce, no widget yet
    expect(cap.widgets).toEqual([]);
    cap.timers[0](); // tick 2: stable → widget shown
    expect(cap.widgets).toHaveLength(1);
    expect(cap.widgets[0].key).toBe("pi-output-styles-hint");
    expect(cap.widgets[0].lines!.join("\n")).toContain("--save");
    expect(cap.widgets[0].lines!.join("\n")).toContain("--project");

    cap.timers[0](); // tick 3: unchanged text → no churn
    expect(cap.widgets).toHaveLength(1);

    cap.editorText = "";
    cap.timers[0]();
    cap.timers[0]();
    expect(cap.widgets).toHaveLength(2);
    expect(cap.widgets[1].lines).toBeNull();
  });
});
