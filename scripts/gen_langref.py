#!/usr/bin/env python3
"""Generate LangRef links from the LLVM documentation source.

The index is derived from LangRef.md itself so anchors follow the LLVM
revision used for the wasm build. It indexes instruction, intrinsic, keyword,
and metadata names only when LangRef documents them.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

LANGREF_URL = "https://llvm.org/docs/LangRef.html"

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
ANCHOR_RE = re.compile(r"^\(([^)]+)\)=\s*$")
CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
DEFINITION_RE = re.compile(r"^(?:`([^`]+)`|\"`([^`]+)`\"|\"([^\"]+)\")")
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]*$")

SYNTAX_KEYWORD_NOISE = {
    "all",
    "caller",
    "false",
    "from",
    "max",
    "min",
    "none",
    "null",
    "one",
    "poison",
    "to",
    "true",
    "undef",
    "vscale",
    "within",
    "x",
    "zero",
    "zeroinitializer",
}

STRUCTURAL_KEYWORDS = {
    "alias": "langref_aliases",
    "asm": "moduleasm",
    "atomic": "ordering",
    "attributes": "attrgrp",
    "comdat": "langref_comdats",
    "constant": "globalvars",
    "datalayout": "langref_datalayout",
    "declare": "functionstructure",
    "define": "functionstructure",
    "elementwise": "elementwise-atomics",
    "gc": "gc",
    "global": "globalvars",
    "ifunc": "langref_ifunc",
    "module": "moduleasm",
    "musttail": "i_call",
    "notail": "i_call",
    "personality": "personalityfn",
    "prefix": "prefixdata",
    "prologue": "prologuedata",
    "source_filename": "source_filename",
    "syncscope": "syncscope",
    "tail": "i_call",
    "thread_local": "tls_model",
    "target": "langref_triple",
    "triple": "langref_triple",
    "undef": "undefvalues",
    "unnamed_addr": "globalvars",
    "uselistorder": "uselistorder",
    "volatile": "volatile",
}


def fail(message: str) -> None:
    print(f"[langref] error: {message}", file=sys.stderr)
    raise SystemExit(1)


def slug(text: str) -> str:
    value = text.replace("`", "").replace("'", "").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "section"


def heading_title(text: str) -> str:
    return text.replace("`", "").strip()


def code_names(text: str) -> list[str]:
    return CODE_SPAN_RE.findall(text)


def instruction_name(title: str) -> str | None:
    if not title.endswith("Instruction"):
        return None
    names = code_names(title)
    if not names:
        return None
    name = names[0].split()[0].strip()
    return name if IDENTIFIER_RE.match(name) else None


def intrinsic_names(title: str) -> list[str]:
    if "Intrinsic" not in title:
        return []
    names: list[str] = []
    for name in code_names(title):
        name = name.strip()
        if not name.startswith("llvm."):
            continue
        if name.endswith(".*"):
            name = name[:-2]
        names.extend(expand_variants(name))
    return names


def expand_variants(name: str) -> list[str]:
    parts = name.split("/")
    if len(parts) <= 1:
        return [name]
    match = re.match(r"^(.*?)(\d+)$", parts[0])
    if not match:
        return [name]
    prefix, _ = match.groups()
    variants = [parts[0]]
    for part in parts[1:]:
        part = part.strip()
        if not part:
            continue
        if part.isdigit():
            variants.append(prefix + part)
        elif IDENTIFIER_RE.match(part):
            variants.append(part)
    return variants


def metadata_names(title: str) -> list[str]:
    if not title.endswith("Metadata"):
        return []
    return [
        name
        for name in code_names(title)
        if IDENTIFIER_RE.match(name) and not name.startswith("!")
    ]


@dataclass
class Heading:
    line: int
    level: int
    title: str
    anchor: str
    explicit: bool


@dataclass
class LangRefSource:
    lines: list[str]
    headings: list[Heading] = field(default_factory=list)
    anchors: set[str] = field(default_factory=set)

    def nearest_heading(self, line: int) -> Heading | None:
        heading = None
        for candidate in self.headings:
            if candidate.line > line:
                break
            heading = candidate
        return heading

    def explicit_ancestor(self, line: int) -> Heading | None:
        for heading in reversed(self.headings):
            if heading.line >= line:
                continue
            if heading.explicit:
                return heading
        return None

    def next_nonempty(self, start: int) -> tuple[int, str] | None:
        for index in range(start, len(self.lines)):
            text = self.lines[index].strip()
            if text:
                return index, text
        return None


def parse_headings(source: LangRefSource) -> None:
    for index, line in enumerate(source.lines):
        match = HEADING_RE.match(line)
        if not match:
            continue
        level = len(match.group(1))
        title = match.group(2).strip()
        anchor = ""
        explicit = False
        previous = index - 1
        while previous >= 0 and not source.lines[previous].strip():
            previous -= 1
        if previous >= 0:
            anchor_match = ANCHOR_RE.match(source.lines[previous].strip())
            if anchor_match:
                anchor = anchor_match.group(1)
                explicit = True
                source.anchors.add(anchor)
        if not anchor:
            anchor = slug(title)
        source.headings.append(Heading(index, level, title, anchor, explicit))

    for line in source.lines:
        match = ANCHOR_RE.match(line.strip())
        if match:
            source.anchors.add(match.group(1))


def definition_name(line: str) -> str | None:
    match = DEFINITION_RE.match(line.strip())
    if not match:
        return None
    term = next(group for group in match.groups() if group is not None).strip()
    term = term.strip('"')
    term = re.split(r"[\s(<>=]", term, maxsplit=1)[0]
    term = term.strip('"')
    return term if IDENTIFIER_RE.match(term) else None


def is_definition(source: LangRefSource, index: int) -> bool:
    following = source.next_nonempty(index + 1)
    return following is not None and following[1].startswith(":")


def add_keyword(
    keywords: dict[str, str], source: LangRefSource, name: str, anchor: str
) -> None:
    if not anchor or name in keywords:
        return
    if anchor not in source.anchors and anchor not in {
        heading.anchor for heading in source.headings
    }:
        return
    keywords[name] = anchor


def parse_keywords(source: LangRefSource) -> dict[str, str]:
    keywords: dict[str, str] = {}
    in_fence = False
    for index, line in enumerate(source.lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or not is_definition(source, index):
            continue
        name = definition_name(line)
        if not name:
            continue
        previous = index - 1
        while previous >= 0 and not source.lines[previous].strip():
            previous -= 1
        anchor = ""
        if previous >= 0:
            anchor_match = ANCHOR_RE.match(source.lines[previous].strip())
            if anchor_match:
                anchor = anchor_match.group(1)
        if not anchor:
            heading = source.explicit_ancestor(index)
            anchor = heading.anchor if heading else ""
        add_keyword(keywords, source, name, anchor)

    for name, anchor in STRUCTURAL_KEYWORDS.items():
        add_keyword(keywords, source, name, anchor)
    return keywords


def parse_instructions(source: LangRefSource) -> dict[str, str]:
    instructions: dict[str, str] = {}
    for heading in source.headings:
        name = instruction_name(heading.title)
        if name:
            instructions.setdefault(name, heading.anchor)
    return instructions


def parse_intrinsics(source: LangRefSource) -> dict[str, str]:
    intrinsics: dict[str, str] = {}
    for heading in source.headings:
        for name in intrinsic_names(heading.title):
            intrinsics.setdefault(name, heading.anchor)
    return intrinsics


def in_metadata_section(source: LangRefSource, line: int) -> bool:
    heading = source.nearest_heading(line)
    if not heading:
        return False
    for candidate in reversed(source.headings):
        if candidate.line > line:
            continue
        if candidate.level <= 2:
            return heading_title(candidate.title) == "Metadata"
    return False


def parse_metadata(source: LangRefSource) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for heading in source.headings:
        names = metadata_names(heading.title)
        if not names and in_metadata_section(source, heading.line):
            names = [
                name
                for name in code_names(heading.title)
                if IDENTIFIER_RE.match(name) and "." in name
            ]
        for name in names:
            metadata.setdefault(name, heading.anchor)

    in_fence = False
    prose_metadata: dict[str, str] = {}
    for index, line in enumerate(source.lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for match in re.finditer(r"`!([A-Za-z][A-Za-z0-9_.]*)`", line):
            name = match.group(1)
            if name in metadata:
                continue
            heading = source.explicit_ancestor(index)
            if heading:
                prose_metadata.setdefault(name, heading.anchor)
    for name, anchor in prose_metadata.items():
        metadata.setdefault(name, anchor)
    return metadata


def parse_lexer_keywords(path: Path) -> set[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        fail(f"cannot read {path}: {error}")
    return set(re.findall(r"\bKEYWORD\(([A-Za-z][A-Za-z0-9_]*)\);", text))


def parse_instruction_keywords(
    source: LangRefSource, lexer_keywords: set[str], keywords: dict[str, str]
) -> dict[str, list[str]]:
    owners: dict[str, set[str]] = {}
    in_fence = False
    block_start = 0
    syntax = False
    instruction = ""
    for index, line in enumerate(source.lines):
        if line.strip().startswith("```"):
            if not in_fence:
                block_start = index
                heading = source.nearest_heading(index)
                syntax = bool(
                    heading and heading_title(heading.title).startswith("Syntax")
                )
                instruction = ""
                if syntax:
                    for candidate in reversed(source.headings):
                        if candidate.line >= block_start:
                            continue
                        name = instruction_name(candidate.title)
                        if name:
                            instruction = name
                            break
            in_fence = not in_fence
            continue
        if not in_fence or not syntax or not instruction:
            continue
        for match in re.finditer(r"[A-Za-z_][A-Za-z0-9_.]*", line):
            word = match.group(0)
            if (
                word in lexer_keywords
                and word not in keywords
                and word not in SYNTAX_KEYWORD_NOISE
            ):
                owners.setdefault(word, set()).add(instruction)
    return {
        keyword: sorted(instructions)
        for keyword, instructions in sorted(owners.items())
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llvm-source", required=True, help="llvm-project checkout")
    parser.add_argument("--output", required=True, help="output JSON path")
    parser.add_argument(
        "--completions",
        help="completions.json used to filter to real LLVM keyword spellings",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    llvm_source = Path(args.llvm_source).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    langref = llvm_source / "llvm" / "docs" / "LangRef.md"
    try:
        lines = langref.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        fail(f"cannot read {langref}: {error}")

    source = LangRefSource(lines)
    parse_headings(source)

    instructions = parse_instructions(source)
    intrinsics = parse_intrinsics(source)
    metadata = parse_metadata(source)
    keywords = parse_keywords(source)
    for name in instructions:
        keywords.pop(name, None)
    for name in intrinsics:
        keywords.pop(name, None)
    lexer_keywords = parse_lexer_keywords(
        llvm_source / "llvm" / "lib" / "AsmParser" / "LLLexer.cpp"
    )
    allowed_keywords = set(lexer_keywords)
    if args.completions:
        try:
            completions = json.loads(
                Path(args.completions).expanduser().read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as error:
            fail(f"cannot read completions: {error}")
        allowed_keywords.update(completions.get("keywords", []))
        allowed_keywords.update(completions.get("attributes", []))
    keywords = {
        name: anchor for name, anchor in keywords.items() if name in allowed_keywords
    }
    instruction_keywords = parse_instruction_keywords(
        source, allowed_keywords, keywords
    )

    if len(instructions) < 50:
        fail(f"only found {len(instructions)} instructions in {langref}")
    if len(intrinsics) < 100:
        fail(f"only found {len(intrinsics)} intrinsics in {langref}")
    if len(metadata) < 20:
        fail(f"only found {len(metadata)} metadata entries in {langref}")
    if len(keywords) < 50:
        fail(f"only found {len(keywords)} keywords in {langref}")

    def html_anchors(entries: dict[str, str]) -> dict[str, str]:
        return {name: slug(anchor) for name, anchor in sorted(entries.items())}

    data = {
        "baseUrl": LANGREF_URL,
        "instructions": html_anchors(instructions),
        "intrinsics": html_anchors(intrinsics),
        "keywords": html_anchors(keywords),
        "metadata": html_anchors(metadata),
        "instructionKeywords": instruction_keywords,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(data, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )
    print(
        f"[langref] instructions={len(instructions)} "
        f"intrinsics={len(intrinsics)} keywords={len(keywords)} "
        f"metadata={len(metadata)} "
        f"instruction-keyword-sets={len(instruction_keywords)} -> {output}",
        flush=True,
    )


if __name__ == "__main__":
    main()
