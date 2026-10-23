#!/usr/bin/env python3
"""Generate editor completion data from an LLVM build.

Data sources:
  * LLLexer.cpp:  keywords, type keywords, instruction keywords
  * Attributes.inc (TableGen): attribute spellings
  * IntrinsicEnums.inc / IntrinsicImpl.inc (TableGen): generic intrinsic names
    and their overloaded state
  * TargetLibraryInfo.inc (TableGen): libcall spellings
  * llubi's Library.cpp: which libcalls the interpreter actually implements

The output is fetched by the web app at runtime, so the editor follows the
LLVM revision used for the wasm build instead of maintaining hand-written
lists.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"[completions] error: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        fail(f"cannot read {path}: {error}")


def section(text: str, begin: str, end: str) -> str:
    if begin not in text:
        fail(f"missing marker {begin!r}")
    after = text.split(begin, 1)[1]
    if end not in after:
        fail(f"missing marker {end!r}")
    return after.split(end, 1)[0]


def parse_llparser(path: Path) -> tuple[list[str], list[str], list[str]]:
    text = read_text(path)
    keywords: set[str] = set()
    instructions: set[str] = set()
    types: set[str] = set()

    continuation = False
    for line in text.splitlines():
        if continuation:
            continuation = line.rstrip().endswith("\\")
            continue
        if line.lstrip().startswith("#"):
            continuation = line.rstrip().endswith("\\")
            continue
        for match in re.finditer(r"\bINSTKEYWORD\(\s*([A-Za-z0-9_]+)\s*,", line):
            instructions.add(match.group(1))
        for match in re.finditer(r'\bTYPEKEYWORD\(\s*"([^"]+)"', line):
            types.add(match.group(1))
        for match in re.finditer(r"\bKEYWORD\(\s*([A-Za-z0-9_]+)\s*\)", line):
            keywords.add(match.group(1))

    keywords -= instructions
    keywords -= types
    return sorted(keywords), sorted(instructions), sorted(types)


def parse_attributes(path: Path) -> list[str]:
    text = read_text(path)
    text = text.split("#ifdef GET_ATTR_NAMES", 1)[1].split("#ifdef GET_ATTR_ENUM", 1)[0]
    names = re.findall(
        r"^\s*ATTRIBUTE_ENUM\([^,]+,\s*([A-Za-z0-9_]+)\)", text, re.M
    )
    return sorted(set(names))


def parse_intrinsics(enums_path: Path, impl_path: Path) -> list[dict[str, object]]:
    enum_text = section(
        read_text(enums_path),
        "#ifdef GET_INTRINSIC_ENUM_VALUES",
        "#endif // GET_INTRINSIC_ENUM_VALUES",
    )
    entries: list[tuple[int, str]] = []
    next_id = 1
    for line in enum_text.splitlines():
        match = re.match(
            r"\s*([A-Za-z0-9_]+)(?:\s*=\s*(\d+))?,\s*//\s*(llvm\.[\w.]+)",
            line,
        )
        if not match:
            continue
        value = int(match.group(2)) if match.group(2) else next_id
        next_id = value + 1
        entries.append((value, match.group(3)))

    overload_text = section(
        read_text(impl_path),
        "#ifdef GET_INTRINSIC_OVERLOAD_TABLE",
        "#endif // GET_INTRINSIC_OVERLOAD_TABLE",
    )
    overload_text = section(overload_text, "OTable[] = {", "};")
    fields = [field.strip() for field in overload_text.split(",") if field.strip()]
    overloaded: set[int] = set()
    for byte_index, field in enumerate(fields):
        for bit in re.findall(r"1\s*<<\s*(\d+)", field):
            overloaded.add(byte_index * 8 + int(bit))

    return [
        {"name": base_name, "overloaded": value in overloaded}
        for value, base_name in entries
    ]


def parse_libcalls(tli_path: Path, library_path: Path) -> list[str]:
    tli_text = read_text(tli_path)
    enum_block = section(
        tli_text,
        "#ifdef GET_TARGET_LIBRARY_INFO_ENUM",
        "#endif // GET_TARGET_LIBRARY_INFO_ENUM",
    )
    enum_names = re.findall(r"^\s*(LibFunc_[A-Za-z0-9_]+),", enum_block, re.M)

    offsets_marker = re.search(r"StandardNamesOffsets\[\d+\] = \{", tli_text)
    if not offsets_marker:
        fail("missing TargetLibraryInfo offsets table")
    offsets_block = section(tli_text, offsets_marker.group(0), "};")
    spellings = re.findall(r"//\s*(\S+)\s*$", offsets_block, re.M)
    if len(enum_names) != len(spellings):
        fail(
            "TargetLibraryInfo enum/spelling tables disagree "
            f"({len(enum_names)} vs {len(spellings)})"
        )
    by_enum = dict(zip(enum_names, spellings))

    library_text = read_text(library_path)
    switch = section(library_text, "switch (LF)", "default:")
    supported = set(re.findall(r"case\s+LibFunc_([A-Za-z0-9_]+)\s*:", switch))

    names = []
    for name in supported:
        spelling = by_enum.get(f"LibFunc_{name}")
        if spelling:
            names.append(spelling)
    return sorted(set(names))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llvm-source", required=True, help="llvm-project checkout")
    parser.add_argument("--build-dir", required=True, help="wasm build directory")
    parser.add_argument("--output", required=True, help="output JSON path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    llvm_source = Path(args.llvm_source).expanduser().resolve()
    build_dir = Path(args.build_dir).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()

    llvm_lib = llvm_source / "llvm"
    generated = build_dir / "include" / "llvm"

    keywords, instructions, types = parse_llparser(
        llvm_lib / "lib" / "AsmParser" / "LLLexer.cpp"
    )
    attributes = parse_attributes(generated / "IR" / "Attributes.inc")
    intrinsics = parse_intrinsics(
        generated / "IR" / "IntrinsicEnums.inc",
        generated / "IR" / "IntrinsicImpl.inc",
    )
    libcalls = parse_libcalls(
        generated / "Analysis" / "TargetLibraryInfo.inc",
        llvm_lib / "tools" / "llubi" / "lib" / "Library.cpp",
    )

    data = {
        "keywords": keywords,
        "instructions": instructions,
        "types": types,
        "attributes": attributes,
        "intrinsics": intrinsics,
        "libcalls": libcalls,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(data, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )
    print(
        f"[completions] keywords={len(keywords)} instructions={len(instructions)} "
        f"types={len(types)} attributes={len(attributes)} "
        f"intrinsics={len(intrinsics)} libcalls={len(libcalls)} -> {output}",
        flush=True,
    )


if __name__ == "__main__":
    main()
