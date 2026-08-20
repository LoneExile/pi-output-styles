# Changelog

## [Unreleased]

## [0.3.2] - 2026-08-20

### Added
- Bundled `omp-friendly` and `omp-pragmatic` styles: Oh My Pi's other two built-in `personality` presets, alongside `omp-default`.

### Changed
- Renamed the `omp` bundled style to `omp-default`, to match the new `omp-friendly` / `omp-pragmatic` naming. If you had `/style omp` selected or saved (`--save`/`--project`), switch to `omp-default`.

## [0.3.1] - 2026-08-20

### Added
- Bundled `omp` style: Oh My Pi's own built-in [`personality: default`](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/prompts/system/personalities/default.md) (evidence-first terse engineer), so it can be pinned explicitly or used as-is by Pi, which has no native personality picker.

## [0.3.0] - 2026-08-18

> **Upgrade note.** `/style` now replaces everything from `# Personality` through the next `§` heading (including nested `# Tone` / `# Reasoning`) instead of appending a footnote. Tools, skills, Role, Engineering, Runtime, and later blocks stay. Lens styles (`concise`, `reviewer`, `ste`, `diagrams-first`, `explanatory`) now *are* the persona — they no longer layer on the default engineer voice. Saved defaults still apply. Pin `0.2.1` if you need append. Leave 0.2.x, then a new session: OMP `omp plugin uninstall pi-output-styles && omp plugin install npm:pi-output-styles` · Pi `pi uninstall npm:pi-output-styles && pi install npm:pi-output-styles`.

### Changed
- `before_agent_start` swaps the `# Personality` slot (`applyStyleReplace`) instead of appending. Only `systemPrompt[0]` is edited. Style bodies are inserted via a replace callback so `$&` / `$$` in markdown stay literal. `applyStyle` remains the append helper for tests and comparison.

### Fixed
- Pi load: drop `setLabel` at factory time, skip the hint poller when `ctx.setInterval` is missing, and return `systemPrompt` as a string when Pi passes a string (OMP still uses `string[]`).

## [0.2.1] - 2026-08-08

### Added
- Persistent flag hint while composing `/style`: a dim widget below the input shows `--save` (user default, `--global` alias) and `--project` (project default) once the command is detected, and clears when it is not.
- `/style` tab-completion items advertise the persist flags as a dim hint in the dropdown.


## [0.2.0] - 2026-08-07

### Added
- Bundled `ste` style: ASD-STE100 Simplified Technical English (strict for procedures/errors, STE-flavored for prose).
- Bundled `eli5` style: casual "explain like I'm 5" mode (adapted from Lydia Hallie).

## [0.1.0] - 2026-08-07

### Added
- Append-only system-prompt styles with a live `/style` switcher (switches mid-session, no restart).
- Config default (user/project) plus session override; `--save` (user) / `--project` (git-tracked) persistence, personal-by-default.
- `/style off` (alias `none`) clears the active style for the session; `off --save` / `off --project` also clears the saved default.
- Tab-completion of style names (and `off`) for the `/style` command, with descriptions.
- Bundled starter styles: concise, explanatory, teacher, reviewer, diagrams-first.
- Status-line indicator of the active style.
