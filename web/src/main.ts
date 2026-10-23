import './styles.css';

import {
  createEditor,
  createLlvmHighlighter,
  type EditorController,
} from './editor';
import type {
  BuildInfo,
  CompletionCatalog,
  Diagnostic,
  ExampleCatalog,
  ExampleEntry,
  RunOptions,
  RunResult,
  TraceEntry,
  WorkerRequest,
  WorkerResponse,
} from './protocol';
import { DEFAULT_OPTIONS } from './protocol';
import { HELLO_IR, UB_IR } from './samples';
import { setupOutputSplitter, setupSplitter } from './split';

const STORAGE_IR = 'llubi.ir';
const STORAGE_OPTIONS = 'llubi.options';
const STORAGE_AUTO_RUN = 'llubi.auto-run';
const STORAGE_THEME = 'llubi.theme';

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
const examplesToggle = byId<HTMLButtonElement>('examples-toggle');
const examplesPanel = byId<HTMLElement>('examples-panel');
const examplesClose = byId<HTMLButtonElement>('examples-close');
const examplesFilter = byId<HTMLInputElement>('examples-filter');
const examplesBuiltin = byId<HTMLUListElement>('examples-builtin');
const examplesTests = byId<HTMLUListElement>('examples-tests');
const examplesBuiltinTitle = byId<HTMLElement>('examples-builtin-title');
const examplesTestsTitle = byId<HTMLElement>('examples-tests-title');
const examplesEmpty = byId<HTMLElement>('examples-empty');
const outputElement = byId<HTMLElement>('output');
const printOutput = byId<HTMLElement>('print-output');
const otherOutput = byId<HTMLElement>('other-output');
const outputResizer = byId<HTMLElement>('output-resizer');
const outputMeta = byId<HTMLElement>('output-meta');
const runCommandElement = byId<HTMLElement>('run-command');
const copyRunButton = byId<HTMLButtonElement>('copy-run');
const copyChecksButton = byId<HTMLButtonElement>('copy-checks');
const generateTestButton = byId<HTMLButtonElement>('generate-test');
const reportBugButton = byId<HTMLButtonElement>('report-bug');
const editorMeta = byId<HTMLElement>('editor-meta');
const buildInfoElement = byId<HTMLElement>('build-info');
const themeSelect = byId<HTMLSelectElement>('theme-select');
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

interface NumericScale {
  input: HTMLInputElement;
  min: number;
  max: number;
  factor: number;
  fallback: number;
  powerOfTwo?: boolean;
}

const MAX_U32 = 4_294_967_295;
const numericScales: NumericScale[] = [
  {
    input: optionInputs.maxMemMiB,
    min: 1,
    max: 2047,
    factor: 2,
    fallback: DEFAULT_OPTIONS.maxMemMiB,
  },
  {
    input: optionInputs.maxSteps,
    min: 0,
    max: MAX_U32,
    factor: 10,
    fallback: DEFAULT_OPTIONS.maxSteps,
  },
  {
    input: optionInputs.maxStackDepth,
    min: 0,
    max: MAX_U32,
    factor: 2,
    fallback: DEFAULT_OPTIONS.maxStackDepth,
  },
  {
    input: optionInputs.vscale,
    min: 1,
    max: MAX_U32,
    factor: 2,
    fallback: DEFAULT_OPTIONS.vscale,
    powerOfTwo: true,
  },
  {
    input: optionInputs.seed,
    min: 0,
    max: MAX_U32,
    factor: 2,
    fallback: DEFAULT_OPTIONS.seed,
  },
];

type ThemeChoice =
  | 'system'
  | 'light'
  | 'dark'
  | 'colorblind'
  | 'high-contrast';

const THEME_CHOICES: ThemeChoice[] = [
  'system',
  'light',
  'dark',
  'colorblind',
  'high-contrast',
];
const systemDarkTheme = window.matchMedia('(prefers-color-scheme: dark)');

let options = loadOptions();
let autoRun = getStorage(STORAGE_AUTO_RUN) !== 'false';
let themeChoice: ThemeChoice = 'system';
let scheduled: number | undefined;
let activeId = 0;
let busy = false;
let runTimeout: number | undefined;
let worker: Worker | null = null;
let definedFunctions: string[] = [];
let entryMatches: string[] = [];
let entryActiveIndex = -1;
let entryMenuOpen = false;
let activeRunOptions: RunOptions | null = null;
let activeRunIR = '';
let inputVersion = 0;
let activeRunVersion = 0;
let lastCheckLines = '';
let lastRunIR = '';
let lastRunOptions: RunOptions = options;
let lastRunResult: RunResult | null = null;
let lastRunCrash: string | null = null;
let currentBuildInfo: BuildInfo | null = null;
let testExamples: ExampleEntry[] = [];
let examplesLoaded = false;
let examplesLoading = false;
const copyFeedbackTimers = new WeakMap<HTMLButtonElement, number>();

const BUILTIN_EXAMPLES: ExampleEntry[] = [
  { name: 'Hello world', ir: HELLO_IR },
  { name: 'UB: free out of bounds', ir: UB_IR },
];

const initialIR = getStorage(STORAGE_IR) ?? HELLO_IR;
let editor: EditorController;
let highlightLlvm: (text: string) => DocumentFragment = (text) => {
  const fragment = document.createDocumentFragment();
  fragment.append(document.createTextNode(text));
  return fragment;
};

void start();

async function start(): Promise<void> {
  setupTheme();
  void loadBuildInfo();
  const catalog = await loadCompletionCatalog();
  highlightLlvm = createLlvmHighlighter(catalog);
  editor = createEditor(
    byId('editor'),
    initialIR,
    onEditorChange,
    catalog,
    revealTraceForLine,
  );

  setupSplitter(splitElement, splitter, editorPane);
  setupOutputSplitter(outputElement, outputResizer, printOutput.parentElement!);
  applyOptionsToForm(options);
  applyRunMode(autoRun);
  updateEditorMeta(initialIR);
  updateEntryFunctions(initialIR);
  renderEmpty();
  updateRunCommand(options, null);
  setCheckLines('');
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
    inputVersion += 1;
    setCheckLines('');
    updateRunCommand(options, null);
    scheduleRun(0);
  });
  examplesToggle.addEventListener('click', toggleExamplesPanel);
  examplesClose.addEventListener('click', () => closeExamplesPanel(true));
  examplesFilter.addEventListener('input', renderExamples);
  document.addEventListener('pointerdown', (event) => {
    if (!examplesPanel.classList.contains('is-open')) return;
    const target = event.target as Node;
    if (examplesPanel.contains(target) || examplesToggle.contains(target))
      return;
    closeExamplesPanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && examplesPanel.classList.contains('is-open'))
      closeExamplesPanel(true);
  });
  copyRunButton.addEventListener('click', () =>
    copyText(runCommandElement.textContent ?? '', copyRunButton),
  );
  runCommandElement.addEventListener('click', () =>
    copyText(runCommandElement.textContent ?? '', copyRunButton),
  );
  copyChecksButton.addEventListener('click', () =>
    copyText(lastCheckLines, copyChecksButton),
  );
  generateTestButton.addEventListener('click', () =>
    copyText(buildFullTest(), generateTestButton),
  );
  reportBugButton.addEventListener('click', openBugReport);

  for (const input of Object.values(optionInputs)) {
    input.addEventListener('input', onOptionsChanged);
  }
  setupNumericScaling();

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
  setStorage(STORAGE_AUTO_RUN, String(autoRun));
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

function getStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function loadThemeChoice(): ThemeChoice {
  const stored = getStorage(STORAGE_THEME);
  if (THEME_CHOICES.includes(stored as ThemeChoice)) {
    return stored as ThemeChoice;
  }
  return 'system';
}

function applyTheme(choice: ThemeChoice): void {
  const effective =
    choice === 'system'
      ? systemDarkTheme.matches
        ? 'dark'
        : 'light'
      : choice;
  themeChoice = choice;
  themeSelect.value = choice;
  document.documentElement.dataset.theme = effective;
}

function setupTheme(): void {
  applyTheme(loadThemeChoice());
  themeSelect.addEventListener('change', () => {
    const choice = THEME_CHOICES.includes(themeSelect.value as ThemeChoice)
      ? (themeSelect.value as ThemeChoice)
      : 'system';
    setStorage(STORAGE_THEME, choice);
    applyTheme(choice);
  });
  systemDarkTheme.addEventListener('change', () => {
    if (themeChoice === 'system') applyTheme('system');
  });
}

function loadOptions(): RunOptions {
  const stored = getStorage(STORAGE_OPTIONS);
  if (!stored) return { ...DEFAULT_OPTIONS };
  try {
    const parsed = JSON.parse(stored) as Partial<RunOptions>;
    return { ...DEFAULT_OPTIONS, ...parsed, verbose: true };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function saveOptions(): void {
  setStorage(STORAGE_OPTIONS, JSON.stringify(options));
}

function setupNumericScaling(): void {
  for (const config of numericScales) {
    config.input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      scaleNumericInput(config, event.key === 'ArrowUp' ? 1 : -1);
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '.number-button',
  )) {
    button.addEventListener('click', () => {
      const config = numericScales.find(
        (item) => item.input.id === button.dataset.target,
      );
      if (!config) return;
      scaleNumericInput(config, button.dataset.direction === '1' ? 1 : -1);
      config.input.focus();
    });
  }
  updateNumericButtons();
}

function scaledValue(config: NumericScale, direction: 1 | -1): number {
  const current = numberValue(
    config.input,
    config.min,
    config.max,
    config.fallback,
  );
  if (config.powerOfTwo) {
    const maxPower = 2 ** Math.floor(Math.log2(config.max));
    if (direction > 0 && current >= maxPower) return current;
    const next =
      direction > 0
        ? 2 ** (Math.floor(Math.log2(current)) + 1)
        : 2 ** Math.max(0, Math.ceil(Math.log2(current)) - 1);
    return Math.min(maxPower, Math.max(config.min, next));
  }
  const next =
    direction > 0
      ? current === 0
        ? 1
        : current * config.factor
      : Math.floor(current / config.factor);
  return Math.min(config.max, Math.max(config.min, Math.trunc(next)));
}

function scaleNumericInput(config: NumericScale, direction: 1 | -1): void {
  const next = scaledValue(config, direction);
  const value = String(next);
  if (config.input.value === value) return;
  config.input.value = value;
  config.input.dispatchEvent(new Event('input', { bubbles: true }));
}

function updateNumericButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '.number-button',
  )) {
    const config = numericScales.find(
      (item) => item.input.id === button.dataset.target,
    );
    if (!config) continue;
    const direction = button.dataset.direction === '1' ? 1 : -1;
    button.disabled = scaledValue(config, direction) === numberValue(
      config.input,
      config.min,
      config.max,
      config.fallback,
    );
  }
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
  updateNumericButtons();
}

function onOptionsChanged(): void {
  options = readOptionsFromForm();
  saveOptions();
  inputVersion += 1;
  setCheckLines('');
  updateNumericButtons();
  updateRunCommand(options, null);
  scheduleRun();
}

function onEditorChange(value: string): void {
  setStorage(STORAGE_IR, value);
  updateEditorMeta(value);
  updateEntryFunctions(value);
  inputVersion += 1;
  setCheckLines('');
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

function loadExample(example: ExampleEntry): void {
  options = { ...DEFAULT_OPTIONS, ...(example.options ?? {}), verbose: true };
  applyOptionsToForm(options);
  saveOptions();
  editor.setValue(example.ir);
  editor.clearDiagnostics();
  inputVersion += 1;
  setCheckLines('');
  updateRunCommand(options, null);
  scheduleRun(0);
}

function toggleExamplesPanel(): void {
  if (examplesPanel.classList.contains('is-open')) closeExamplesPanel(true);
  else openExamplesPanel();
}

function openExamplesPanel(): void {
  examplesPanel.classList.add('is-open');
  void loadExamples();
  examplesPanel.setAttribute('aria-hidden', 'false');
  examplesPanel.removeAttribute('inert');
  examplesToggle.setAttribute('aria-expanded', 'true');
  renderExamples();
  examplesFilter.focus();
}

function closeExamplesPanel(restoreFocus: boolean): void {
  if (!examplesPanel.classList.contains('is-open')) return;
  examplesPanel.classList.remove('is-open');
  examplesPanel.setAttribute('aria-hidden', 'true');
  examplesPanel.setAttribute('inert', '');
  examplesToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) examplesToggle.focus();
}

function renderExamples(): void {
  const query = examplesFilter.value.trim().toLowerCase();
  const matches = (example: ExampleEntry) =>
    !query || example.name.toLowerCase().includes(query);
  const builtins = BUILTIN_EXAMPLES.filter(matches);
  const tests = testExamples.filter(matches);

  examplesBuiltin.replaceChildren(
    ...builtins.map((example) => createExampleItem(example)),
  );
  examplesTests.replaceChildren(
    ...tests.map((example) => createExampleItem(example)),
  );
  examplesBuiltinTitle.hidden = builtins.length === 0;
  examplesTestsTitle.hidden = tests.length === 0;
  examplesEmpty.hidden = builtins.length + tests.length > 0;
}

function createExampleItem(example: ExampleEntry): HTMLLIElement {
  const item = document.createElement('li');
  const button = element('button', 'example-item', example.name);
  button.type = 'button';
  button.title = example.run ? `; RUN: ${example.run}` : example.name;
  button.addEventListener('click', () => loadExample(example));
  item.append(button);
  return item;
}

async function loadExamples(): Promise<void> {
  if (examplesLoaded || examplesLoading) return;
  examplesLoading = true;
  try {
    const response = await fetch(new URL('examples.json', document.baseURI), {
      cache: 'no-cache',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = (await response.json()) as ExampleCatalog;
    testExamples = catalog.examples ?? [];
    examplesLoaded = true;
    examplesTestsTitle.textContent = `llubi tests (${testExamples.length})`;
    if (examplesPanel.classList.contains('is-open')) renderExamples();
  } catch (error) {
    console.warn('example catalog is unavailable', error);
  } finally {
    examplesLoading = false;
  }
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
  setCheckLines('');

  const ir = editor.getValue();
  const request: WorkerRequest = {
    id,
    ir,
    options: readOptionsFromForm(),
  };
  activeRunIR = ir;
  options = request.options;
  activeRunOptions = request.options;
  activeRunVersion = inputVersion;
  updateRunCommand(activeRunOptions, null);
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
  if (activeRunVersion !== inputVersion) {
    if (message.error) destroyWorker();
    return;
  }
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
  renderResult(message.result, activeRunOptions ?? options);
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
  setCheckLines('');
  updateReportButton();
  printOutput.replaceChildren(
    element('p', 'empty', 'No program output.'),
  );
  otherOutput.replaceChildren(
    element('p', 'empty', 'Edit the IR or press Run. Diagnostics and trace appear here.'),
  );
}

function recordCrash(message: string): void {
  lastRunIR = activeRunIR || editor.getValue();
  lastRunOptions = activeRunOptions ?? options;
  lastRunResult = null;
  lastRunCrash = message;
  updateReportButton();
}

function renderFatal(message: string): void {
  recordCrash(message);
  editor.clearDiagnostics();
  setCheckLines('');
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
  printOutput.replaceChildren(element('p', 'empty', 'No program output.'));
  otherOutput.replaceChildren(box);
  outputMeta.textContent = '';
}

function shellQuote(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_./:=+,-]+$/.test(value)) return value;
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function buildOptionFlags(runOptions: RunOptions): string[] {
  const flags: string[] = [];
  if (runOptions.entryFunction !== DEFAULT_OPTIONS.entryFunction)
    flags.push(`--entry-function=${shellQuote(runOptions.entryFunction)}`);
  if (runOptions.fakeArgv0)
    flags.push(`--fake-argv0=${shellQuote(runOptions.fakeArgv0)}`);
  if (runOptions.deterministic) flags.push('--deterministic');
  if (runOptions.maxMemMiB !== DEFAULT_OPTIONS.maxMemMiB)
    flags.push(`--max-mem=${runOptions.maxMemMiB * 1024 * 1024}`);
  if (runOptions.maxSteps !== DEFAULT_OPTIONS.maxSteps)
    flags.push(`--max-steps=${runOptions.maxSteps}`);
  if (runOptions.maxStackDepth !== DEFAULT_OPTIONS.maxStackDepth)
    flags.push(`--max-stack-depth=${runOptions.maxStackDepth}`);
  if (runOptions.vscale !== DEFAULT_OPTIONS.vscale)
    flags.push(`--vscale=${runOptions.vscale}`);
  if (runOptions.seed !== DEFAULT_OPTIONS.seed)
    flags.push(`--seed=${runOptions.seed}`);
  if (runOptions.undefBehavior !== DEFAULT_OPTIONS.undefBehavior)
    flags.push(`--undef-behavior=${runOptions.undefBehavior}`);
  if (runOptions.nanBehavior !== DEFAULT_OPTIONS.nanBehavior)
    flags.push(`--nan-behavior=${runOptions.nanBehavior}`);
  if (!runOptions.fuseFMulAdd) flags.push('--fuse-fmuladd=false');
  if (runOptions.disableVerify) flags.push('--disable-verify');
  return flags;
}

function buildRunCommand(
  runOptions: RunOptions,
  result: RunResult | null,
): string {
  const parts = ['llubi', '--verbose', ...buildOptionFlags(runOptions)];
  if (runOptions.argv.length > 0)
    parts.push('--', ...runOptions.argv.map(shellQuote));

  const needsNot = result !== null && (!result.ok || result.exit.code !== 0);
  return `; RUN: ${needsNot ? 'not ' : ''}${parts.join(' ')} < %s 2>&1 | FileCheck %s`;
}

function updateRunCommand(
  runOptions: RunOptions,
  result: RunResult | null,
): void {
  const command = buildRunCommand(runOptions, result);
  runCommandElement.textContent = command;
  runCommandElement.title = command;
}

function buildOutputLines(
  result: RunResult,
  runOptions: RunOptions,
): string[] {
  const lines: string[] = [];
  for (const entry of result.trace) lines.push(...entry.text.split('\n'));

  if (result.stderr) {
    const stderr = result.stderr
      .replace(/\r\n/g, '\n')
      .replace(/<input>/g, '<stdin>');
    lines.push(...stderr.split('\n'));
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  }

  for (const diagnostic of result.diagnostics) {
    if (diagnostic.phase !== 'runtime') continue;
    if (diagnostic.kind === 'immediate-ub') {
      lines.push(`Immediate UB detected: ${diagnostic.message}`);
    } else if (diagnostic.kind === 'unsupported') {
      lines.push(diagnostic.message);
    } else if (diagnostic.kind === 'error') {
      lines.push(`Error: ${diagnostic.message}`);
    }
  }

  if (result.exit.kind === 'failed') {
    lines.push(
      `error: Execution of function '${runOptions.entryFunction}' failed.`,
    );
  } else if (
    !result.ok &&
    result.diagnostics.some((diagnostic) =>
      /poison return value/i.test(diagnostic.message),
    )
  ) {
    lines.push(
      `error: Execution of function '${runOptions.entryFunction}' resulted in poison return value.`,
    );
  }
  return lines;
}

function buildCheckLines(result: RunResult, runOptions: RunOptions): string {
  if (result.trace.length === 0) return '';
  return buildOutputLines(result, runOptions)
    .map((line, index) => `; ${index === 0 ? 'CHECK' : 'CHECK-NEXT'}: ${line}`)
    .join('\n');
}

function extractAssertion(message: string): string | null {
  const line = message
    .split(/\r?\n/)
    .find((item) => item.includes('Assertion failed:'));
  if (!line) return null;
  const assertion = line
    .slice(line.indexOf('Assertion failed:'))
    .replace(/\)\s*$/, '')
    .trim();
  return assertion || null;
}

function stripAssertionLocation(assertion: string): string {
  return assertion
    .replace(/,\s*at:\s*.*$/i, '')
    .replace(/,\s*file\s+.*?,\s*line\s+\d+.*$/i, '')
    .trim();
}

function buildReportTitle(): string {
  if (lastRunCrash) {
    const assertion = extractAssertion(lastRunCrash);
    return `[llubi] ${
      assertion ? stripAssertionLocation(assertion) : 'Crash: TODO'
    }`;
  }
  const unsupported = lastRunResult?.diagnostics.find(
    (diagnostic) => diagnostic.kind === 'unsupported',
  );
  if (unsupported) return `[llubi] ${unsupported.message}`;
  return '[llubi] Unexpected behavior: TODO';
}

function buildReproducerRunLine(runOptions: RunOptions): string {
  const parts = ['; bin/llubi', ...buildOptionFlags(runOptions), '--verbose', 'input.ll'];
  return parts.join(' ');
}

function buildReportBody(): string {
  const outputLines = lastRunResult
    ? buildOutputLines(lastRunResult, lastRunOptions)
    : (lastRunCrash ?? '').split(/\r?\n/).filter(Boolean);
  const lines = [
    'Reproducer:',
    '```llvm',
    buildReproducerRunLine(lastRunOptions),
    stripTestDirectives(lastRunIR),
    '```',
    'llubi output:',
    '```',
    ...outputLines,
    '```',
  ];
  if (lastRunCrash) {
    lines.push('```', 'TODO: stack trace');
    const assertion = extractAssertion(lastRunCrash);
    if (assertion) lines.push(assertion);
    lines.push('```');
  }
  const info = currentBuildInfo
    ? `${currentBuildInfo.llvmVersion} (${
        currentBuildInfo.llvmCommitShort || currentBuildInfo.llvmCommit
      })`
    : 'unknown';
  lines.push(`llvm version: ${info}`);
  return lines.join('\n');
}

function updateReportButton(): void {
  reportBugButton.disabled = !lastRunIR || (!lastRunResult && !lastRunCrash);
  reportBugButton.classList.toggle('is-crash', lastRunCrash !== null);
}

function openBugReport(): void {
  if (!lastRunIR || (!lastRunResult && !lastRunCrash)) return;
  const labels = ['tools:llubi'];
  if (lastRunCrash) labels.push('crash-on-valid');
  const params = new URLSearchParams({
    title: buildReportTitle(),
    body: buildReportBody(),
    labels: labels.join(','),
  });
  window.open(
    `https://github.com/llvm/llvm-project/issues/new?${params.toString()}`,
    '_blank',
    'noopener,noreferrer',
  );
}

function setCheckLines(text: string): void {
  lastCheckLines = text;
  copyChecksButton.disabled = text.length === 0;
  generateTestButton.disabled = text.length === 0;
}

function stripTestDirectives(ir: string): string {
  const lines = ir.split('\n').filter((line) => {
    if (
      /^\s*;\s*NOTE:\s*Assertions have been autogenerated by utils\/update_llubi_test_checks\.py/.test(
        line,
      )
    )
      return false;
    if (/^\s*;\s*RUN:\s*/.test(line)) return false;
    if (
      /^\s*;\s*(?:CHECK|[A-Z][A-Z0-9_-]*)(?:-[A-Z]+)?:/.test(line)
    )
      return false;
    return true;
  });
  return lines.join('\n').trim();
}

function buildFullTest(): string {
  const header =
    '; NOTE: Assertions have been autogenerated by utils/update_llubi_test_checks.py UTC_ARGS: --version 6';
  const run = (runCommandElement.textContent ?? '').trim();
  const ir = stripTestDirectives(editor.getValue());
  return `${header}\n${run}\n\n${ir}\n\n${lastCheckLines}\n`;
}

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  if (!text) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = fallbackCopy(text);
  }
  if (!copied) return;
  const original = button.dataset.copyLabel ?? (button.textContent ?? 'copy').trim();
  button.dataset.copyLabel = original;
  button.textContent = 'copied';
  const previous = copyFeedbackTimers.get(button);
  if (previous !== undefined) window.clearTimeout(previous);
  const timer = window.setTimeout(() => {
    button.textContent = original;
    copyFeedbackTimers.delete(button);
  }, 1200);
  copyFeedbackTimers.set(button, timer);
}

function fallbackCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  return copied;
}

function renderResult(result: RunResult, runOptions: RunOptions): void {
  lastRunIR = activeRunIR || editor.getValue();
  lastRunOptions = runOptions;
  lastRunResult = result;
  lastRunCrash = null;
  updateReportButton();
  editor.setDiagnostics(result.diagnostics);
  outputMeta.textContent = `${result.durationMs} ms${
    result.truncated ? ' · truncated' : ''
  }`;
  updateRunCommand(runOptions, result);
  setCheckLines(buildCheckLines(result, runOptions));

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

  if (result.trace.length > 0) root.append(renderTrace(result.trace));

  if (result.diagnostics.length > 0) {
    const list = element('div', 'diagnostics');
    for (const diagnostic of result.diagnostics) {
      list.append(renderDiagnostic(diagnostic));
    }
    root.append(list);
  }

  if (result.trace.length === 0 && result.diagnostics.length === 0) {
    root.append(element('p', 'empty', 'No interpreter output.'));
  }

  renderProgramOutput(result);
  otherOutput.replaceChildren(root);
}

function renderProgramOutput(result: RunResult): void {
  const entries = result.trace.filter((entry) => entry.kind === 'stdout');
  if (entries.length === 0) {
    printOutput.replaceChildren(
      result.stdout
        ? element('pre', 'output-text', result.stdout)
        : element('p', 'empty', 'No program output.'),
    );
    return;
  }

  const lines = element('div', 'print-lines');
  for (const entry of entries) {
    const line = element('button', 'print-line', entry.text || ' ');
    line.type = 'button';
    if (entry.line > 0) {
      line.title = `Jump to line ${entry.line}`;
      line.addEventListener('click', () => {
        activatePrintRow(line);
        editor.revealLine(entry.line);
      });
    } else {
      line.disabled = true;
    }
    lines.append(line);
  }
  printOutput.replaceChildren(lines);
}

function activatePrintRow(row: HTMLElement): void {
  for (const active of printOutput.querySelectorAll('.print-line.is-active'))
    active.classList.remove('is-active');
  for (const active of otherOutput.querySelectorAll('.trace-row.is-active'))
    active.classList.remove('is-active');
  row.classList.add('is-active');
}

function renderTrace(entries: TraceEntry[]): HTMLElement {
  const trace = element('div', 'trace');
  for (const entry of entries) {
    if (entry.kind === 'stdout') continue;
    const row = element('div', `trace-row trace-${entry.kind ?? 'instruction'}`);
    row.dataset.line = String(entry.line);
    if (entry.targetLine) row.dataset.targetLine = String(entry.targetLine);

    const text = element('button', 'trace-line');
    text.type = 'button';
    const arrow = entry.text.indexOf(' => ');
    if (arrow >= 0) {
      text.append(highlightLlvm(entry.text.slice(0, arrow)));
      text.append(document.createTextNode(' => '));
      text.append(document.createTextNode(entry.text.slice(arrow + 4)));
    } else {
      text.append(highlightLlvm(entry.text || ' '));
    }
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
  for (const active of otherOutput.querySelectorAll('.trace-row.is-active'))
    active.classList.remove('is-active');
  for (const active of printOutput.querySelectorAll('.print-line.is-active'))
    active.classList.remove('is-active');
  row.classList.add('is-active');
}

function revealTraceForLine(line: number): boolean {
  const rows = otherOutput.querySelectorAll<HTMLElement>('.trace-row');
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
    article.append(
      element('pre', 'output-text diagnostic-detail-text', diagnostic.detail),
    );
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
    currentBuildInfo = info;
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
