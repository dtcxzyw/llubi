# llubi playground

An online playground for **llubi**, LLVM's UB-aware IR interpreter. The
interpreter is compiled to WebAssembly with Emscripten, so LLVM IR can be
executed entirely in the browser without a backend.

The page shows the LLVM version, LLVM commit, and build time, exposes llubi's
interpreter options, highlights diagnostics on the corresponding IR lines, and
auto-runs after edits. The verbose instruction trace is always enabled.

## Local development

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

## Web app

- Vite + TypeScript, CodeMirror 6 for the IR editor and diagnostics.
- Completion data is generated at build time from LLParser tokens (`LLLexer.cpp`)
  and TableGen outputs (`Attributes.inc`, `IntrinsicEnums.inc`,
  `IntrinsicImpl.inc`, `TargetLibraryInfo.inc`), plus `.def` metadata names and
  llubi's supported libcall switch. No instruction, intrinsic, or libcall list
  is maintained by hand.
- Auto/Manual mode switch: Auto hides the Run button and reruns after edits;
  Manual exposes an explicit Run action. Ctrl/Cmd+Enter always runs.
- Execution happens in a Web Worker; a new edit supersedes an in-flight run,
  and long runs are killed after 10 seconds.
- Verbose trace rows jump to their instruction, call site, function, or label in
  the editor; clicking a source line or line number jumps back to the matching
  trace row.
- The output pane separates program output from interpreter diagnostics and
  trace with a draggable horizontal divider that starts at 25% / 75%.
- The toolbar shows the equivalent `; RUN:` line for the last run and can copy
  it. The output header can copy generated FileCheck lines; stdout and stderr
  are combined in execution order like `update_llubi_test_checks.py`, and
  failing runs get a `not ` prefix.
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
