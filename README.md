# pi-output-styles

Named, swappable, **append-only** system-prompt styles for [Oh My Pi (OMP)](https://pi.dev) and Pi — with a live `/style` switcher. Unlike Claude Code's output styles (which need `/clear` to switch), styles here apply and switch **live, mid-session**.

## Install

```bash
omp plugin install github:LoneExile/pi-output-styles
```

## Use

- `/style` — show the active style and list available ones.
- `/style <name>` — activate a style for this session.
- `/style <name> --save` — also save it as your personal (user) default.
- `/style <name> --project` — save it as the project default (committed with the repo).

The active style's text is **appended** to the system prompt every turn; it never replaces OMP's default behavior. The status line shows the active style.

## Bundled styles

`concise` · `explanatory` · `teacher` · `reviewer` · `diagrams-first`.

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

The body is appended to the prompt. Precedence — **definitions**: project > user > bundled; **which style is active**: session `/style` > user default > project default.

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
