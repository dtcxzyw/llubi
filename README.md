# llubi playground

[![CI](https://github.com/dtcxzyw/llubi/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/dtcxzyw/llubi/actions/workflows/pages.yml)

An online playground for **llubi**, LLVM's UB-aware IR interpreter. The
interpreter is compiled to WebAssembly with Emscripten, so LLVM IR can be
executed entirely in the browser without a backend.

**Visit:** https://dtcxzyw.github.io/llubi/

Learn more about llubi in the LLVM command guide:
https://llvm.org/docs/CommandGuide/llubi.html

## License

The playground source is licensed under the [Apache License, Version 2.0](LICENSE).

The deployed playground also redistributes WebAssembly compiled from LLVM and
llubi (Apache-2.0 WITH LLVM-exception), generated completion/example/LangRef
catalogs derived from LLVM sources, tests, and documentation, plus
Emscripten-generated runtime code (MIT/NCSA), musl libc (MIT), and MIT-licensed
frontend dependencies. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the [LICENSES](LICENSES)
directory for the full notices and license texts.

LLVM is a trademark of the LLVM Foundation; this project is not affiliated with
or endorsed by the LLVM Project or the LLVM Foundation.
