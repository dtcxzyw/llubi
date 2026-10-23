#!/usr/bin/env python3
"""Build the llubi WebAssembly module and stage the web assets."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_PUBLIC = ROOT / "web" / "public"


def log(message: str) -> None:
    print(f"[build] {message}", flush=True)


def die(message: str) -> None:
    print(f"[build] error: {message}", file=sys.stderr)
    raise SystemExit(1)


def run(
    command: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> None:
    log("+ " + " ".join(shlex.quote(part) for part in command))
    subprocess.run(command, cwd=cwd, env=env, check=True)


def load_tool_env() -> None:
    tools_dir = Path(
        os.environ.get(
            "LLUBI_TOOLS_DIR",
            Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
            / "llubi-web",
        )
    )
    env_file = tools_dir / "env.sh"
    if not env_file.exists():
        return
    if shutil.which("emcc") and shutil.which("npm"):
        return

    log(f"loading tool environment from {env_file}")
    script = f"set -a; source {shlex.quote(str(env_file))} >/dev/null 2>&1; env -0"
    output = subprocess.check_output(["bash", "-c", script])
    for entry in output.split(b"\0"):
        if not entry or b"=" not in entry:
            continue
        key, value = entry.split(b"=", 1)
        os.environ[key.decode()] = value.decode(errors="surrogateescape")


def require(command: str, hint: str = "") -> str:
    path = shutil.which(command)
    if path:
        return path
    message = f"required command '{command}' not found"
    if hint:
        message += f"; {hint}"
    die(message)


def resolve_llvm_source(value: str | None) -> Path:
    source = value or os.environ.get("LLVM_SOURCE_DIR")
    if not source:
        die("pass --llvm-source or set LLVM_SOURCE_DIR")
    path = Path(source).expanduser().resolve()
    if not (path / "llvm" / "CMakeLists.txt").is_file():
        die(f"{path} does not look like an llvm-project checkout")
    if not (path / "llvm" / "tools" / "llubi" / "lib").is_dir():
        die(f"{path} does not contain llvm/tools/llubi")
    return path


def git_value(source: Path, *args: str) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(source), *args],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def ccache_args(enabled: bool) -> list[str]:
    if not enabled:
        return []
    return ["-DLLVM_CCACHE_BUILD=ON"]


def build_native_tblgen(
    llvm_source: Path,
    build_dir: Path,
    jobs: int,
    use_ccache: bool,
) -> Path:
    tblgen = build_dir / "bin" / "llvm-tblgen"
    stamp = build_dir / "llvm-revision"
    revision = git_value(llvm_source, "rev-parse", "HEAD")
    if (
        tblgen.is_file()
        and stamp.is_file()
        and stamp.read_text().strip() == revision
    ):
        return build_dir / "bin"

    log("building native llvm-tblgen")
    build_dir.mkdir(parents=True, exist_ok=True)
    configure = [
        "cmake",
        "-G",
        "Ninja",
        "-S",
        str(llvm_source / "llvm"),
        "-B",
        str(build_dir),
        "-DCMAKE_BUILD_TYPE=Release",
        "-DLLVM_TARGETS_TO_BUILD=",
        "-DLLVM_ENABLE_PROJECTS=",
        "-DLLVM_INCLUDE_TESTS=OFF",
        "-DLLVM_INCLUDE_EXAMPLES=OFF",
        "-DLLVM_INCLUDE_BENCHMARKS=OFF",
        "-DLLVM_INCLUDE_RUNTIMES=OFF",
        "-DLLVM_BUILD_TOOLS=ON",
        "-DLLVM_ENABLE_ZLIB=OFF",
        "-DLLVM_ENABLE_ZSTD=OFF",
        "-DLLVM_ENABLE_LIBXML2=OFF",
        "-DLLVM_ENABLE_LZMA=OFF",
        "-DLLVM_ENABLE_TERMINFO=OFF",
        "-DLLVM_ENABLE_CURL=OFF",
        "-DLLVM_ENABLE_HTTPLIB=OFF",
        "-DLLVM_ENABLE_THREADS=OFF",
        "-DLLVM_ENABLE_BINDINGS=OFF",
        "-DLLVM_BUILD_LLVM_DYLIB=OFF",
        "-DLLVM_LINK_LLVM_DYLIB=OFF",
        "-DLLVM_APPEND_VC_REV=OFF",
        "-DLLVM_PARALLEL_LINK_JOBS=1",
        *ccache_args(use_ccache),
    ]
    run(configure)
    run(
        [
            "cmake",
            "--build",
            str(build_dir),
            "--target",
            "llvm-tblgen",
            "--parallel",
            str(jobs),
        ]
    )
    if not tblgen.is_file():
        die("native llvm-tblgen was not produced")
    stamp.write_text(revision + "\n")
    return build_dir / "bin"


def wasm_configure(
    llvm_source: Path,
    build_dir: Path,
    native_tool_dir: Path,
    jobs: int,
    debug: bool,
    use_ccache: bool,
) -> None:
    build_type = "Debug" if debug else "Release"
    assertions = "ON" if debug else "OFF"
    configure = [
        "emcmake",
        "cmake",
        "-G",
        "Ninja",
        "-S",
        str(llvm_source / "llvm"),
        "-B",
        str(build_dir),
        f"-DCMAKE_BUILD_TYPE={build_type}",
        "-DLLVM_TARGETS_TO_BUILD=",
        "-DLLVM_ENABLE_PROJECTS=",
        "-DLLVM_INCLUDE_TOOLS=ON",
        "-DLLVM_BUILD_TOOLS=OFF",
        "-DLLVM_TOOL_LLUBI_BUILD=ON",
        "-DLLVM_INCLUDE_UTILS=ON",
        "-DLLVM_BUILD_UTILS=OFF",
        "-DLLVM_INCLUDE_TESTS=OFF",
        "-DLLVM_INCLUDE_EXAMPLES=OFF",
        "-DLLVM_INCLUDE_BENCHMARKS=OFF",
        "-DLLVM_INCLUDE_RUNTIMES=OFF",
        "-DLLVM_BUILD_RUNTIMES=OFF",
        "-DLLVM_ENABLE_THREADS=OFF",
        "-DLLVM_ENABLE_EH=OFF",
        "-DLLVM_ENABLE_RTTI=OFF",
        f"-DLLVM_ENABLE_ASSERTIONS={assertions}",
        "-DLLVM_ENABLE_ZLIB=OFF",
        "-DLLVM_ENABLE_ZSTD=OFF",
        "-DLLVM_ENABLE_LIBXML2=OFF",
        "-DLLVM_ENABLE_LZMA=OFF",
        "-DLLVM_ENABLE_TERMINFO=OFF",
        "-DLLVM_ENABLE_LIBEDIT=OFF",
        "-DLLVM_ENABLE_CURL=OFF",
        "-DLLVM_ENABLE_HTTPLIB=OFF",
        "-DLLVM_ENABLE_Z3_SOLVER=OFF",
        "-DLLVM_ENABLE_FFI=OFF",
        "-DLLVM_ENABLE_BINDINGS=OFF",
        "-DLLVM_ENABLE_CRASH_OVERRIDES=OFF",
        "-DLLVM_ENABLE_UNWIND_TABLES=OFF",
        "-DLLVM_ENABLE_PLUGINS=OFF",
        "-DLLVM_ENABLE_MODULES=OFF",
        "-DLLVM_BUILD_LLVM_DYLIB=OFF",
        "-DLLVM_LINK_LLVM_DYLIB=OFF",
        "-DBUILD_SHARED_LIBS=OFF",
        "-DLLVM_APPEND_VC_REV=OFF",
        "-DLLVM_PARALLEL_LINK_JOBS=1",
        f"-DLLVM_PARALLEL_COMPILE_JOBS={jobs}",
        "-DLLVM_DEFAULT_TARGET_TRIPLE=x86_64-unknown-linux-gnu",
        f"-DLLVM_EXTERNAL_PROJECTS=llubi_web",
        f"-DLLVM_EXTERNAL_LLUBI_WEB_SOURCE_DIR={ROOT / 'wasm'}",
        f"-DLLVM_NATIVE_TOOL_DIR={native_tool_dir}",
        *ccache_args(use_ccache),
    ]
    run(configure)


def read_llvm_version(build_dir: Path) -> str:
    config = build_dir / "include" / "llvm" / "Config" / "llvm-config.h"
    try:
        text = config.read_text()
    except OSError:
        return "unknown"
    match = re.search(r'^#define LLVM_VERSION_STRING "([^"]+)"', text, re.M)
    return match.group(1) if match else "unknown"


def emscripten_version() -> str:
    try:
        output = subprocess.check_output(
            ["emcc", "--version"], text=True, stderr=subprocess.STDOUT
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return output.splitlines()[0].strip() if output else "unknown"


def write_build_info(llvm_source: Path, build_dir: Path) -> None:
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    wasm = WEB_PUBLIC / "wasm" / "llubi.wasm"
    info = {
        "llvmVersion": read_llvm_version(build_dir),
        "llvmCommit": git_value(llvm_source, "rev-parse", "HEAD"),
        "llvmCommitShort": git_value(llvm_source, "rev-parse", "--short=12", "HEAD"),
        "llvmCommitDate": git_value(llvm_source, "show", "-s", "--format=%cI", "HEAD"),
        "buildTime": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "emscriptenVersion": emscripten_version(),
        "wasmBytes": wasm.stat().st_size if wasm.is_file() else 0,
    }
    (WEB_PUBLIC / "build-info.json").write_text(
        json.dumps(info, indent=2) + "\n", encoding="utf-8"
    )
    log(f"wrote {WEB_PUBLIC / 'build-info.json'}")


def stage_artifacts(build_dir: Path) -> None:
    source = build_dir / "dist" / "wasm"
    destination = WEB_PUBLIC / "wasm"
    if not (source / "llubi.js").is_file():
        die(f"missing wasm output under {source}")
    destination.mkdir(parents=True, exist_ok=True)
    for name in ("llubi.js", "llubi.wasm", "llubi.wasm.map"):
        path = source / name
        if path.is_file():
            shutil.copy2(path, destination / name)
    log(f"staged wasm artifacts in {destination}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llvm-source", help="llvm-project checkout")
    parser.add_argument(
        "--build-dir", default=str(ROOT / "build" / "wasm"), help="wasm build dir"
    )
    parser.add_argument(
        "--native-build-dir",
        default=str(ROOT / "build" / "native"),
        help="native llvm-tblgen build dir",
    )
    parser.add_argument(
        "--native-tool-dir",
        help="directory containing a matching native llvm-tblgen",
    )
    parser.add_argument("--jobs", type=int, default=int(os.environ.get("LLUBI_JOBS", os.cpu_count() or 4)))
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--clean", action="store_true")
    parser.add_argument("--no-ccache", action="store_true")
    parser.add_argument("--no-copy", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_tool_env()
    llvm_source = resolve_llvm_source(args.llvm_source)
    require("cmake", "install CMake 3.20 or newer")
    require("ninja")
    require("git")
    require(
        "emcc",
        "run scripts/setup.sh, source the generated env.sh, or put emsdk on PATH",
    )

    jobs = max(1, args.jobs)
    use_ccache = not args.no_ccache and shutil.which("ccache") is not None
    build_dir = Path(args.build_dir).expanduser().resolve()
    native_build_dir = Path(args.native_build_dir).expanduser().resolve()

    if args.clean:
        log(f"removing {build_dir}")
        shutil.rmtree(build_dir, ignore_errors=True)
        if not args.native_tool_dir:
            log(f"removing {native_build_dir}")
            shutil.rmtree(native_build_dir, ignore_errors=True)

    native_tool_arg = args.native_tool_dir or os.environ.get("LLVM_NATIVE_TOOL_DIR")
    if native_tool_arg:
        native_tool_dir = Path(native_tool_arg).expanduser().resolve()
    else:
        native_tool_dir = build_native_tblgen(
            llvm_source, native_build_dir, jobs, use_ccache
        )
    if not (native_tool_dir / "llvm-tblgen").is_file():
        die(f"no llvm-tblgen found in {native_tool_dir}")

    wasm_configure(
        llvm_source, build_dir, native_tool_dir, jobs, args.debug, use_ccache
    )
    run(
        [
            "cmake",
            "--build",
            str(build_dir),
            "--target",
            "llubi_web",
            "--parallel",
            str(jobs),
        ]
    )

    if args.no_copy:
        write_build_info(llvm_source, build_dir)
        return
    stage_artifacts(build_dir)
    write_build_info(llvm_source, build_dir)


if __name__ == "__main__":
    main()
