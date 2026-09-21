// pi-output-styles — named system-prompt styles for OMP/Pi.
// applyStyle = append (kept for tests). applyStyleReplace = swap the OMP
// personality slot and keep tools/rules. The hook uses replace.
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
  setInterval?(callback: () => void, ms?: number): unknown;
}

interface BeforeAgentStartEvent {
  prompt: string;
  systemPrompt?: string[] | string;
}

interface BeforeAgentStartResult {
  systemPrompt?: string[] | string;
}

interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
  hint?: string;
}

type EventHandler<E, R = void> = (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>;

interface ExtensionAPI {
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

// Raw contents of a state file. Round-tripped verbatim so that keys this
// version does not know about — a newer setting, or a user's own note —
// survive a `--save`. Values are `unknown`: validate at the use site.
export type StyleState = Record<string, unknown>;

// The settings this extension actually understands. Used for the write side,
// so a bad value is a compile error rather than something a user discovers
// when their config silently stops working.
export interface StyleSettings {
  active?: string;
  showStatus?: boolean;
}

// A missing file and an unparseable one are different problems: the first is
// normal, the second means the user edited the file and we are now ignoring
// everything in it. Callers need to tell them apart to avoid (a) staying
// silent about a config that has no effect and (b) overwriting it blind.
export interface StateRead {
  state: StyleState;
  malformed: boolean;
}

export function readStateResult(file: string): StateRead {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { state: {}, malformed: false }; // no file yet → nothing to report
  }
  // Some editors prepend a byte-order mark, which JSON.parse rejects. The file
  // is still what the user thinks it is; don't tell them to "fix the JSON".
  text = text.replace(/^\uFEFF/, "");
  if (text.trim() === "") return { state: {}, malformed: false }; // touched but empty
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { state: parsed as StyleState, malformed: false };
    }
  } catch {
    return { state: {}, malformed: true }; // not JSON at all
  }
  return { state: {}, malformed: true }; // JSON, but not an object (array/number/string/null)
}

export function readState(file: string): StyleState {
  return readStateResult(file).state;
}

// Deliberately permissive: it must be able to write back whatever `readState`
// round-tripped, including keys this version does not model.
export function writeState(file: string, state: StyleState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

// Merges `patch` into the file's existing contents. Refuses to write over a
// file it could not read as a state object, because doing so would silently
// discard whatever the user had put there. Callers already report the throw.
function updateState(file: string, patch: Partial<StyleSettings>): void {
  const { state, malformed } = readStateResult(file);
  if (malformed) throw new Error(`${file} could not be read as a JSON object; refusing to overwrite it`);
  writeState(file, { ...state, ...patch });
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
  const userActive = typeof userState.active === "string" ? userState.active : null;
  const projectActive = typeof projectState.active === "string" ? projectState.active : null;
  return sessionActive ?? userActive ?? projectActive;
}

export function resolveShowStatus(userState: StyleState, projectState: StyleState): boolean {
  if (typeof userState.showStatus === "boolean") return userState.showStatus;
  if (typeof projectState.showStatus === "boolean") return projectState.showStatus;
  return true;
}

const MARKER_PREFIX = "<!-- pi-output-styles:";

export function styleMarker(style: Style): string {
  return `${MARKER_PREFIX}${style.name} -->\n${style.body}`;
}

export function applyStyle(baseBlocks: string[] | undefined, style: Style): string[] {
  const base = Array.isArray(baseBlocks) ? baseBlocks : [];
  if (base.some(b => b.includes(MARKER_PREFIX))) return base;
  return [...base, styleMarker(style)];
}

// OMP default template (system-prompt.md) inlines personality as:
//   # Personality
//   <preset>
//   § Runtime
// Nested # Tone / # Reasoning headings sit inside that slot. The next `§ `
// heading (usually `§ Runtime`) is the hard stop. Custom SYSTEM.md omits the
// slot; we then inject before `§ Runtime`, else before any `§ ` that is not
// `§ Role`, else append — always inside block 0. We never delete tools,
// skills, or safety blocks.
// /m makes $ end-of-line; (?![\s\S]) is true EOF so # Tone inside the slot is consumed.
const PERSONALITY_SECTION = /^# Personality[ \t]*(?:\r?\n)[\s\S]*?(?=\r?\n\r?\n§ |\r?\n§ |(?![\s\S]))/m;

export function replacePersonalitySection(text: string, inner: string): { text: string; swapped: boolean } {
  if (PERSONALITY_SECTION.test(text)) {
    return { text: text.replace(PERSONALITY_SECTION, () => `# Personality\n${inner}`), swapped: true };
  }
  const beforeRuntime = text.replace(/(\r?\n)§ Runtime\b/, (_m, nl: string) => `\n\n# Personality\n${inner}${nl}§ Runtime`);
  if (beforeRuntime !== text) return { text: beforeRuntime, swapped: false };
  const beforeOther = text.replace(/(\r?\n)§ (?!Role\b)/, (_m, nl: string) => `\n\n# Personality\n${inner}${nl}§ `);
  if (beforeOther !== text) return { text: beforeOther, swapped: false };
  return { text: `${text}\n\n# Personality\n${inner}`, swapped: false };
}

// Personality lives in block 0 of OMP's rebuilt-per-turn systemPrompt.
// Later blocks are project context / README and may quote `# Personality`
// or `§ Runtime` in prose — never scan them.
export function applyStyleReplace(baseBlocks: string[] | undefined, style: Style): string[] {
  const base = Array.isArray(baseBlocks) ? baseBlocks : [];
  if (base.some(b => b.includes(MARKER_PREFIX))) return base;
  const marked = styleMarker(style);
  if (base.length === 0) return [marked];

  const out = base.slice();
  out[0] = replacePersonalitySection(out[0], marked).text;
  return out;
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
  if (typeof ctx.setInterval !== "function") return;
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

export function resolveActiveStyle(
  cwd: string,
  styles?: Map<string, Style>,
  userState = readState(userStateFile()),
  projectState = readState(projectStateFile(cwd)),
): Style | null {
  if (session.type === "off") return null;
  const sessionActive = session.type === "style" ? session.name : null;
  const name = resolveActiveName(sessionActive, userState, projectState);
  if (!name) return null;
  const map = styles ?? discoverStyles(styleDirs(cwd));
  return map.get(name) ?? null;
}

function refreshStatus(ctx: ExtensionContext, style: Style | null, showStatus: boolean): void {
  if (!ctx.hasUI || typeof ctx.ui.setStatus !== "function") return;
  ctx.ui.setStatus(STATUS_KEY, showStatus && style ? `style: ${style.name}` : undefined);
}

// An unparseable state file is ignored in full: the saved style stops applying
// and `showStatus` stops being honoured, which is indistinguishable from
// "nothing was ever saved". Say so once per session rather than never.
function warnMalformedState(ctx: ExtensionContext, reads: [string, StateRead][]): void {
  if (!ctx.hasUI || typeof ctx.ui.notify !== "function") return;
  const bad = reads.filter(([, read]) => read.malformed).map(([file]) => file);
  if (bad.length === 0) return;
  ctx.ui.notify(
    `Ignoring ${bad.length === 1 ? "a state file that is not a JSON object" : "state files that are not JSON objects"}: ${bad.join(", ")}. ` +
      "Fix the file to restore the saved style and showStatus setting.",
    "warning",
  );
}

export default function outputStyles(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const user = readStateResult(userStateFile());
    const project = readStateResult(projectStateFile(ctx.cwd));
    warnMalformedState(ctx, [
      [userStateFile(), user],
      [projectStateFile(ctx.cwd), project],
    ]);
    refreshStatus(
      ctx,
      resolveActiveStyle(ctx.cwd, undefined, user.state, project.state),
      resolveShowStatus(user.state, project.state),
    );
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
      const userState = readState(userStateFile());
      const projectState = readState(projectStateFile(ctx.cwd));
      const showStatus = resolveShowStatus(userState, projectState);
      const style = resolveActiveStyle(ctx.cwd, undefined, userState, projectState);
      if (!style) {
        refreshStatus(ctx, null, showStatus);
        return;
      }
      // Apply first; only reflect the style in the status line once the
      // prompt was actually augmented, so a swallowed throw never advertises
      // a style the turn did not apply.
      // OMP: systemPrompt is string[]. Pi: a single string. Return the same shape.
      const incoming = event.systemPrompt;
      const systemPrompt =
        typeof incoming === "string"
          ? (applyStyleReplace([incoming], style)[0] ?? styleMarker(style))
          : applyStyleReplace(incoming, style);
      const result = { systemPrompt };
      refreshStatus(ctx, style, showStatus);
      return result;
    } catch {
      return; // never fail a turn over a styling concern
    }
  });

  pi.registerCommand("style", {
    description: "Select an output style (replaces the OMP personality slot), or clear it. Usage: /style [name|off] [--save] [--project]",
    getArgumentCompletions: argumentPrefix => styleCompletions(argumentPrefix, process.cwd()),
    handler: (args, ctx) => {
      const { name, persist } = parseStyleCommandArgs(args);
      const styles = discoverStyles(styleDirs(ctx.cwd));
      const userState = readState(userStateFile());
      const projectState = readState(projectStateFile(ctx.cwd));
      const showStatus = resolveShowStatus(userState, projectState);
      const available = [...styles.keys()].sort().join(", ") || "(none)";

      const unknownFlags = args
        .trim()
        .split(/\s+/)
        .filter(t => t.startsWith("--") && !KNOWN_FLAGS.includes(t));
      if (unknownFlags.length > 0) {
        ctx.ui.notify(`Ignored unknown flag(s): ${unknownFlags.join(", ")}`, "warning");
      }

      if (!name) {
        const current = resolveActiveStyle(ctx.cwd, styles, userState, projectState);
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
            updateState(userStateFile(), { active: undefined });
            offScope = "cleared · user default";
          } else if (persist === "project") {
            updateState(projectStateFile(ctx.cwd), { active: undefined });
            offScope = "cleared · project default";
          }
        } catch (err) {
          ctx.ui.notify(`Cleared for this session, but updating the saved default failed: ${String(err)}`, "warning");
        }
        refreshStatus(ctx, null, showStatus);
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
          updateState(userStateFile(), { active: name });
          scope = "saved · user default";
        } else if (persist === "project") {
          updateState(projectStateFile(ctx.cwd), { active: name });
          scope = "saved · project default";
        }
      } catch (err) {
        ctx.ui.notify(`Applied for this session, but saving failed: ${String(err)}`, "warning");
      }
      refreshStatus(ctx, styles.get(name) ?? null, showStatus);
      ctx.ui.notify(`Output style → "${name}" (${scope}).`, "info");
    },
  });
}
