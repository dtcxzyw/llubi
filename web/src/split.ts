const STORAGE_KEY = 'llubi.split-percent';
const MIN_PERCENT = 20;
const MAX_PERCENT = 80;
const SPLITTER_WIDTH = 7;

export function setupSplitter(
  container: HTMLElement,
  splitter: HTMLElement,
  leftPane: HTMLElement,
): void {
  const stored = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, String(percent));
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
    localStorage.setItem(STORAGE_KEY, '50');
  });

  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    apply(percent + (event.key === 'ArrowLeft' ? -2 : 2));
    localStorage.setItem(STORAGE_KEY, String(percent));
  });
}

function clamp(value: number): number {
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}
