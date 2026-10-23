# AGENTS

## Project Overview

`llubi playground` is an online playground for **llubi**, LLVM's UB-aware IR
interpreter. The public site is https://dtcxzyw.github.io/llubi/. The
interpreter is compiled to WebAssembly with Emscripten so LLVM IR executes
entirely in the browser without a backend.

The page shows the LLVM version, LLVM commit, and build time, exposes llubi's
interpreter options, highlights diagnostics on the corresponding IR lines, and
auto-runs after edits. The verbose instruction trace is always enabled.

The repository contains the playground frontend, the wasm bridge, generated
catalog tooling, and the deployment workflow. It intentionally does not contain
an LLVM checkout and does not hard-code a path to one.

- `web/`: Vite + TypeScript UI, CodeMirror integration, workers, and Playwright
  tests.
- `wasm/`: Emscripten entry points and the bridge into llubi.
- `scripts/`: toolchain setup, wasm builds, development server, smoke tests, and
  generated completion/example catalogs.
- `.github/workflows/pages.yml`: CI and GitHub Pages deployment.

## Local Development

The repository does not contain an LLVM checkout and does not hard-code a path
to one. Point the scripts at any `llvm-project` checkout that contains
`llvm/tools/llubi`.

```bash
# One-time toolchain setup: pinned Node.js + Emscripten in a cache directory.
# Writes ~/.cache/llubi-web/env.sh (override with LLUBI_TOOLS_DIR).
bash scripts/setup.sh

# Build the wasm module and start Vite.
python3 scripts/dev.py --llvm-source /path/to/llvm-project
```

Useful variants:

```bash
# Reuse an existing native llvm-tblgen instead of building one.
python3 scripts/dev.py \
  --llvm-source /path/to/llvm-project \
  --native-tool-dir /path/to/native-build/bin

# Rebuild the wasm module before serving.
python3 scripts/dev.py --llvm-source /path/to/llvm-project --rebuild

# Serve an existing build without recompiling wasm.
python3 scripts/dev.py --no-build

# Only build and stage the wasm artifacts (used by CI).
python3 scripts/build.py --llvm-source /path/to/llvm-project
```

The scripts read `LLVM_SOURCE_DIR` and `LLVM_NATIVE_TOOL_DIR` from the
environment as well. Build output is placed in `build/` and staged into
`web/public/wasm/`; neither is committed.

Requirements: Python 3.9+, CMake 3.20+, Ninja, Git, and a C++17 host compiler.
`scripts/setup.sh` installs Node.js and emsdk and checks the rest. `ccache` is
used automatically when available.

## Web App

- Vite + TypeScript, CodeMirror 6 for the IR editor and diagnostics.
- Completion data is generated at build time from LLParser tokens (`LLLexer.cpp`)
  and TableGen outputs (`Attributes.inc`, `IntrinsicEnums.inc`,
  `IntrinsicImpl.inc`, `TargetLibraryInfo.inc`), plus `.def` metadata names and
  llubi's supported libcall switch. No instruction, intrinsic, or libcall list
  is maintained by hand.
- Auto/Manual mode switch: Auto hides the Run button and reruns after edits;
  Manual exposes an explicit Run action. Ctrl/Cmd+Enter always runs.
- The theme picker follows the system light/dark appearance by default and also
  offers explicit light, dark, colorblind-friendly, and high-contrast themes;
  the choice is stored locally. Themes meet WCAG AA text and control-boundary
  contrast, with the high-contrast text palette exceeding AAA, and typography
  scales to 200% without losing access to content.
- Execution happens in a Web Worker; a new edit supersedes an in-flight run,
  and long runs are killed after 10 seconds.
- Verbose trace rows jump to their instruction, call site, function, or label in
  the editor; clicking a source line or line number jumps back to the matching
  trace row.
- The Examples drawer lists two built-in samples first and then every `.ll` test
  from `llvm/test/tools/llubi`, with check lines stripped and the first RUN line
  parsed into playground options when possible.
- The output pane separates program output from interpreter diagnostics and
  trace with a draggable horizontal divider that starts at 1/6 and 5/6.
- The toolbar shows the equivalent `; RUN:` line for the last run and copies it
  when clicked. The output header can copy generated FileCheck lines or generate
  a complete lit test with the update header, RUN line, cleaned IR, and checks;
  stdout and stderr are combined in execution order like
  `update_llubi_test_checks.py`, and failing runs get a `not ` prefix.
- The wasm build enables LLVM assertions while forcing ABI-breaking checks off.
  A crash is reported as an internal interpreter error with the assertion or
  LLVM fatal message, and the worker is recreated for the next run.
- Interpreter output is structured JSON. Runtime errors get source lines by
  redirecting LLVM's stderr stack trace to a MEMFS file and parsing the
  `Stacktrace:` frames. This keeps the LLVM checkout unmodified.
- `web/public/build-info.json` is generated at build time and shown in the
  header.

```bash
cd web
npm ci
npm run build      # typecheck + production build
npm run test:e2e   # Playwright tests (build first)
npm run smoke      # headless wasm API test (build wasm first)
```

## CI and GitHub Pages

`.github/workflows/pages.yml`:

- runs on every push to `main`, every day at 03:17 UTC against the latest
  official `llvm/llvm-project` `main`, and on manual `workflow_dispatch`
  (with an optional `llvm_ref` input);
- uses GitHub-hosted `ubuntu-latest` runners;
- caches the pinned Node/emsdk toolchain, ccache objects, npm downloads, and
  Playwright browsers;
- runs the Node wasm smoke test and browser tests before deploying;
- deploys with `actions/deploy-pages`; a failed daily build leaves the previous
  deployment online.

Enable **Settings → Pages → Build and deployment → GitHub Actions** once for
the repository. The Vite base path is derived from the repository name, and
`<owner>.github.io` repositories use `/`.

The header shows the exact LLVM commit and build timestamp, so a daily build is
easy to verify. The workflow pins the Emscripten version in `scripts/setup.sh`
and uses the latest LLVM `main` every day.

## Repository Language Rules

- Write all repository content in English and reply to the user in the user's language.

## User Interaction Rules

- If requirements or plans are ambiguous, eliminate disagreement instead of guessing: first explore the codebase when that can answer the question, otherwise ask clarifying questions aggressively, preferably one at a time.
- Clarifying questions must drive toward shared understanding by walking the design tree and resolving decision dependencies; each question must cover purpose, constraints, success criteria, or scope boundaries as appropriate, include all viable options, avoid requiring free-form input, and state the recommended answer.
- After the user approves execution, keep going until the full planned task is complete. Do not stop for intermediate progress reports, return control while the approved goal is only partially implemented, or ask whether to continue with obvious next steps, natural follow-ups, or clear previews, summaries, or refinements unless a genuine blocker, real ambiguity, or material risk requires user input.
- If something should obviously be done now, do it instead of deferring it to "later", "next", or a "follow-up". When reviewing or refining in-progress work, immediately implement any concrete fix you understand and that is not blocked.
- Resolve encountered difficulties autonomously whenever possible.
- When handing control back to the user after task completion, end the response with `Done.`

## Design and Planning Rules

- Before proposing a design or implementation, inspect the current project context, including relevant files, documentation, and recent changes.
- State assumptions explicitly. If materially different interpretations remain after exploration, surface and resolve them instead of silently choosing one.
- For feature work, behavior changes, and other creative or architectural tasks, complete a design step before implementation. If the request is too broad for one coherent spec or plan, decompose it into smaller subprojects and handle them one at a time.
- After gathering enough context, present 2-3 viable approaches with trade-offs and a recommended option, size the design sections to the topic, and validate the design with the user before implementation.
- Before substantial implementation, define concrete success criteria and explicit checks that prove completion; prefer tests, builds, or other verifiable validation over vague goals.
- Unless the user explicitly asks for a temporary workaround, limited experiment, reduced-scope language design, or backwards compatibility, design and implement the final intended product: complete behavior, durable interfaces, maintainable structure, the full language design rather than a staged or minimal subset, and clean breaking changes instead of compatibility shims during rapid iteration.
- If a requested feature depends on a lower-level prerequisite, implement that prerequisite as part of the work instead of lowering the acceptance bar, trimming scope, or presenting a partial workaround as complete.
- Do not limit the solution to the smallest easy increment or patch size when the correct solution requires broader structural changes. Make decisive, coherent refactors, including renaming APIs, reshaping module boundaries, or replacing flawed internal structures when needed.
- Design systems as small, well-bounded units with clear responsibilities, explicit interfaces, and dependencies that are easy to understand and test independently.
- In existing codebases, follow established patterns unless changing them is necessary to support the current goal.
- Apply YAGNI strictly. Make focused changes, avoid unrelated reformatting or cleanup, and remove only unrequested features, speculative abstractions, unnecessary complexity, or artifacts made unused by your own change unless broader cleanup was requested.

## Git Commit Rules

- Preserve a linear history. Do not force push except when rebasing a PR branch onto the latest `origin/main` and force-pushing that same PR branch update.
- Do not amend commits that have already been pushed, and do not rewrite, replace, or reorder existing commits unless the user explicitly requests it.
- Before starting work, ensure the worktree is clean; if prior changes are present, review them and commit the relevant ones before beginning new task work.
- Commit changes automatically after each completed milestone without waiting for the user to ask. After finishing a logical unit of work that passes tests and pre-commit checks, immediately stage and commit with a proper Conventional Commit message, then ensure the worktree is clean.
- Never commit temporary files, scratch artifacts, ad hoc notes, or other non-durable byproducts.
- Use specific Conventional Commits for every commit. When a commit is non-trivial, include a body describing what changed, why it changed, and what validation was performed; make the subject identify the precise logical unit and the body record the concrete scope of the change.
- Split commits by logical unit so they stay focused and reviewable.
- Ensure relevant tests pass before creating a commit, assume pre-commit hooks will run, and do not bypass them with `--no-verify`.
