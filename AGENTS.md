# Repository Guidelines

## Project Structure & Module Organization

Core runtime code lives in `src/`. The CLI entrypoint is `src/cli.ts`, and the MCP server orchestration is in `src/server.ts`. Tool implementations are grouped in `src/tools/`, Playwright Electron integration is in `src/driver/`, shared schemas/types are in `src/types/`, and support utilities are in `src/utils/`, `src/snapshot/`, `src/actions/`, and `src/artifacts/`. Planning and technical notes are in `docs/`. Compiled output goes to `dist/` from TypeScript builds and should not be edited directly.

For detailed architecture, module guide, data flow diagrams, and navigation guide, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Build, Test, and Development Commands

- `npm run dev`: start the local stdio server with `tsx` (`src/cli.ts serve`).
- `npm run build`: compile TypeScript from `src/` to `dist/`.
- `npm run start`: run the built server (`node dist/cli.js serve`).
- `npm run lint`: TypeScript no-emit check (fast structural lint gate).
- `npm run typecheck`: strict project typecheck via `tsconfig.json`.
- `npm test`: run Vitest test suite (`vitest run`).

Install dependencies with `npm install`. `playwright` is a peer dependency and must be available in the workspace.

## Coding Style & Naming Conventions

Use TypeScript ESM conventions already present in the repo: 2-space indentation, semicolons, and double quotes. Prefer small modules with named exports and re-export shared APIs from local `index.ts` files. Use descriptive kebab-case filenames for multiword modules (for example, `session-manager.ts`, `server-status.ts`). Keep input/output validation explicit with `zod` schemas where boundaries are exposed.

## Testing Guidelines

Testing is based on Vitest. Add tests as `*.test.ts` files under `src/` (co-located with the module under test). Prioritize coverage for tool handlers, schema validation, session lifecycle, and error normalization paths. Before opening a PR, run:

- `npm test`
- `npm run typecheck`

No formal coverage threshold is currently enforced; include meaningful assertions for behavior and edge cases.

## Commit & Pull Request Guidelines

This repository currently has no commit history baseline, so use Conventional Commit style going forward (for example, `feat(tools): add wait-for-text timeout`). Keep commits focused and logically scoped. PRs should include:

- Clear summary of behavior changes
- Linked issue/task when applicable
- Test evidence (commands run and results)
- Artifacts/screenshots when UI automation behavior changes

## Security & Configuration Notes

Respect safety defaults. Configure runtime via environment variables such as `AIRLOCK_MODE` and `AIRLOCK_ARTIFACT_ROOT`, and avoid enabling higher-risk modes unless needed for local debugging.
