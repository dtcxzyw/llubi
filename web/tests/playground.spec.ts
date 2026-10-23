import { expect, test } from '@playwright/test';

test('runs the hello sample and reports build information', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#build-info')).toContainText('LLVM');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('#output')).toContainText('Hello from llubi');
  await expect(page.locator('#output')).toContainText('Entering function: main');
  await expect(page.locator('.cm-content')).toContainText('define i32 @main');
});

test('highlights the runtime error line and lists the stack frame', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'UB example' }).click();
  await expect(page.locator('#status')).toHaveClass(/status-error/);
  await expect(page.locator('#output')).toContainText('freeing a pointer');
  await expect(page.locator('.cm-error-line')).toHaveCount(1);
  await expect(page.locator('.diagnostic-location')).toContainText('line 8');
  await expect(page.locator('.stack-link')).toContainText('main');
});

test('applies interpreter parameters', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Parameters' }).click();
  await page.locator('#opt-max-steps').fill('1');
  await expect(page.locator('#status')).toHaveClass(/status-error/);
  await expect(page.locator('#output')).toContainText(
    'Exceeded maximum number of execution steps',
  );
});

test('reports parse errors without running the program', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nthis is not IR\n');
  await expect(page.locator('#status')).toHaveClass(/status-error/);
  await expect(page.locator('#output')).toContainText('parse');
  await expect(page.locator('.cm-error-line')).toHaveCount(1);
});

test('fills the viewport and starts with centered panes', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const metrics = await page.evaluate(() => {
    const split = document.querySelector('.split')!.getBoundingClientRect();
    const left = document.querySelector('.editor-pane')!.getBoundingClientRect();
    const right = document.querySelector('.output-pane')!.getBoundingClientRect();
    return {
      bottom: split.bottom,
      viewport: window.innerHeight,
      left: left.width,
      right: right.width,
    };
  });
  expect(Math.abs(metrics.bottom - metrics.viewport)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.left - metrics.right)).toBeLessThanOrEqual(8);
});

test('hides Run while auto-run is active', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.getByRole('button', { name: 'Run' })).toBeHidden();
  await page.getByRole('button', { name: 'Manual' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();
  await page.getByRole('button', { name: 'Auto' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeHidden();
});

test('links parameters to the llubi and LangRef documentation', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Parameters' }).click();
  await expect(
    page.locator('a[href="https://llvm.org/docs/CommandGuide/llubi.html"]'),
  ).toBeVisible();
  await expect(
    page.locator('a[href="https://llvm.org/docs/LangRef.html#floatnan"]'),
  ).toBeVisible();
});

test('toggles LLVM IR line comments with Mod-/', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  const editor = page.locator('.cm-content');
  await page.locator('.cm-line', { hasText: 'ret i32 0' }).click();
  await page.keyboard.press('Control+/');
  await expect(editor).toContainText('; ret i32 0');
  await page.keyboard.press('Control+/');
  await expect(editor).not.toContainText('; ret i32 0');
});

test('auto-closes brackets in the editor', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  const editor = page.locator('.cm-content');
  await page.locator('.cm-line', { hasText: 'ret i32 0' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('(');
  await expect(editor).toContainText('ret i32 0()');
  await page.keyboard.press('Backspace');
  await expect(editor).not.toContainText('ret i32 0()');
});

test('offers intrinsic completions', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n@llvm.mem');
  const popup = page.locator('.cm-tooltip-autocomplete');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('@llvm.memcpy.');
});

test('offers and accepts libcall completions', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n@mall');
  const popup = page.locator('.cm-tooltip-autocomplete');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('@malloc');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(editor).toContainText('@malloc');
});

test('offers generated metadata completions', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n!db');
  const popup = page.locator('.cm-tooltip-autocomplete');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('!dbg');
});
