# Changelog

## [Unreleased]

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
