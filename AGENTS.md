# Repository Guidelines

## Project Structure & Module Organization

Core runtime code lives in `src/`. The CLI entrypoint is `src/cli.ts`, and MCP server orchestration is in `src/server.ts`.

V2 module layout:

- `src/tools/`: MCP tool handlers (35 tools in `coreTools`)
- `src/driver/`: Playwright Electron/CDP driver layer
- `src/launch/`: launch orchestration (`index.ts`) plus preset/readiness/diagnostics/playbooks modules
- `src/policy/`: policy-as-code schema/loader/merge
- `src/confirmation/`: confirmation gate helpers + store
- `src/snapshot/`: snapshot build/query/viewport/region/diff + ref-map
- `src/actions/`: action target resolution/execution
- `src/types/`: schemas, branded IDs, safety/policy types, errors
- `src/utils/`: logger, event log redaction, time helpers
- `src/artifacts/`: artifact directories + export manifests

Planning and technical notes live in `docs/`. Compiled output goes to `dist/` and should not be edited directly.

Current inventory (2026-02-08 scan):

- `src/` TypeScript files: 101 total
- Runtime `.ts` files (excluding `*.test.ts`): 59
- Test files (`*.test.ts`): 42

For architecture and navigation details, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Build, Test, and Development Commands

- `npm run dev`: start local stdio server with `tsx` (`src/cli.ts serve`)
- `npm run dev -- --policy <path>`: start server with explicit policy file
- `npm run build`: compile TypeScript from `src/` to `dist/`
- `npm run start`: run the built server (`node dist/cli.js serve`)
- `npm run lint`: TypeScript no-emit check (fast structural gate)
- `npm run typecheck`: strict project typecheck via `tsconfig.json`
- `npm test`: run Vitest suite (`vitest run`)
- `npm run format:check`: Prettier check for `src/**/*.ts`

Install dependencies with `npm install`. `playwright` is a peer dependency and must be present in the workspace.

## Coding Style & Naming Conventions

Use TypeScript ESM conventions already present in the repo: 2-space indentation, semicolons, and double quotes. Prefer small modules with named exports and re-export shared APIs from local `index.ts` files. Use descriptive kebab-case filenames for multiword modules (for example, `session-manager.ts`, `server-status.ts`). Keep input/output validation explicit with `zod` schemas where boundaries are exposed.

V2 conventions to keep consistent:

- Launch preset definitions live in `src/launch/presets.ts` and are versioned (`version` field)
- Readiness checks are composed from `src/launch/readiness.ts` signal primitives
- Policy file schema is versioned (`version: 1`) and supports JSON/YAML inputs
- Tool definitions use `defineAirlockTool(...)` with explicit `allowedModes` where relevant
- Session/window implicit targeting behavior is centralized in `src/tools/helpers.ts`

## Testing Guidelines

Testing is based on Vitest. Add tests as `*.test.ts` files under `src/` (co-located with the module under test). Prioritize coverage for tool handlers, schema validation, launch/policy/confirmation flows, session lifecycle, and error normalization paths.

Before opening a PR, run:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run format:check`

No formal coverage threshold is currently enforced; include meaningful assertions for behavior and edge cases.

## Commit & Pull Request Guidelines

This repository currently has no commit history baseline, so use Conventional Commit style going forward (for example, `feat(tools): add wait-for-window matcher`). Keep commits focused and logically scoped. PRs should include:

- Clear summary of behavior changes
- Linked issue/task when applicable
- Test evidence (commands run and results)
- Artifacts/screenshots when UI automation behavior changes

## Security & Configuration Notes

Respect safety defaults. Configure runtime via environment variables such as `AIRLOCK_MODE`, `AIRLOCK_ARTIFACT_ROOT`, and `AIRLOCK_POLICY`, and avoid enabling higher-risk modes unless needed for local debugging.

For policy-as-code, keep policy files reviewed and explicit (disabled tools, confirmation gates, redaction patterns) and avoid weakening mode ceilings.
