export type UndefBehavior = 'nondet' | 'zero';
export type NaNBehavior =
  | 'nondet'
  | 'preferred'
  | 'quieting'
  | 'unchanged'
  | 'target-specific';

export interface RunOptions {
  entryFunction: string;
  fakeArgv0: string;
  argv: string[];
  maxMemMiB: number;
  maxSteps: number;
  maxStackDepth: number;
  vscale: number;
  seed: number;
  deterministic: boolean;
  fuseFMulAdd: boolean;
  disableVerify: boolean;
  verbose: boolean;
  undefBehavior: UndefBehavior;
  nanBehavior: NaNBehavior;
}

export const DEFAULT_OPTIONS: RunOptions = {
  entryFunction: 'main',
  fakeArgv0: '',
  argv: [],
  maxMemMiB: 64,
  maxSteps: 10_000_000,
  maxStackDepth: 256,
  vscale: 4,
  seed: 0,
  deterministic: false,
  fuseFMulAdd: true,
  disableVerify: false,
  verbose: true,
  undefBehavior: 'nondet',
  nanBehavior: 'nondet',
};

export function toWireOptions(options: RunOptions): Record<string, unknown> {
  return {
    entryFunction: options.entryFunction,
    fakeArgv0: options.fakeArgv0,
    argv: options.argv,
    maxMem: Math.max(1, Math.trunc(options.maxMemMiB)) * 1024 * 1024,
    maxSteps: Math.max(0, Math.trunc(options.maxSteps)),
    maxStackDepth: Math.max(0, Math.trunc(options.maxStackDepth)),
    vscale: Math.max(1, Math.trunc(options.vscale)),
    seed: Math.max(0, Math.trunc(options.seed)),
    deterministic: options.deterministic,
    fuseFMulAdd: options.fuseFMulAdd,
    disableVerify: options.disableVerify,
    verbose: options.verbose,
    undefBehavior: options.undefBehavior,
    nanBehavior: options.nanBehavior,
  };
}

export interface StackFrame {
  function: string;
  instruction: string;
  line?: number;
  column?: number;
}

export interface Diagnostic {
  phase: string;
  severity: 'error' | 'warning' | string;
  message: string;
  line?: number;
  column?: number;
  detail?: string;
  frames?: StackFrame[];
}

export interface RunResult {
  ok: boolean;
  exit: {
    kind: 'returned' | 'failed' | 'exited' | 'aborted' | 'terminated' | string;
    code: number;
  };
  stdout: string;
  stderr: string;
  trace: string;
  diagnostics: Diagnostic[];
  truncated: boolean;
  durationMs: number;
}

export interface IntrinsicSuggestion {
  name: string;
  overloaded: boolean;
}

export interface CompletionCatalog {
  keywords: string[];
  instructions: string[];
  types: string[];
  attributes: string[];
  intrinsics: IntrinsicSuggestion[];
  libcalls: string[];
}

export interface BuildInfo {
  llvmVersion: string;
  llvmCommit: string;
  llvmCommitShort: string;
  llvmCommitDate: string;
  buildTime: string;
  emscriptenVersion: string;
  wasmBytes: number;
}

export interface WorkerRequest {
  id: number;
  ir: string;
  options: RunOptions;
}

export interface WorkerResponse {
  id: number;
  result?: RunResult;
  error?: string;
}
