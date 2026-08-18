# pi-output-styles

[![npm version](https://img.shields.io/npm/v/pi-output-styles.svg)](https://www.npmjs.com/package/pi-output-styles)
[![npm downloads](https://img.shields.io/npm/dm/pi-output-styles.svg)](https://www.npmjs.com/package/pi-output-styles)
[![CI](https://github.com/LoneExile/pi-output-styles/actions/workflows/ci.yml/badge.svg)](https://github.com/LoneExile/pi-output-styles/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pi-output-styles.svg)](./LICENSE)

Named, swappable system-prompt styles for [Oh My Pi (OMP)](https://pi.dev) and Pi — with a live `/style` switcher. Unlike Claude Code's output styles (which need `/clear` to switch), styles here apply and switch **live, mid-session**.

An active style **replaces OMP’s `# Personality` slot** (who you sound like). Tools, skills, Role, Engineering, Runtime, and later project/safety blocks stay. Custom `SYSTEM.md` with no personality heading gets the style injected before `§ Runtime`.

![/style demo](https://github.com/LoneExile/pi-output-styles/raw/main/assets/demo.gif)

## Install

```bash
# Oh My Pi
omp plugin uninstall pi-output-styles   # needed to leave 0.2.x; install alone is a no-op
omp plugin install npm:pi-output-styles
# or from source:
omp plugin install github:LoneExile/pi-output-styles

# Pi
pi uninstall npm:pi-output-styles
pi install npm:pi-output-styles
# or from source:
pi install git:github.com/LoneExile/pi-output-styles
```

Then start a **new** session. Extensions do not hot-reload. `0.2.x` appended the style as a footnote; `0.3+` replaces the personality slot.



## Use

- `/style` — show the active style and list available ones.
- `/style <name>` — activate a style for this session.
- `/style <name> --save` — also save it as your personal (user) default.
- `/style <name> --project` — save it as the project default (committed with the repo).
- `/style off` — clear the active style for this session (overrides any saved default). `none` is an alias; `off --save` / `off --project` also clears the saved default.
- While composing `/style`, a hint line below the input shows the available flags (`--save` / `--project`).

The status line shows the active style (`style: eli5`). `/style off` restores OMP’s default personality on the next turn.


## Bundled styles

`concise` · `explanatory` · `teacher` · `reviewer` · `diagrams-first` · `ste` · `eli5`.

`ste` writes in [ASD-STE100](https://asd-ste100.org) Simplified Technical English, adapted from [Ege Chelebi's ste-writing skill](https://www.chele.bi/videos/the-cure-for-ai-slop/kit/ste-writing-skill).

`eli5` is [Lydia Hallie's ELI5 style](https://x.com/lydiahallie/status/2080378470111256907).

## Custom styles

Drop a Markdown file in either location (filename = style name unless overridden):

- Project: `<repo>/.omp/output-styles/<name>.md`
- Personal: `~/.omp/agent/output-styles/<name>.md`

```markdown
---
name: teacher
description: Teach as you go
---
Act as a patient teacher. Explain the concept before applying it.
```

The body becomes the personality slot. Precedence — **definitions**: project > user > bundled; **which style is active**: session `/style` > user default > project default.

## Config

- `PI_OUTPUT_STYLES_HOME` — override the user config base (default `~/.omp/agent`).
- User default (written by `--save`): `~/.omp/agent/pi-output-styles.json` (base overridable via `PI_OUTPUT_STYLES_HOME`).
- Project default (written by `--project`, git-tracked): `<repo>/.omp/pi-output-styles.json`.

## Develop

```bash
bun install
bun test
bun x tsc --noEmit
```
