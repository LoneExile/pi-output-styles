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
  notify(message: string, type?: NotifyType): void;
}

interface ExtensionContext {
  cwd: string;
  hasUI: boolean;
  ui: ExtensionUI;
}

interface BeforeAgentStartEvent {
  prompt: string;
  systemPrompt?: string[];
}

interface BeforeAgentStartResult {
  systemPrompt?: string[];
}

type EventHandler<E, R = void> = (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>;

interface ExtensionAPI {
  setLabel(label: string): void;
  on(event: "session_start", handler: EventHandler<unknown>): void;
  on(event: "before_agent_start", handler: EventHandler<BeforeAgentStartEvent, BeforeAgentStartResult>): void;
  registerCommand(
    name: string,
    def: { description: string; handler: (args: string, ctx: ExtensionContext) => void | Promise<void> },
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

// Session-active style selection is process-global (module-level) state.
// This assumes one module instance per session/cwd, which holds under
// today's per-session extension loading. If OMP ever shares one module
// instance across multiple concurrent sessions, switch this to a
// cwd-keyed Map instead of a single variable.
let sessionActive: string | null = null;

function styleDirs(cwd: string): string[] {
  // low → high precedence: bundled < user < project
  return [bundledStylesDir(), userStylesDir(), projectStylesDir(cwd)];
}

export function resolveActiveStyle(cwd: string, styles?: Map<string, Style>): Style | null {
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
    description: "Select an append-only output style. Usage: /style [name] [--save] [--project]",
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
      if (!styles.has(name)) {
        ctx.ui.notify(`Unknown style "${name}". Available: ${available}`, "error");
        return;
      }

      sessionActive = name;
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
