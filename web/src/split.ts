const STORAGE_KEY = 'llubi.split-percent';
const OUTPUT_STORAGE_KEY = 'llubi.output-split-percent';
const MIN_PERCENT = 20;
const MAX_PERCENT = 80;
const SPLITTER_WIDTH = 7;

export function setupSplitter(
  container: HTMLElement,
  splitter: HTMLElement,
  leftPane: HTMLElement,
): void {
  const stored = readStorage(STORAGE_KEY);
  let percent = stored === null ? 50 : Number(stored);
  if (!Number.isFinite(percent)) percent = 50;
  percent = clamp(percent);

  const apply = (value: number) => {
    percent = clamp(value);
    leftPane.style.flex = `0 0 calc(${percent}% - ${SPLITTER_WIDTH / 2}px)`;
    splitter.setAttribute('aria-valuenow', String(Math.round(percent)));
  };
  apply(percent);

  let dragging = false;
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    apply(((event.clientX - rect.left) / rect.width) * 100);
  };
  const finishDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    splitter.releasePointerCapture?.(event.pointerId);
    document.body.classList.remove('resizing');
    writeStorage(STORAGE_KEY, percent);
  };

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
    event.preventDefault();
  });
  splitter.addEventListener('pointermove', onPointerMove);
  splitter.addEventListener('pointerup', finishDrag);
  splitter.addEventListener('pointercancel', finishDrag);

  splitter.addEventListener('dblclick', () => {
    apply(50);
    writeStorage(STORAGE_KEY, 50);
  });

  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    apply(percent + (event.key === 'ArrowLeft' ? -2 : 2));
    writeStorage(STORAGE_KEY, percent);
  });
}

export function setupOutputSplitter(
  container: HTMLElement,
  splitter: HTMLElement,
  topPane: HTMLElement,
): void {
  const defaultPercent = 100 / 6;
  const minPercent = 15;
  const maxPercent = 85;
  const stored = readStorage(OUTPUT_STORAGE_KEY);
  let percent = stored === null ? defaultPercent : Number(stored);
  if (!Number.isFinite(percent)) percent = defaultPercent;

  const apply = (value: number) => {
    percent = Math.min(maxPercent, Math.max(minPercent, value));
    topPane.style.flex = `0 0 calc(${percent}% - ${SPLITTER_WIDTH / 2}px)`;
    splitter.setAttribute('aria-valuenow', String(Math.round(percent)));
  };
  apply(percent);

  let dragging = false;
  const finishDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    splitter.releasePointerCapture?.(event.pointerId);
    document.body.classList.remove('resizing-output');
    writeStorage(OUTPUT_STORAGE_KEY, percent);
  };

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-output');
    event.preventDefault();
  });
  splitter.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    if (rect.height <= 0) return;
    apply(((event.clientY - rect.top) / rect.height) * 100);
  });
  splitter.addEventListener('pointerup', finishDrag);
  splitter.addEventListener('pointercancel', finishDrag);
  splitter.addEventListener('dblclick', () => {
    apply(defaultPercent);
    writeStorage(OUTPUT_STORAGE_KEY, defaultPercent);
  });
  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    apply(percent + (event.key === 'ArrowDown' ? 2 : -2));
    writeStorage(OUTPUT_STORAGE_KEY, percent);
  });
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function clamp(value: number): number {
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}
