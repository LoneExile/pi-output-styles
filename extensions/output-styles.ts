// pi-output-styles — named, append-only system-prompt styles for OMP/Pi.
// Pure helpers are exported for unit testing.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Style {
  name: string;
  description: string;
  body: string;
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
      entries = readdirSync(dir);
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
