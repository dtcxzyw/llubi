import type {
  RunResult,
  WorkerRequest,
  WorkerResponse,
} from './protocol';
import { toWireOptions } from './protocol';

interface EmModule {
  cwrap(
    name: string,
    returnType: string,
    argTypes: string[],
  ): (...args: string[]) => string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

let modulePromise: Promise<EmModule> | null = null;
let runFunction: ((ir: string, options: string) => string) | null = null;
let lastErrorFunction: (() => string) | null = null;

async function getRunFunction(): Promise<(ir: string, options: string) => string> {
  if (runFunction) return runFunction;
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasmBase = new URL(
        `${import.meta.env.BASE_URL}wasm/`,
        scope.location.href,
      );
      const moduleUrl = new URL('llubi.js', wasmBase).href;
      const imported = (await import(/* @vite-ignore */ moduleUrl)) as {
        default: (options: Record<string, unknown>) => Promise<EmModule>;
      };
      return imported.default({
        locateFile: (path: string) => new URL(path, wasmBase).href,
        noExitRuntime: true,
      });
    })();
  }
  const module = await modulePromise;
  runFunction = module.cwrap('llubi_run', 'string', ['string', 'string']);
  lastErrorFunction = module.cwrap('llubi_last_error', 'string', []);
  return runFunction;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, ir, options } = event.data;
  try {
    const run = await getRunFunction();
    const text = run(ir, JSON.stringify(toWireOptions(options)));
    const result = JSON.parse(text) as RunResult;
    const response: WorkerResponse = { id, result };
    scope.postMessage(response);
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    try {
      const fatal = lastErrorFunction?.();
      if (fatal) message += `\nLLVM fatal error: ${fatal}`;
    } catch {
      // The wasm runtime may be unusable after a trap; keep the abort message.
    }
    const response: WorkerResponse = { id, error: message };
    scope.postMessage(response);
  }
};
