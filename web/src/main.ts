import './styles.css';

import { createEditor, type EditorController } from './editor';
import type {
  BuildInfo,
  CompletionCatalog,
  Diagnostic,
  RunOptions,
  RunResult,
  TraceEntry,
  WorkerRequest,
  WorkerResponse,
} from './protocol';
import { DEFAULT_OPTIONS } from './protocol';
import { HELLO_IR, UB_IR } from './samples';
import { setupSplitter } from './split';

const STORAGE_IR = 'llubi.ir';
const STORAGE_OPTIONS = 'llubi.options';
const STORAGE_AUTO_RUN = 'llubi.auto-run';

const runButton = byId<HTMLButtonElement>('run');
const modeAuto = byId<HTMLButtonElement>('mode-auto');
const modeManual = byId<HTMLButtonElement>('mode-manual');
const statusElement = byId<HTMLElement>('status');
const paramsToggle = byId<HTMLButtonElement>('params-toggle');
const paramsPanel = byId<HTMLElement>('params');
const paramsReset = byId<HTMLButtonElement>('params-reset');
const entryInput = byId<HTMLInputElement>('opt-entry');
const entryCombo = byId<HTMLElement>('entry-combo');
const entryToggle = byId<HTMLButtonElement>('entry-toggle');
const entryMenu = byId<HTMLUListElement>('entry-menu');
const sampleHello = byId<HTMLButtonElement>('sample-hello');
const sampleUb = byId<HTMLButtonElement>('sample-ub');
const outputElement = byId<HTMLElement>('output');
const outputMeta = byId<HTMLElement>('output-meta');
const editorMeta = byId<HTMLElement>('editor-meta');
const buildInfoElement = byId<HTMLElement>('build-info');
const splitElement = byId<HTMLElement>('split');
const splitter = byId<HTMLElement>('splitter');
const leftPane = document.querySelector<HTMLElement>('.editor-pane');

if (!leftPane) throw new Error('editor pane is missing');
const editorPane = leftPane;

const optionInputs = {
  entryFunction: entryInput,
  fakeArgv0: byId<HTMLInputElement>('opt-argv0'),
  argv: byId<HTMLTextAreaElement>('opt-argv'),
  maxMemMiB: byId<HTMLInputElement>('opt-max-mem'),
  maxSteps: byId<HTMLInputElement>('opt-max-steps'),
  maxStackDepth: byId<HTMLInputElement>('opt-max-stack'),
  vscale: byId<HTMLInputElement>('opt-vscale'),
  seed: byId<HTMLInputElement>('opt-seed'),
  undefBehavior: byId<HTMLSelectElement>('opt-undef'),
  nanBehavior: byId<HTMLSelectElement>('opt-nan'),
  deterministic: byId<HTMLInputElement>('opt-deterministic'),
  fuseFMulAdd: byId<HTMLInputElement>('opt-fuse'),
  disableVerify: byId<HTMLInputElement>('opt-verify'),
};

let options = loadOptions();
let autoRun = localStorage.getItem(STORAGE_AUTO_RUN) !== 'false';
let scheduled: number | undefined;
let activeId = 0;
let busy = false;
let runTimeout: number | undefined;
let worker: Worker | null = null;
let definedFunctions: string[] = [];
let entryMatches: string[] = [];
let entryActiveIndex = -1;
let entryMenuOpen = false;

const initialIR = localStorage.getItem(STORAGE_IR) ?? HELLO_IR;
let editor: EditorController;

void start();

async function start(): Promise<void> {
  void loadBuildInfo();
  const catalog = await loadCompletionCatalog();
  editor = createEditor(
    byId('editor'),
    initialIR,
    onEditorChange,
    catalog,
    revealTraceForLine,
  );

  setupSplitter(splitElement, splitter, editorPane);
  applyOptionsToForm(options);
  applyRunMode(autoRun);
  updateEditorMeta(initialIR);
  updateEntryFunctions(initialIR);
  renderEmpty();
  if (autoRun) scheduleRun(0);
  else runNow();

  runButton.addEventListener('click', () => runNow());
  modeAuto.addEventListener('click', () => setRunMode(true));
  modeManual.addEventListener('click', () => setRunMode(false));
  paramsToggle.addEventListener('click', () => {
    const open = paramsPanel.hidden;
    paramsPanel.hidden = !open;
    paramsToggle.setAttribute('aria-expanded', String(open));
  });
  paramsReset.addEventListener('click', () => {
    options = { ...DEFAULT_OPTIONS };
    applyOptionsToForm(options);
    saveOptions();
    scheduleRun(0);
  });
  sampleHello.addEventListener('click', () => loadSample(HELLO_IR));
  sampleUb.addEventListener('click', () => loadSample(UB_IR));

  for (const input of Object.values(optionInputs)) {
    input.addEventListener('input', onOptionsChanged);
    input.addEventListener('change', onOptionsChanged);
  }

  entryInput.addEventListener('focus', () => openEntryMenu(''));
  entryInput.addEventListener('click', () => openEntryMenu(''));
  entryInput.addEventListener('input', () => {
    if (entryMenuOpen) renderEntryMenu(entryInput.value);
    else openEntryMenu(entryInput.value);
  });
  entryInput.addEventListener('keydown', onEntryKeydown);
  entryToggle.addEventListener('click', () => {
    if (entryMenuOpen) {
      closeEntryMenu();
    } else {
      openEntryMenu('');
      entryInput.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!entryCombo.contains(event.target as Node)) closeEntryMenu();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runNow();
    }
  });
}

function setRunMode(auto: boolean): void {
  if (auto === autoRun) return;
  autoRun = auto;
  localStorage.setItem(STORAGE_AUTO_RUN, String(autoRun));
  applyRunMode(autoRun);
  window.clearTimeout(scheduled);
  scheduled = undefined;
  if (autoRun) scheduleRun(0);
}

function applyRunMode(auto: boolean): void {
  modeAuto.setAttribute('aria-pressed', String(auto));
  modeManual.setAttribute('aria-pressed', String(!auto));
  runButton.hidden = auto;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

function loadOptions(): RunOptions {
  try {
    const stored = localStorage.getItem(STORAGE_OPTIONS);
    if (!stored) return { ...DEFAULT_OPTIONS };
    const parsed = JSON.parse(stored) as Partial<RunOptions>;
    return { ...DEFAULT_OPTIONS, ...parsed, verbose: true };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function saveOptions(): void {
  localStorage.setItem(STORAGE_OPTIONS, JSON.stringify(options));
}

function readOptionsFromForm(): RunOptions {
  return {
    entryFunction: optionInputs.entryFunction.value.trim(),
    fakeArgv0: optionInputs.fakeArgv0.value.trim(),
    argv: optionInputs.argv.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    maxMemMiB: numberValue(optionInputs.maxMemMiB, 1, 2047, 64),
    maxSteps: numberValue(optionInputs.maxSteps, 0, 4_294_967_295, 10_000_000),
    maxStackDepth: numberValue(optionInputs.maxStackDepth, 0, 4_294_967_295, 256),
    vscale: numberValue(optionInputs.vscale, 1, 4_294_967_295, 4),
    seed: numberValue(optionInputs.seed, 0, 4_294_967_295, 0),
    deterministic: optionInputs.deterministic.checked,
    fuseFMulAdd: optionInputs.fuseFMulAdd.checked,
    disableVerify: optionInputs.disableVerify.checked,
    verbose: true,
    undefBehavior: optionInputs.undefBehavior.value as RunOptions['undefBehavior'],
    nanBehavior: optionInputs.nanBehavior.value as RunOptions['nanBehavior'],
  };
}

function numberValue(
  input: HTMLInputElement,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function applyOptionsToForm(value: RunOptions): void {
  optionInputs.entryFunction.value = value.entryFunction;
  optionInputs.fakeArgv0.value = value.fakeArgv0;
  optionInputs.argv.value = value.argv.join('\n');
  optionInputs.maxMemMiB.value = String(value.maxMemMiB);
  optionInputs.maxSteps.value = String(value.maxSteps);
  optionInputs.maxStackDepth.value = String(value.maxStackDepth);
  optionInputs.vscale.value = String(value.vscale);
  optionInputs.seed.value = String(value.seed);
  optionInputs.undefBehavior.value = value.undefBehavior;
  optionInputs.nanBehavior.value = value.nanBehavior;
  optionInputs.deterministic.checked = value.deterministic;
  optionInputs.fuseFMulAdd.checked = value.fuseFMulAdd;
  optionInputs.disableVerify.checked = value.disableVerify;
}

function onOptionsChanged(): void {
  options = readOptionsFromForm();
  saveOptions();
  scheduleRun();
}

function onEditorChange(value: string): void {
  localStorage.setItem(STORAGE_IR, value);
  updateEditorMeta(value);
  updateEntryFunctions(value);
  queueMicrotask(() => editor.clearDiagnostics());
  if (autoRun) scheduleRun();
  else setStatus('modified', 'dirty');
}

function updateEditorMeta(value: string): void {
  const lines = value.length === 0 ? 1 : value.split('\n').length;
  editorMeta.textContent = `${lines} lines`;
}

function extractDefinedFunctions(ir: string): string[] {
  const names = new Set<string>();
  const re =
    /^\s*define\b[^@\n]*?@(?:"((?:[^"\\]|\\.)*)"|([-a-zA-Z$._0-9]+))\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ir))) names.add(match[1] ?? match[2]);
  return [...names].sort();
}

function updateEntryFunctions(ir: string): void {
  definedFunctions = extractDefinedFunctions(ir);
  if (entryMenuOpen) renderEntryMenu(entryInput.value);
}

function openEntryMenu(filter: string): void {
  entryMenuOpen = true;
  entryInput.setAttribute('aria-expanded', 'true');
  entryMenu.hidden = false;
  renderEntryMenu(filter);
}

function closeEntryMenu(): void {
  if (!entryMenuOpen) return;
  entryMenuOpen = false;
  entryInput.setAttribute('aria-expanded', 'false');
  entryMenu.hidden = true;
  entryActiveIndex = -1;
}

function renderEntryMenu(filter: string): void {
  const query = filter.trim().toLowerCase();
  entryMatches = definedFunctions.filter(
    (name) => !query || name.toLowerCase().includes(query),
  );
  const current = entryInput.value;
  entryActiveIndex = entryMatches.length
    ? Math.max(0, entryMatches.findIndex((name) => name === current))
    : -1;

  if (entryMatches.length === 0) {
    entryMenu.replaceChildren(element('li', 'combo-empty', 'No defined functions'));
    return;
  }

  const items = entryMatches.map((name, index) => {
    const item = element('li', 'combo-option', name);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === entryActiveIndex));
    if (name === current) item.classList.add('is-current');
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => chooseEntryFunction(name));
    return item;
  });
  entryMenu.replaceChildren(...items);
}

function setEntryActive(index: number): void {
  if (entryMatches.length === 0) return;
  entryActiveIndex = (index + entryMatches.length) % entryMatches.length;
  [...entryMenu.children].forEach((item, itemIndex) => {
    if (item.getAttribute('role') !== 'option') return;
    item.setAttribute('aria-selected', String(itemIndex === entryActiveIndex));
  });
  const active = entryMenu.children[entryActiveIndex] as HTMLElement | undefined;
  active?.scrollIntoView({ block: 'nearest' });
}

function onEntryKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeEntryMenu();
    return;
  }
  if (event.key === 'Tab') {
    closeEntryMenu();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!entryMenuOpen) openEntryMenu('');
    event.preventDefault();
    if (entryMatches.length === 0) return;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    setEntryActive(entryActiveIndex + delta);
    return;
  }
  if (event.key === 'Enter' && entryMenuOpen) {
    if (entryMatches.length === 0) return;
    event.preventDefault();
    chooseEntryFunction(entryMatches[Math.max(0, entryActiveIndex)]);
  }
}

function chooseEntryFunction(name: string): void {
  entryInput.value = name;
  closeEntryMenu();
  onOptionsChanged();
}

function loadSample(value: string): void {
  editor.setValue(value);
  editor.clearDiagnostics();
  scheduleRun(0);
}

function scheduleRun(delay = 500): void {
  if (!autoRun) {
    setStatus('modified', 'dirty');
    return;
  }
  window.clearTimeout(scheduled);
  scheduled = window.setTimeout(runNow, delay);
}

function runNow(): void {
  window.clearTimeout(scheduled);
  scheduled = undefined;
  const id = ++activeId;
  if (busy) destroyWorker();
  busy = true;
  setStatus('running...', 'running');
  outputMeta.textContent = '';

  const request: WorkerRequest = {
    id,
    ir: editor.getValue(),
    options: readOptionsFromForm(),
  };
  options = request.options;
  saveOptions();

  const current = ensureWorker();
  current.postMessage(request);

  window.clearTimeout(runTimeout);
  runTimeout = window.setTimeout(() => {
    if (id !== activeId) return;
    activeId++;
    destroyWorker();
    busy = false;
    renderFatal('Execution exceeded the 10 second web timeout.');
    setStatus('timeout', 'error');
  }, 10_000);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => handleWorkerMessage(event.data);
  worker.onerror = (event) => {
    event.preventDefault();
    if (!busy) return;
    activeId++;
    destroyWorker();
    busy = false;
    renderFatal(event.message || 'The interpreter worker crashed.');
    setStatus('worker crashed', 'error');
  };
  return worker;
}

function handleWorkerMessage(message: WorkerResponse): void {
  if (message.id !== activeId) return;
  window.clearTimeout(runTimeout);
  busy = false;
  if (message.error) {
    destroyWorker();
    renderFatal(message.error);
    setStatus('internal error', 'error');
    return;
  }
  if (!message.result) {
    destroyWorker();
    renderFatal('The interpreter returned an empty response.');
    setStatus('internal error', 'error');
    return;
  }
  renderResult(message.result);
}

function destroyWorker(): void {
  window.clearTimeout(runTimeout);
  runTimeout = undefined;
  if (!worker) return;
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
  worker = null;
}

function setStatus(text: string, kind: 'idle' | 'running' | 'ok' | 'warn' | 'error' | 'dirty'): void {
  statusElement.textContent = text;
  statusElement.className = `status status-${kind}`;
}

function renderEmpty(): void {
  outputMeta.textContent = '';
  outputElement.replaceChildren(
    element('p', 'empty', 'Edit the IR or press Run. Output appears here.'),
  );
}

function renderFatal(message: string): void {
  editor.clearDiagnostics();
  const box = element('div', 'result result-error');
  box.append(
    element('div', 'result-summary', 'Internal interpreter error'),
    element('p', 'fatal-message', message),
    element(
      'p',
      'empty',
      'The wasm worker was restarted; the next run will use a fresh instance.',
    ),
  );
  outputElement.replaceChildren(box);
  outputMeta.textContent = '';
}

function renderResult(result: RunResult): void {
  editor.setDiagnostics(result.diagnostics);
  outputMeta.textContent = `${result.durationMs} ms${
    result.truncated ? ' · truncated' : ''
  }`;

  const failed = !result.ok || result.exit.kind === 'failed';
  const warning =
    !failed &&
    (result.exit.kind === 'aborted' ||
      result.exit.kind === 'terminated' ||
      (result.exit.kind === 'exited' && result.exit.code !== 0));

  setStatus(
    `${result.exit.kind} ${result.exit.code}`,
    failed ? 'error' : warning ? 'warn' : 'ok',
  );

  const root = element('div', 'result');

  if (result.diagnostics.length > 0) {
    const diagnostics = element('section', 'block');
    diagnostics.append(element('h2', 'block-title', 'Diagnostics'));
    const list = element('div', 'diagnostics');
    for (const diagnostic of result.diagnostics) {
      list.append(renderDiagnostic(diagnostic));
    }
    diagnostics.append(list);
    root.append(diagnostics);
  }

  if (result.stdout) {
    const block = element('section', 'block');
    block.append(
      element('h2', 'block-title', 'stdout'),
      element('pre', 'output-text', result.stdout),
    );
    root.append(block);
  }

  if (result.trace.length > 0) {
    const trace = element('section', 'block');
    trace.append(
      element('h2', 'block-title', 'Verbose trace'),
      renderTrace(result.trace),
    );
    root.append(trace);
  }
  if (result.stderr) {
    const stderr = element('section', 'block');
    stderr.append(
      element('h2', 'block-title', 'Interpreter stderr'),
      element('pre', 'output-text', result.stderr),
    );
    root.append(stderr);
  }
  if (
    !result.stdout &&
    result.trace.length === 0 &&
    result.diagnostics.length === 0
  ) {
    root.append(element('p', 'empty', 'Program produced no output.'));
  }

  outputElement.replaceChildren(root);
}

function renderTrace(entries: TraceEntry[]): HTMLElement {
  const trace = element('div', 'trace');
  for (const entry of entries) {
    const row = element('div', `trace-row trace-${entry.kind ?? 'instruction'}`);
    row.dataset.line = String(entry.line);
    if (entry.targetLine) row.dataset.targetLine = String(entry.targetLine);

    const text = element('button', 'trace-line', entry.text || ' ');
    text.type = 'button';
    if (entry.line > 0) {
      text.title = `Jump to line ${entry.line}`;
      text.addEventListener('click', () => {
        activateTraceRow(row);
        editor.revealLine(entry.line);
      });
    } else {
      text.disabled = true;
    }
    row.append(text);

    if (entry.targetLine && entry.targetLine > 0) {
      const target = element(
        'button',
        'trace-target',
        entry.kind === 'branch' ? 'label' : 'function',
      ) as HTMLButtonElement;
      target.type = 'button';
      target.title = `Jump to ${
        entry.kind === 'branch' ? 'label' : 'function'
      } ${entry.targetName ?? ''} on line ${entry.targetLine}`;
      target.addEventListener('click', () => {
        activateTraceRow(row);
        editor.revealLine(entry.targetLine ?? 1);
      });
      row.append(target);
    }
    trace.append(row);
  }
  return trace;
}

function activateTraceRow(row: HTMLElement): void {
  for (const active of outputElement.querySelectorAll('.trace-row.is-active'))
    active.classList.remove('is-active');
  row.classList.add('is-active');
}

function revealTraceForLine(line: number): boolean {
  const rows = outputElement.querySelectorAll<HTMLElement>('.trace-row');
  for (const row of rows) {
    if (
      Number(row.dataset.line) === line ||
      Number(row.dataset.targetLine) === line
    ) {
      activateTraceRow(row);
      row.scrollIntoView({ block: 'nearest' });
      return true;
    }
  }
  return false;
}

function renderDiagnostic(diagnostic: Diagnostic): HTMLElement {
  const article = element('article', `diagnostic diagnostic-${diagnostic.severity}`);
  const location = diagnostic.line
    ? `${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}`
    : '';
  const button = element('button', 'diagnostic-main') as HTMLButtonElement;
  button.type = 'button';
  const header = element('span', 'diagnostic-header');
  header.append(
    element('span', 'diagnostic-phase', diagnostic.phase),
    element(
      'span',
      'diagnostic-message',
      diagnostic.message,
    ),
  );
  if (location) header.append(element('span', 'diagnostic-location', `line ${location}`));
  button.append(header);
  const line =
    diagnostic.line ??
    diagnostic.frames?.find((frame) => (frame.line ?? 0) > 0)?.line;
  if (line) {
    button.addEventListener('click', () => editor.revealLine(line));
  } else {
    button.disabled = true;
  }
  article.append(button);

  if (diagnostic.frames && diagnostic.frames.length > 0) {
    const frames = element('ol', 'stack');
    for (const frame of diagnostic.frames) {
      const item = element('li', 'stack-frame');
      if (frame.line) {
        const frameButton = element(
          'button',
          'stack-link',
          `${frame.function || '<unknown>'}:${frame.line}`,
        ) as HTMLButtonElement;
        frameButton.type = 'button';
        frameButton.addEventListener('click', () => editor.revealLine(frame.line ?? 1));
        item.append(frameButton);
      } else {
        item.append(element('span', 'muted', frame.function || '<unknown>'));
      }
      item.append(element('code', 'stack-instruction', frame.instruction));
      frames.append(item);
    }
    article.append(frames);
  }

  if (diagnostic.detail) {
    const details = document.createElement('details');
    details.className = 'diagnostic-detail';
    const summary = document.createElement('summary');
    summary.textContent = 'details';
    details.append(summary, element('pre', 'output-text', diagnostic.detail));
    article.append(details);
  }
  return article;
}


function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function loadCompletionCatalog(): Promise<CompletionCatalog> {
  try {
    const response = await fetch(
      new URL('completions.json', document.baseURI),
      { cache: 'no-cache' },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as CompletionCatalog;
  } catch (error) {
    console.warn('completion catalog is unavailable', error);
    return {
      keywords: [],
      instructions: [],
      types: [],
      attributes: [],
      metadata: [],
      intrinsics: [],
      libcalls: [],
    };
  }
}

async function loadBuildInfo(): Promise<void> {
  try {
    const response = await fetch(new URL('build-info.json', document.baseURI), {
      cache: 'no-cache',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = (await response.json()) as BuildInfo;
    renderBuildInfo(info);
  } catch {
    buildInfoElement.textContent = 'development build';
  }
}

function renderBuildInfo(info: BuildInfo): void {
  buildInfoElement.replaceChildren();
  buildInfoElement.append(
    element('span', 'build-item', `LLVM ${info.llvmVersion}`),
    element('span', 'build-separator', '·'),
  );
  if (info.llvmCommit) {
    const link = document.createElement('a');
    link.className = 'text-link';
    link.href = `https://github.com/llvm/llvm-project/commit/${info.llvmCommit}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = info.llvmCommitShort || info.llvmCommit.slice(0, 12);
    buildInfoElement.append(link);
  } else {
    buildInfoElement.append(element('span', 'build-item', 'unknown commit'));
  }
  buildInfoElement.append(
    element('span', 'build-separator', '·'),
    element(
      'span',
      'build-item',
      `built ${info.buildTime.replace('T', ' ').replace('Z', ' UTC')}`,
    ),
  );
  buildInfoElement.title = [
    `LLVM: ${info.llvmVersion}`,
    `Commit: ${info.llvmCommit}`,
    `Commit date: ${info.llvmCommitDate}`,
    `Built: ${info.buildTime}`,
    `Emscripten: ${info.emscriptenVersion}`,
    `Wasm size: ${(info.wasmBytes / (1024 * 1024)).toFixed(1)} MiB`,
  ].join('\n');
}
