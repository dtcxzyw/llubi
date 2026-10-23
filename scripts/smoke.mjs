#!/usr/bin/env node
// Headless smoke test for the wasm entry point. Run after scripts/build.py:
//   node scripts/smoke.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const wasmDir = path.join(root, 'web', 'public', 'wasm');
const modulePath = path.join(wasmDir, 'llubi.js');

if (!fs.existsSync(modulePath)) {
  console.error(
    `missing ${modulePath}; run 'python3 scripts/build.py --llvm-source <llvm-project>' first`,
  );
  process.exit(1);
}

const { default: createLlubi } = await import(pathToFileURL(modulePath).href);
const module = await createLlubi({
  locateFile: (file) => path.join(wasmDir, file),
  noExitRuntime: true,
});
const run = module.cwrap('llubi_run', 'string', ['string', 'string']);
const info = JSON.parse(module.cwrap('llubi_info', 'string', [])());

assert.equal(info.protocolVersion, 1);
assert.match(info.llvmVersion, /^\d+\.\d+\.\d+/);

const hello = `@.str = private unnamed_addr constant [18 x i8] c"Hello from llubi\\0A\\00"
declare i32 @printf(ptr, ...)
define i32 @main() {
  %r = call i32 (ptr, ...) @printf(ptr @.str)
  ret i32 0
}
`;
const helloResult = JSON.parse(run(hello, JSON.stringify({})));
assert.equal(helloResult.ok, true);
assert.equal(helloResult.exit.kind, 'returned');
assert.equal(helloResult.exit.code, 0);
assert.match(helloResult.stdout, /Hello from llubi/);
assert.deepEqual(helloResult.diagnostics, []);

const parseError = `define i32 @main() {
  ret i32
}
`;
const parseResult = JSON.parse(run(parseError, JSON.stringify({})));
assert.equal(parseResult.ok, false);
assert.equal(parseResult.diagnostics[0].phase, 'parse');
assert.ok(parseResult.diagnostics[0].line > 0);

const ub = `; first line
; second line
declare ptr @malloc(i64)
declare void @free(ptr)

define i32 @main() {
  %p = call ptr @malloc(i64 4)
  %p_oob = getelementptr i8, ptr %p, i64 8
  call void @free(ptr %p_oob)

  ret i32 0
}
`;
const ubLine = ub.split('\n').findIndex((line) => line.includes('call void @free')) + 1;
const ubResult = JSON.parse(run(ub, JSON.stringify({})));
assert.equal(ubResult.ok, false);
assert.equal(ubResult.exit.kind, 'failed');
const runtime = ubResult.diagnostics.find((diag) => diag.phase === 'runtime');
assert.ok(runtime, `missing runtime diagnostic: ${JSON.stringify(ubResult.diagnostics)}`);
assert.equal(runtime.line, ubLine);
assert.equal(runtime.frames[0].line, ubLine);
assert.match(runtime.message, /freeing a pointer/);
assert.match(ubResult.stderr, /Stacktrace:/);

const verboseResult = JSON.parse(run(hello, JSON.stringify({ verbose: true })));
assert.ok(
  verboseResult.trace.some((entry) => /Entering function: main/.test(entry.text)),
);
assert.ok(
  verboseResult.trace.some((entry) => /Exiting function: main/.test(entry.text)),
);
assert.ok(verboseResult.trace.some((entry) => entry.line > 0));

const branch = `define i32 @main() {
entry:
  br label %done
done:
  ret i32 0
}
`;
const branchResult = JSON.parse(run(branch, JSON.stringify({})));
const branchEntry = branchResult.trace.find((entry) => entry.kind === 'branch');
assert.ok(branchEntry, 'missing branch trace entry');
assert.equal(branchEntry.targetLine, 4);
assert.equal(branchEntry.targetName, 'done');
const functionEntry = branchResult.trace.find(
  (entry) => entry.kind === 'function' && entry.text.includes('Entering'),
);
assert.ok(functionEntry && functionEntry.line === 1);

const limitResult = JSON.parse(
  run(hello, JSON.stringify({ maxSteps: 1 })),
);
assert.equal(limitResult.ok, false);
assert.ok(
  limitResult.diagnostics.some((diag) => /maximum number of execution steps/.test(diag.message)),
);

const buildInfoPath = path.join(root, 'web', 'public', 'build-info.json');
if (fs.existsSync(buildInfoPath)) {
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  assert.match(buildInfo.llvmVersion, /^\d+\.\d+\.\d+/);
  assert.ok(buildInfo.buildTime);
}

console.log('smoke: ok');
console.log(`  LLVM ${info.llvmVersion}`);
console.log(`  hello exit ${helloResult.exit.kind} ${helloResult.exit.code}`);
console.log(`  UB line ${runtime.line}`);
console.log(`  max-steps diagnostic: ${limitResult.diagnostics[0].message}`);

