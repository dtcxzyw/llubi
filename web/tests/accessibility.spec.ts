import { expect, test } from '@playwright/test';

type ThemeName = 'dark' | 'light' | 'colorblind' | 'high-contrast';

const THEMES: ThemeName[] = ['dark', 'light', 'colorblind', 'high-contrast'];
const BACKGROUNDS = ['bg', 'panel', 'panel-2', 'panel-3'];
const FOREGROUNDS = [
  'text',
  'muted',
  'accent',
  'accent-2',
  'ok',
  'warn',
  'error',
  'syntax-comment',
  'syntax-string',
  'syntax-number',
  'syntax-keyword',
  'syntax-type',
  'syntax-local',
  'syntax-global',
  'syntax-label',
  'syntax-attribute',
  'syntax-meta',
  'syntax-operator',
  'syntax-punctuation',
];

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  return (
    0.2126 * channel(Number.parseInt(value.slice(0, 2), 16)) +
    0.7152 * channel(Number.parseInt(value.slice(2, 4), 16)) +
    0.0722 * channel(Number.parseInt(value.slice(4, 6), 16))
  );
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function mix(foreground: string, background: string, alpha: number): string {
  const foregroundValue = foreground.replace('#', '');
  const backgroundValue = background.replace('#', '');
  let result = '#';
  for (const offset of [0, 2, 4]) {
    const value = Math.round(
      Number.parseInt(foregroundValue.slice(offset, offset + 2), 16) * alpha +
        Number.parseInt(backgroundValue.slice(offset, offset + 2), 16) *
          (1 - alpha),
    );
    result += value.toString(16).padStart(2, '0');
  }
  return result;
}

test('meets WCAG AA contrast in every theme', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const select = page.locator('#theme-select');

  for (const theme of THEMES) {
    await select.selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const tokens = await page.evaluate((names) => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        names.map((name) => [
          name,
          style.getPropertyValue(`--${name}`).trim(),
        ]),
      );
    }, [
      ...BACKGROUNDS,
      ...FOREGROUNDS,
      'border-strong',
      'on-accent',
    ]);
    const threshold = theme === 'high-contrast' ? 7 : 4.5;
    const failures: string[] = [];

    for (const foreground of FOREGROUNDS) {
      for (const background of BACKGROUNDS) {
        const ratio = contrast(tokens[foreground], tokens[background]);
        if (ratio < threshold) {
          failures.push(
            `${foreground} on ${background}: ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
    const onAccent = contrast(tokens['on-accent'], tokens.accent);
    if (onAccent < 4.5) {
      failures.push(`on-accent on accent: ${onAccent.toFixed(2)}:1`);
    }

    for (const background of BACKGROUNDS) {
      const ratio = contrast(tokens['border-strong'], tokens[background]);
      if (ratio < 3) {
        failures.push(
          `border-strong on ${background}: ${ratio.toFixed(2)}:1`,
        );
      }
    }

    const overlays = [
      { name: 'active editor line', value: mix(tokens.accent, tokens.panel, 0.08) },
      { name: 'active output row', value: mix(tokens.accent, tokens['panel-2'], 0.08) },
      { name: 'selection', value: mix(tokens.accent, tokens.panel, 0.12) },
    ];
    for (const overlay of overlays) {
      for (const foreground of FOREGROUNDS.filter(
        (name) => name === 'text' || name.startsWith('syntax-'),
      )) {
        const ratio = contrast(tokens[foreground], overlay.value);
        if (ratio < threshold) {
          failures.push(
            `${foreground} on ${overlay.name}: ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
    const selectionText = contrast(
      tokens.text,
      mix(tokens.accent, tokens.panel, 0.32),
    );
    if (selectionText < 4.5) {
      failures.push(`selected text: ${selectionText.toFixed(2)}:1`);
    }

    expect(failures, `${theme} contrast failures`).toEqual([]);
  }
});

test('keeps content usable at 200% text size', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });

  await expect(page.locator('#theme-select')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Licenses' })).toBeVisible();
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  const buildInfo = page.locator('#build-info');
  const buildMetrics = await buildInfo.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(buildMetrics.scrollWidth).toBeLessThanOrEqual(
    buildMetrics.clientWidth + 1,
  );

  await page.getByRole('button', { name: 'Parameters' }).click();
  const params = page.locator('#params');
  await expect(params).toBeVisible();
  expect(await params.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
    'auto',
  );
  const paramsMetrics = await params.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(paramsMetrics.scrollWidth).toBeLessThanOrEqual(
    paramsMetrics.clientWidth + 1,
  );

  const plus = page.locator(
    '.number-button[data-target="opt-max-mem"][data-direction="1"]',
  );
  const plusBox = await plus.boundingBox();
  expect(plusBox?.width ?? 0).toBeGreaterThanOrEqual(40);

  await page.locator('#params-reset').scrollIntoViewIfNeeded();
  await expect(page.locator('#params-reset')).toBeVisible();
  await expect(page.locator('#opt-max-steps')).toBeVisible();

  const output = page.locator('#output');
  expect(
    await output.evaluate((element) => getComputedStyle(element).overflowY),
  ).toBe('auto');
  await page
    .locator('.other-section .output-section-header')
    .scrollIntoViewIfNeeded();
  await expect(page.locator('.other-section .output-section-header')).toBeVisible();
});
