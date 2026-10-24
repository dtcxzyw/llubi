# Third-Party Notices

This repository contains the playground frontend and build tooling. The deployed
playground also redistributes the components below.

## LLVM Project and llubi

The WebAssembly interpreter is compiled from the LLVM Project, including
`llvm/tools/llubi`, the LLVM libraries it links, and the LLVM runtime libraries
provided by Emscripten (such as compiler-rt, libc++, libc++abi, and libunwind).
The completion, example, and LangRef catalogs shipped by the playground are
generated from LLVM source files, tests, and documentation.

- Upstream: https://llvm.org/
- llubi command guide: https://llvm.org/docs/CommandGuide/llubi.html
- License: Apache License 2.0 with LLVM Exceptions
- Full license text: included in the generated licenses modal and copied to
  `web/public/licenses/LLVM.txt` at build time
- Copyright: LLVM Project contributors

The build compiles this code to WebAssembly and extracts the generated catalogs;
it does not otherwise modify the LLVM sources. The LLVM source tree is not
vendored in this repository and is supplied at build time.

The LLVM Exceptions permit redistributing LLVM code embedded in object form
without some Apache 2.0 conditions. The full LLVM license text is included here
for the compiled wasm, the generated data derived from LLVM, and attribution.
LLVM's license file also explains how third-party files inside the LLVM source
tree identify their own notices; those per-file terms remain applicable.

## Emscripten

The WebAssembly build and generated JavaScript loader use Emscripten.

- Upstream: https://emscripten.org/
- License: MIT or University of Illinois/NCSA Open Source License
- Full license text: included in the generated licenses modal and copied to
  `web/public/licenses/Emscripten.txt` at build time
- Copyright: Emscripten authors

## musl libc

The WebAssembly runtime includes libc code derived from musl.

- Upstream: https://musl.libc.org/
- License: MIT
- Full license text: included in the generated licenses modal and copied to
  `web/public/licenses/musl.txt` at build time
- Copyright: Rich Felker and musl contributors

## dlmalloc

Emscripten's default allocator includes dlmalloc by Doug Lea, released to the
public domain under CC0. No attribution is required; it is acknowledged here for
completeness.

## Frontend dependencies

The browser bundle includes the MIT-licensed CodeMirror and Lezer packages and
their transitive dependencies. At build time, `license-checker-rseidelsohn`
enumerates the installed production packages and their license texts; the
result is included in the generated licenses modal.

## Trademarks

LLVM is a trademark of the LLVM Foundation. This project is an independent
playground and is not affiliated with or endorsed by the LLVM Project or the
LLVM Foundation.
