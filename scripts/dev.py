#!/usr/bin/env python3
"""Build llubi for wasm and start the Vite development server."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
WEB = ROOT / "web"


def log(message: str) -> None:
    print(f"[dev] {message}", flush=True)


def die(message: str) -> None:
    print(f"[dev] error: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_build_module():
    sys.path.insert(0, str(SCRIPTS))
    import build  # type: ignore[import-not-found]

    return build


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llvm-source", help="llvm-project checkout")
    parser.add_argument("--native-tool-dir", help="directory with native llvm-tblgen")
    parser.add_argument("--jobs", type=int, help="parallel build jobs")
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--rebuild", action="store_true", help="delete build dirs first")
    parser.add_argument("--no-build", action="store_true", help="serve existing artifacts")
    parser.add_argument(
        "--setup", action="store_true", help="install Node.js and emsdk if missing"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    build = load_build_module()
    build.load_tool_env()

    if args.setup:
        log("running scripts/setup.sh")
        subprocess.run(["bash", str(SCRIPTS / "setup.sh")], check=True)
        build.load_tool_env()

    if not args.no_build:
        if not shutil.which("emcc"):
            die(
                "emcc is not available. Run 'bash scripts/setup.sh' (or pass "
                "--setup), then source the printed env.sh."
            )
        command = [sys.executable, str(SCRIPTS / "build.py")]
        if args.llvm_source:
            command += ["--llvm-source", args.llvm_source]
        if args.native_tool_dir:
            command += ["--native-tool-dir", args.native_tool_dir]
        if args.jobs:
            command += ["--jobs", str(args.jobs)]
        if args.rebuild:
            command.append("--clean")
        log("building wasm module")
        subprocess.run(command, check=True)
    elif not (WEB / "public" / "wasm" / "llubi.wasm").is_file():
        die("no wasm artifacts found; run without --no-build first")

    npm = shutil.which("npm")
    if not npm:
        die("npm is not available; run 'bash scripts/setup.sh' first")

    if not (WEB / "node_modules").is_dir():
        lock = WEB / "package-lock.json"
        command = [npm, "ci"] if lock.is_file() else [npm, "install"]
        log("installing web dependencies")
        subprocess.run(command, cwd=WEB, check=True)

    log(f"starting Vite on http://{args.host}:{args.port}/")
    subprocess.run(
        [npm, "run", "dev", "--", "--host", args.host, "--port", str(args.port)],
        cwd=WEB,
        check=True,
        env=os.environ.copy(),
    )


if __name__ == "__main__":
    main()
