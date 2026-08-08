// pi-output-styles — named, append-only system-prompt styles for OMP/Pi.
// Pure helpers are exported for unit testing.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Style {
  name: string;
  description: string;
  body: string;
}

type NotifyType = "info" | "warning" | "error";

interface ExtensionUI {
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, lines: string[] | undefined, options?: { placement: "aboveEditor" | "belowEditor" }): void;
  getEditorText(): string;
  notify(message: string, type?: NotifyType): void;
}

interface ExtensionContext {
  cwd: string;
  hasUI: boolean;
  ui: ExtensionUI;
  setInterval(callback: () => void, ms?: number): unknown;
}

interface BeforeAgentStartEvent {
  prompt: string;
  systemPrompt?: string[];
}

interface BeforeAgentStartResult {
  systemPrompt?: string[];
}

interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
  hint?: string;
}

type EventHandler<E, R = void> = (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>;

interface ExtensionAPI {
  setLabel(label: string): void;
  on(event: "session_start", handler: EventHandler<unknown>): void;
  on(event: "session_shutdown", handler: EventHandler<unknown>): void;
  on(event: "before_agent_start", handler: EventHandler<BeforeAgentStartEvent, BeforeAgentStartResult>): void;
  registerCommand(
    name: string,
    def: {
      description: string;
      getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
      handler: (args: string, ctx: ExtensionContext) => void | Promise<void>;
    },
  ): void;
}

export function parseStyle(text: string, fallbackName: string): Style {
  let name = fallbackName;
  let description = "";
  let body = text;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (fm) {
    body = fm[2];
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
      if (key === "name" && value.length > 0) name = value;
      else if (key === "description") description = value;
    }
  }
  return { name, description, body: body.trim() };
}

export function discoverStyles(dirsLowToHigh: string[]): Map<string, Style> {
  const styles = new Map<string, Style>();
  for (const dir of dirsLowToHigh) {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      let text: string;
      try {
        text = readFileSync(join(dir, entry), "utf8");
      } catch {
        continue;
      }
      const style = parseStyle(text, entry.slice(0, -3));
      if (style.body.length === 0) continue;
      styles.set(style.name, style);
    }
  }
  return styles;
}

export function configHome(): string {
  return process.env.PI_OUTPUT_STYLES_HOME || join(homedir(), ".omp", "agent");
}

export function userStylesDir(): string {
  return join(configHome(), "output-styles");
}

export function projectStylesDir(cwd: string): string {
  return join(cwd, ".omp", "output-styles");
}

export function bundledStylesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "styles");
}

export interface StyleState {
  active?: string;
}

export function readState(file: string): StyleState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && "active" in parsed && typeof parsed.active === "string") {
      return { active: parsed.active };
    }
  } catch {
    // missing or malformed → empty
  }
  return {};
}

export function writeState(file: string, state: StyleState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

export function userStateFile(): string {
  return join(configHome(), "pi-output-styles.json");
}

export function projectStateFile(cwd: string): string {
  return join(cwd, ".omp", "pi-output-styles.json");
}

export function resolveActiveName(
  sessionActive: string | null,
  userState: StyleState,
  projectState: StyleState,
): string | null {
  return sessionActive ?? userState.active ?? projectState.active ?? null;
}

const MARKER_PREFIX = "<!-- pi-output-styles:";

export function applyStyle(baseBlocks: string[] | undefined, style: Style): string[] {
  const base = Array.isArray(baseBlocks) ? baseBlocks : [];
  if (base.some(b => b.includes(MARKER_PREFIX))) return base;
  return [...base, `${MARKER_PREFIX}${style.name} -->\n${style.body}`];
}

export type PersistScope = "none" | "user" | "project";

export interface StyleCommandArgs {
  name: string | null;
  persist: PersistScope;
}

// Flags recognized by the /style command. parseStyleCommandArgs maps each to a
// persist scope; the command handler warns on any --flag NOT in this set.
// Keep this in sync with the flag handling in parseStyleCommandArgs.
const KNOWN_FLAGS = ["--save", "--global", "--project"];

// Reserved argument words that clear the active style instead of selecting one.
const OFF_WORDS: Record<string, true> = { off: true, none: true };

export function parseStyleCommandArgs(args: string): StyleCommandArgs {
  const tokens = args.trim().split(/\s+/).filter(t => t.length > 0);
  let name: string | null = null;
  let save = false;
  let project = false;
  for (const t of tokens) {
    if (t === "--save" || t === "--global") save = true;
    else if (t === "--project") project = true;
    else if (!t.startsWith("--") && name === null) name = t;
  }
  const persist: PersistScope = project ? "project" : save ? "user" : "none";
  return { name, persist };
}

const STATUS_KEY = "pi-output-styles";
const HINT_KEY = "pi-output-styles-hint";
// Persistent ghost hint shown below the editor while a `/style` command is
// being composed. OMP only renders inline usage ghost text for builtin
// commands, so this widget carries the same message for extension commands.
const STYLE_HINT_LINES = [
  "/style <name|off> [--save] [--project]",
  "persist: --save (user default, --global alias) · --project (this project)",
];

// Pure matcher for the widget: show the hint while the input starts with a
// `/style` command word (line start, with optional leading whitespace).
export function styleHintFor(text: string): string[] | null {
  return /^\s*\/style(?:\s|$)/.test(text) ? STYLE_HINT_LINES : null;
}

// Poller state: one started flag guards re-registration across in-process
// session restarts; lastHintInput dedupes widget updates against the text the
// hint was computed for.
let started = false;
let lastHintInput: string | null = null;

// Debounced poller: only updates the widget once the input text is stable
// across a tick and differs from the last-checked text. Exported for tests.
export function startHintPoller(ctx: ExtensionContext): void {
  let stableInput: string | null = null;
  ctx.setInterval(() => {
    const text = ctx.ui.getEditorText();
    if (text !== stableInput) {
      stableInput = text;
      return;
    }
    const lines = styleHintFor(text);
    if (lines !== null && lastHintInput !== text) {
      ctx.ui.setWidget(HINT_KEY, lines, { placement: "belowEditor" });
      lastHintInput = text;
    } else if (lines === null && lastHintInput !== null) {
      ctx.ui.setWidget(HINT_KEY, undefined);
      lastHintInput = null;
    }
  }, 600);
}

// Session-active style selection is process-global (module-level) state.
// This assumes one module instance per session/cwd, which holds under
// today's per-session extension loading. If OMP ever shares one module
// instance across multiple concurrent sessions, switch this to a
// cwd-keyed Map instead of a single variable.
type SessionSelection = { type: "inherit" } | { type: "off" } | { type: "style"; name: string };
let session: SessionSelection = { type: "inherit" };

function styleDirs(cwd: string): string[] {
  // low → high precedence: bundled < user < project
  return [bundledStylesDir(), userStylesDir(), projectStylesDir(cwd)];
}

// Argument completions for `/style <name>`: matches style names by prefix.
// getArgumentCompletions carries no ctx, so discovery uses process.cwd() as the
// project scope (best-effort; the command handler still uses ctx.cwd).
// Flags advertised as dim ghost text on every completion item, so users see
// that a style can be persisted beyond the session with --save (user default)
// or --project (per-project default). --global is accepted as a --save alias.
const FLAG_HINT = "[--save] [--project]";

export function styleCompletions(argumentPrefix: string, cwd: string): AutocompleteItem[] | null {
  if (argumentPrefix.includes(" ")) return null;
  const prefix = argumentPrefix.trim().toLowerCase();
  const styleItems: AutocompleteItem[] = [...discoverStyles(styleDirs(cwd)).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => ({ value: s.name, label: s.name, description: s.description || undefined, hint: FLAG_HINT }));
  const offItem: AutocompleteItem = {
    value: "off",
    label: "off",
    description: "Turn off styling for this session",
    hint: FLAG_HINT,
  };
  const items = [...styleItems, offItem].filter(i => i.value.toLowerCase().startsWith(prefix));
  return items.length > 0 ? items : null;
}

export function resolveActiveStyle(cwd: string, styles?: Map<string, Style>): Style | null {
  if (session.type === "off") return null;
  const sessionActive = session.type === "style" ? session.name : null;
  const name = resolveActiveName(
    sessionActive,
    readState(userStateFile()),
    readState(projectStateFile(cwd)),
  );
  if (!name) return null;
  const map = styles ?? discoverStyles(styleDirs(cwd));
  return map.get(name) ?? null;
}

function refreshStatus(ctx: ExtensionContext, style: Style | null): void {
  if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, style ? `style: ${style.name}` : undefined);
}

export default function outputStyles(pi: ExtensionAPI): void {
  pi.setLabel("output-styles");

  pi.on("session_start", (_event, ctx) => {
    refreshStatus(ctx, resolveActiveStyle(ctx.cwd));
    if (started || !ctx.hasUI) return;
    started = true;
    startHintPoller(ctx);
    pi.on("session_shutdown", () => {
      started = false;
      lastHintInput = null;
    });
  });

  pi.on("before_agent_start", (event, ctx) => {
    try {
      const style = resolveActiveStyle(ctx.cwd);
      if (!style) {
        refreshStatus(ctx, null);
        return;
      }
      // Apply first; only reflect the style in the status line once the
      // prompt was actually augmented, so a swallowed throw never advertises
      // a style the turn did not apply.
      const result = { systemPrompt: applyStyle(event.systemPrompt, style) };
      refreshStatus(ctx, style);
      return result;
    } catch {
      return; // never fail a turn over a styling concern
    }
  });

  pi.registerCommand("style", {
    description: "Select an append-only output style, or clear it. Usage: /style [name|off] [--save] [--project]",
    getArgumentCompletions: argumentPrefix => styleCompletions(argumentPrefix, process.cwd()),
    handler: (args, ctx) => {
      const { name, persist } = parseStyleCommandArgs(args);
      const styles = discoverStyles(styleDirs(ctx.cwd));
      const available = [...styles.keys()].sort().join(", ") || "(none)";

      const unknownFlags = args
        .trim()
        .split(/\s+/)
        .filter(t => t.startsWith("--") && !KNOWN_FLAGS.includes(t));
      if (unknownFlags.length > 0) {
        ctx.ui.notify(`Ignored unknown flag(s): ${unknownFlags.join(", ")}`, "warning");
      }

      if (!name) {
        const current = resolveActiveStyle(ctx.cwd, styles);
        const listing = [...styles.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(s => (s.description ? `${s.name} — ${s.description}` : s.name))
          .join("\n");
        ctx.ui.notify(`Active style: ${current?.name ?? "(none)"}\nAvailable:\n${listing || "(none)"}`, "info");
        return;
      }
      if (OFF_WORDS[name.toLowerCase()]) {
        session = { type: "off" };
        let offScope = "this session";
        try {
          if (persist === "user") {
            writeState(userStateFile(), {});
            offScope = "cleared · user default";
          } else if (persist === "project") {
            writeState(projectStateFile(ctx.cwd), {});
            offScope = "cleared · project default";
          }
        } catch (err) {
          ctx.ui.notify(`Cleared for this session, but updating the saved default failed: ${String(err)}`, "warning");
        }
        refreshStatus(ctx, null);
        ctx.ui.notify(`Output style off (${offScope}).`, "info");
        return;
      }
      if (!styles.has(name)) {
        ctx.ui.notify(`Unknown style "${name}". Available: ${available}`, "error");
        return;
      }

      session = { type: "style", name };
      let scope = "this session";
      try {
        if (persist === "user") {
          writeState(userStateFile(), { active: name });
          scope = "saved · user default";
        } else if (persist === "project") {
          writeState(projectStateFile(ctx.cwd), { active: name });
          scope = "saved · project default";
        }
      } catch (err) {
        ctx.ui.notify(`Applied for this session, but saving failed: ${String(err)}`, "warning");
      }
      refreshStatus(ctx, styles.get(name) ?? null);
      ctx.ui.notify(`Output style → "${name}" (${scope}).`, "info");
    },
  });
}
