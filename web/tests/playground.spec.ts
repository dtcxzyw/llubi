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
  await page.locator('#examples-toggle').click();
  await page.getByRole('button', { name: 'UB: free out of bounds' }).click();
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

test('scales numeric parameters with buttons and arrow keys', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Parameters' }).click();
  await page.getByRole('button', { name: 'Manual' }).click();

  const step = (target: string, direction: 1 | -1) =>
    page
      .locator(
        `.number-button[data-target="${target}"][data-direction="${direction}"]`,
      )
      .click();

  const maxMem = page.locator('#opt-max-mem');
  await maxMem.fill('3');
  await step('opt-max-mem', 1);
  await expect(maxMem).toHaveValue('6');
  await step('opt-max-mem', 1);
  await expect(maxMem).toHaveValue('12');
  await step('opt-max-mem', -1);
  await expect(maxMem).toHaveValue('6');
  await maxMem.fill('1500');
  await step('opt-max-mem', 1);
  await expect(maxMem).toHaveValue('2047');
  await expect(
    page.locator(
      '.number-button[data-target="opt-max-mem"][data-direction="1"]',
    ),
  ).toBeDisabled();

  const maxSteps = page.locator('#opt-max-steps');
  await maxSteps.fill('7');
  await step('opt-max-steps', 1);
  await expect(maxSteps).toHaveValue('70');
  await expect(page.locator('#run-command')).toContainText('--max-steps=70');
  await step('opt-max-steps', -1);
  await expect(maxSteps).toHaveValue('7');
  await maxSteps.fill('1000000000');
  await step('opt-max-steps', 1);
  await expect(maxSteps).toHaveValue('4294967295');
  await step('opt-max-steps', -1);
  await expect(maxSteps).toHaveValue('429496729');
  await maxSteps.fill('0');
  await step('opt-max-steps', 1);
  await expect(maxSteps).toHaveValue('1');
  await step('opt-max-steps', -1);
  await expect(maxSteps).toHaveValue('0');
  await expect(
    page.locator(
      '.number-button[data-target="opt-max-steps"][data-direction="-1"]',
    ),
  ).toBeDisabled();

  const maxStack = page.locator('#opt-max-stack');
  await maxStack.fill('5');
  await step('opt-max-stack', 1);
  await expect(maxStack).toHaveValue('10');
  await step('opt-max-stack', -1);
  await expect(maxStack).toHaveValue('5');
  await maxStack.fill('0');
  await step('opt-max-stack', 1);
  await expect(maxStack).toHaveValue('1');
  await step('opt-max-stack', -1);
  await expect(maxStack).toHaveValue('0');

  const seed = page.locator('#opt-seed');
  await seed.fill('3');
  await step('opt-seed', 1);
  await expect(seed).toHaveValue('6');
  await step('opt-seed', -1);
  await expect(seed).toHaveValue('3');
  await seed.fill('0');
  await step('opt-seed', 1);
  await expect(seed).toHaveValue('1');
  await step('opt-seed', -1);
  await expect(seed).toHaveValue('0');

  const vscale = page.locator('#opt-vscale');
  await vscale.fill('5');
  await step('opt-vscale', 1);
  await expect(vscale).toHaveValue('8');
  await step('opt-vscale', -1);
  await expect(vscale).toHaveValue('4');
  await vscale.fill('3');
  await step('opt-vscale', 1);
  await expect(vscale).toHaveValue('4');
  await vscale.fill('1');
  await expect(
    page.locator(
      '.number-button[data-target="opt-vscale"][data-direction="-1"]',
    ),
  ).toBeDisabled();

  await maxMem.fill('3');
  await maxMem.press('ArrowUp');
  await expect(maxMem).toHaveValue('6');

  await vscale.fill('3');
  await page.locator('#run').click();
  await expect(vscale).toHaveValue('4');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);

  await maxMem.fill('0');
  await page.locator('#run').click();
  await expect(maxMem).toHaveValue('1');
  await expect(page.locator('#run-command')).toContainText('--max-mem=1048576');
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
  await expect(page.locator('#output details')).toHaveCount(0);
  await expect(page.locator('.diagnostic-detail-text')).toBeVisible();
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
  await expect(page.locator('#run')).toBeHidden();
  await page.getByRole('button', { name: 'Manual' }).click();
  await expect(page.locator('#run')).toBeVisible();
  await page.getByRole('button', { name: 'Auto' }).click();
  await expect(page.locator('#run')).toBeHidden();
});

test('links parameters to the llubi and LangRef documentation', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Parameters' }).click();
  await expect(
    page.locator('a[href="https://llvm.org/docs/CommandGuide/llubi.html"]'),
  ).toBeVisible();
  await expect(
    page.locator('a[href="https://llvm.org/docs/LangRef.html#floatnan"]'),
  ).toBeVisible();
});

test('describes every parameter in a hover tooltip', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Parameters' }).click();

  const expected = new Map([
    ['Entry function', 'function named main'],
    ['argv0', 'argv[0]'],
    ['argv (one per line)', 'one argument per line'],
    ['Max memory (MiB)', 'stack, heap, and global variables'],
    ['Max steps', 'no limit'],
    ['Max stack depth', '256'],
    ['vscale', 'llvm.vscale'],
    ['Random seed', 'default seed is 0'],
    ['Undef behavior', 'freshly random'],
    ['NaN behavior', 'target-specific'],
    ['Deterministic', 'NaN behavior preferred'],
    ['Fuse fmuladd', 'llvm.fma'],
    ['Disable verifier', 'input LLVM IR'],
  ]);
  const helps = await page.locator('#params .param-help').evaluateAll(
    (elements) =>
      elements.map((element) => ({
        label: element.textContent?.trim() ?? '',
        help: element.getAttribute('data-help') ?? '',
      })),
  );

  expect(helps).toHaveLength(expected.size);
  expect(new Set(helps.map(({ label }) => label)).size).toBe(expected.size);
  for (const { label, help } of helps) {
    expect(expected.get(label), label).toBeDefined();
    expect(help, label).toContain(expected.get(label));
  }

  const maxMemory = page.locator('#params .param-help', {
    hasText: 'Max memory (MiB)',
  });
  await expect(maxMemory).not.toHaveAttribute('title');
  await maxMemory.hover();
  const tooltip = page.locator('#param-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('stack, heap, and global variables');
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();

  const maxSteps = page.locator('#opt-max-steps');
  await maxSteps.focus();
  await expect(tooltip).toBeVisible();
  await expect(maxSteps).toHaveAttribute('aria-describedby', /param-help-/);
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await expect(page.locator('#params')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#params')).toBeHidden();
  await expect(page.locator('#params-toggle')).toBeFocused();
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

test('shows LangRef links for instruction, intrinsic, keyword, and metadata tokens', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(`define i32 @main() {
  %r = call i32 @llvm.abs.i32(i32 -1, i1 false)
  %p = getelementptr inbounds i8, ptr null, i64 0
  %v = load i32, ptr null, !range !0
  ret i32 %v
}
!0 = !{ i32 0, i32 1 }
`);

  const bar = page.locator('#langref');
  const editorHeightBefore = await page
    .locator('#editor')
    .evaluate((node) => node.getBoundingClientRect().height);
  await page.locator('.cm-line', { hasText: '@llvm.abs' }).click();
  await expect(bar).toBeVisible();
  const editorHeightAfter = await page
    .locator('#editor')
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(Math.abs(editorHeightBefore - editorHeightAfter)).toBeLessThanOrEqual(1);
  await expect(bar.locator('.langref-link', { hasText: 'call' })).toHaveAttribute(
    'href',
    /#i-call$/,
  );
  await expect(
    bar.locator('.langref-link', { hasText: '@llvm.abs.i32' }),
  ).toHaveAttribute('href', /#int-abs$/);

  await page.locator('.cm-line', { hasText: '!range !0' }).click();
  await expect(
    bar.locator('.langref-link', { hasText: 'load' }),
  ).toHaveAttribute('href', /#i-load$/);
  await expect(
    bar.locator('.langref-link', { hasText: '!range' }),
  ).toHaveAttribute('href', /#range-metadata$/);

  await page.locator('.cm-line', { hasText: 'getelementptr inbounds' }).click();
  await expect(
    bar.locator('.langref-link', { hasText: 'inbounds' }),
  ).toHaveAttribute('href', /#i-getelementptr$/);

  const geometry = await page.evaluate(() => ({
    editor: document.querySelector('#editor')!.getBoundingClientRect(),
    bar: document.querySelector('#langref')!.getBoundingClientRect(),
  }));
  expect(Math.abs(geometry.editor.width - geometry.bar.width)).toBeLessThanOrEqual(
    1,
  );
  expect(geometry.bar.bottom).toBeLessThanOrEqual(geometry.editor.top + 1);
  expect(geometry.bar.top).toBeLessThan(geometry.editor.top);

  await page.locator('.cm-line', { hasText: '!0 =' }).click();
  await expect(bar.locator('.langref-link')).toHaveCount(0);
  await expect(bar).toContainText('No documented LLVM names');
});

test('updates LangRef links when output jumps to an editor line', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.locator('.cm-line', { hasText: 'ret i32 0' }).click();
  const bar = page.locator('#langref');
  await expect(
    bar.locator('.langref-link', { hasText: 'ret' }),
  ).toHaveAttribute('href', /#i-ret$/);

  await page.locator('.print-line', { hasText: 'Hello from llubi' }).click();
  await expect(
    bar.locator('.langref-link', { hasText: 'call' }),
  ).toHaveAttribute('href', /#i-call$/);

  await page.locator('.cm-line').first().click();
  await expect(bar.locator('.langref-link')).toHaveCount(0);
  await expect(page.locator('.print-line.is-active')).toHaveCount(0);
  await expect(page.locator('.trace-row.is-active')).toHaveCount(0);
});

test('clears stale output highlights when the selected line has no match', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.locator('.trace-line', { hasText: '%r = call i32' }).click();
  await expect(page.locator('.trace-row.is-active')).toHaveCount(1);

  await page.locator('.cm-line', { hasText: '%r = call i32' }).click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.trace-row[data-line="8"]')).toHaveClass(
    /is-active/,
  );

  await page.locator('.cm-line').first().click();
  await expect(page.locator('.trace-row.is-active')).toHaveCount(0);

  await page.locator('.print-line', { hasText: 'Hello from llubi' }).click();
  await expect(page.locator('.print-line.is-active')).toHaveCount(1);
  await expect(page.locator('.trace-row.is-active')).toHaveCount(0);

  await page.locator('.cm-line').first().click();
  await expect(page.locator('.print-line.is-active')).toHaveCount(0);
});

test('indexes only documented LangRef intrinsics', async ({ page }) => {
  await page.goto('./');
  const index = await page.evaluate(async () => {
    const response = await fetch('langref.json');
    return (await response.json()) as {
      intrinsics: Record<string, string>;
      metadata: Record<string, string>;
    };
  });
  expect(index.intrinsics['llvm.abs']).toBe('int-abs');
  expect(index.intrinsics['llvm.coro.suspend']).toBeUndefined();
  expect(index.metadata['range']).toBe('range-metadata');
});

test('suggests defined functions for the entry point', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  await page.getByRole('button', { name: 'Parameters' }).click();
  await page.locator('#opt-entry').click();
  const options = page.locator('#entry-menu [role="option"]');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveText('main');
  await expect(page.locator('#opt-entry')).toHaveAttribute(
    'aria-activedescendant',
    'entry-option-0',
  );

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\ndefine i32 @foo() {\n  ret i32 0\n}\n');
  await page.locator('#opt-entry').click();
  await expect(options).toHaveCount(2);
  await expect(options.filter({ hasText: 'foo' })).toHaveCount(1);

  await page.locator('#opt-entry').fill('foo');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('#output')).toContainText('Entering function: foo');
});

test('aligns the entry function picker with its input', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Parameters' }).click();
  await page.locator('#opt-entry').click();
  await expect(page.locator('#entry-menu')).toBeVisible();
  const metrics = await page.evaluate(() => {
    const combo = document.querySelector('#entry-combo')!.getBoundingClientRect();
    const menu = document.querySelector('#entry-menu')!.getBoundingClientRect();
    return {
      comboLeft: combo.left,
      comboWidth: combo.width,
      comboBottom: combo.bottom,
      menuLeft: menu.left,
      menuWidth: menu.width,
      menuTop: menu.top,
    };
  });
  expect(Math.abs(metrics.menuLeft - metrics.comboLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.menuWidth - metrics.comboWidth)).toBeLessThanOrEqual(1);
  expect(metrics.menuTop).toBeGreaterThanOrEqual(metrics.comboBottom);
});

test('links trace rows and editor lines in both directions', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();

  const source = `define i32 @main() {
entry:
  br label %done
done:
  ret i32 0
}
`;
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
  await page.locator('#run').click();
  await expect(page.locator('.trace-row')).toHaveCount(4);
  await expect(page.locator('.trace-line[tabindex="0"]')).toHaveCount(1);
  await page.locator('.trace-line').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.trace-line').nth(1)).toBeFocused();
  await expect(page.locator('.trace-target')).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.trace-target')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.trace-line').nth(1)).toBeFocused();

  await expect(page.locator('.trace-line .tok-keyword').first()).toBeVisible();
  await page.locator('.trace-line', { hasText: 'Entering function: main' }).click();
  await expect(page.locator('.cm-activeLine')).toContainText('define i32 @main');
  await expect(page.locator('#langref')).toContainText('define');

  await page.locator('.trace-target', { hasText: 'label' }).click();
  await expect(page.locator('.cm-activeLine')).toContainText('done:');

  await page
    .locator('.cm-lineNumbers .cm-gutterElement')
    .filter({ hasText: /^1$/ })
    .click();
  await expect(page.locator('.trace-row[data-line="1"]').first()).toHaveClass(
    /is-active/,
  );
  await expect(page.locator('.cm-activeLine')).toContainText('define i32 @main');

  await page
    .locator('.cm-lineNumbers .cm-gutterElement')
    .filter({ hasText: /^4$/ })
    .click();
  await expect(page.locator('.trace-row[data-target-line="4"]')).toHaveClass(
    /is-active/,
  );

  await page.locator('.cm-line', { hasText: 'ret i32 0' }).click();
  await expect(page.locator('.trace-row[data-line="5"]')).toHaveClass(
    /is-active/,
  );
});

test('shows exit status and duration in the output header only', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('.toolbar #status')).toHaveCount(0);
  await expect(page.locator('.pane-header #status')).toContainText('returned 0');
  await expect(page.locator('.pane-header #output-meta')).toContainText('ms');
  await expect(page.locator('#output .result-summary')).toHaveCount(0);
});

test('copies the RUN line and generated check lines', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);

  const command = page.locator('#run-command');
  await expect(command).toHaveText(
    '; RUN: llubi --verbose < %s 2>&1 | FileCheck %s',
  );
  await page.locator('#copy-run').click();
  await expect(page.locator('#copy-status')).toHaveText('Copied to clipboard');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await command.textContent(),
  );
  await command.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await command.textContent(),
  );

  await expect(page.locator('#copy-checks')).toBeEnabled();
  await page.locator('#copy-checks').click();
  const checks = await page.evaluate(() => navigator.clipboard.readText());
  expect(checks).toContain('; CHECK: Entering function: main');
  expect(checks).toContain('; CHECK-NEXT: Hello from llubi');
  expect(checks).toContain(
    '; CHECK-NEXT:   %r = call i32 (ptr, ...) @printf',
  );
  expect(checks).toContain('; CHECK-NEXT: Exiting function: main');
});

test('uses not and non-default options in RUN, and generates error checks', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Parameters' }).click();
  await page.locator('#opt-max-steps').fill('1');
  await expect(page.locator('#status')).toHaveClass(/status-error/);

  const command = await page.locator('#run-command').textContent();
  expect(command).toContain('; RUN: not llubi --verbose --max-steps=1');
  expect(command).not.toContain('--max-mem');
  expect(command).not.toContain('--vscale');

  await page.locator('#copy-checks').click();
  const checks = await page.evaluate(() => navigator.clipboard.readText());
  expect(checks).toContain(
    '; CHECK-NEXT: Error: Exceeded maximum number of execution steps.',
  );
  expect(checks).toContain(
    "; CHECK-NEXT: error: Execution of function 'main' failed.",
  );
});

test('splits print output at one sixth height', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('.print-section .output-section-header')).toHaveText(
    'Program output',
  );
  await expect(
    page.locator('.other-section .output-section-header'),
  ).toHaveText('Interpreter output');

  const metrics = await page.evaluate(() => {
    const split = document.querySelector('#output')!.getBoundingClientRect();
    const print = document.querySelector('.print-section')!.getBoundingClientRect();
    const other = document.querySelector('.other-section')!.getBoundingClientRect();
    return {
      total: split.height,
      print: print.height,
      other: other.height,
    };
  });
  expect(metrics.print / metrics.total).toBeGreaterThan(0.13);
  expect(metrics.print / metrics.total).toBeLessThan(0.2);
  expect(metrics.other / metrics.total).toBeGreaterThan(0.8);
  expect(metrics.other / metrics.total).toBeLessThan(0.87);
  await expect(page.locator('#other-output')).not.toContainText('Verbose trace');
  await expect(page.locator('#other-output')).not.toContainText('Diagnostics');
  await expect(page.locator('#other-output')).not.toContainText(
    'Interpreter stderr',
  );

  const before = metrics.print;
  await page.locator('#output-resizer').focus();
  await page.keyboard.press('ArrowDown');
  const after = await page
    .locator('.print-section')
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(after).toBeGreaterThan(before);
});

test('jumps from program output to source, while source jumps to interpreter output', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const printLine = page.locator('.print-line', { hasText: 'Hello from llubi' });
  await printLine.click();
  await expect(page.locator('.cm-activeLine')).toContainText(
    '%r = call i32 (ptr, ...) @printf',
  );

  await page.locator('.cm-line', { hasText: '%r = call i32' }).click();
  await expect(page.locator('.trace-row[data-line="7"]')).toHaveClass(
    /is-active/,
  );
  await expect(page.locator('.print-line.is-active')).toHaveCount(0);
});

test('restores the copy label after feedback', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const copyButton = page.locator('#copy-run');
  await expect(copyButton).toHaveText('copy');
  await page.locator('#run-command').click();
  await expect(copyButton).toHaveText('copied');
  await page.locator('#run-command').click();
  await expect(copyButton).toHaveText('copy', { timeout: 5000 });
});

test('defers the generated example catalog until the drawer opens', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/examples.json')) requests.push(request.url());
  });
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  expect(requests).toHaveLength(0);

  await page.locator('#examples-toggle').click();
  await expect
    .poll(async () => requests.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(
      async () => page.locator('#examples-tests .example-item').count(),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(100);
});

test('opens the examples panel with built-ins first and generated tests', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(
    page.locator('.editor-pane .pane-header #examples-toggle'),
  ).toBeVisible();
  await expect(page.locator('.toolbar #examples-toggle')).toHaveCount(0);
  await page.locator('#examples-toggle').click();
  await expect(page.locator('#examples-panel')).toHaveClass(/is-open/);
  await expect(
    page.locator('#examples-builtin .example-item').first(),
  ).toHaveText('Hello world');
  await expect(
    page.locator('#examples-builtin .example-item').nth(1),
  ).toHaveText('UB: free out of bounds');
  await expect
    .poll(
      async () => page.locator('#examples-tests .example-item').count(),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(100);
  await expect(
    page.locator('#examples-builtin .example-item[tabindex="0"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#examples-tests .example-item[tabindex="0"]'),
  ).toHaveCount(1);
  await page.locator('#examples-builtin .example-item').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#examples-builtin .example-item').nth(1)).toBeFocused();

  await page.locator('#examples-filter').fill('deterministic');
  await expect(page.locator('#examples-builtin .example-item')).toHaveCount(0);
  const deterministicExample = page
    .locator('#examples-tests .example-item')
    .filter({ hasText: 'deterministic' })
    .first();
  await expect(deterministicExample).toBeVisible();
  await deterministicExample.click();
  await expect(page.locator('#examples-panel')).toHaveClass(/is-open/);
  await page.getByRole('button', { name: 'Parameters' }).click();
  await expect(page.locator('#opt-deterministic')).toBeChecked();
  await expect(page.locator('.cm-content')).not.toContainText('CHECK-NEXT');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
});

test('generates a complete lit test from the current result', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.locator('#examples-toggle').click();
  await page.locator('#examples-filter').fill('deterministic');
  await page
    .locator('#examples-tests .example-item')
    .filter({ hasText: 'deterministic' })
    .click();
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.locator('#generate-test').click();
  const fullTest = await page.evaluate(() => navigator.clipboard.readText());
  expect(fullTest).toMatch(
    /^; NOTE: Assertions have been autogenerated by utils\/update_llubi_test_checks\.py UTC_ARGS: --version 6\n; RUN: /,
  );
  expect(fullTest.match(/; NOTE: Assertions have been autogenerated/g)).toHaveLength(1);
  expect(fullTest.match(/^; RUN:/gm)).toHaveLength(1);
  expect(fullTest).toContain('define void @main()');
  expect(fullTest).toContain('; CHECK: Entering function: main');
  expect(fullTest).toMatch(/; CHECK-NEXT: Exiting function: main/);
  expect(fullTest).not.toContain('; CHECK-NEXT: ; CHECK');
});

test('the examples drawer squeezes the editor and has explicit close controls', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const editorWidthBefore = await page
    .locator('#editor')
    .evaluate((node) => node.getBoundingClientRect().width);

  await page.locator('#examples-toggle').click();
  await expect(page.locator('#examples-panel')).toHaveClass(/is-open/);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const body = document.querySelector(
            '.editor-body',
          )!.getBoundingClientRect();
          const panel = document.querySelector(
            '#examples-panel',
          )!.getBoundingClientRect();
          return panel.width / body.width;
        }),
      { timeout: 3000 },
    )
    .toBeGreaterThan(0.25);
  const metrics = await page.evaluate(() => {
    const body = document.querySelector('.editor-body')!.getBoundingClientRect();
    const panel = document.querySelector('#examples-panel')!.getBoundingClientRect();
    const editor = document.querySelector('#editor')!.getBoundingClientRect();
    return {
      body: body.width,
      panel: panel.width,
      editor: editor.width,
    };
  });
  expect(metrics.panel / metrics.body).toBeLessThan(0.45);
  expect(metrics.editor).toBeLessThan(editorWidthBefore);

  await page.getByRole('button', { name: 'Hello world' }).click();
  await expect(page.locator('#examples-panel')).toHaveClass(/is-open/);

  await page.getByRole('button', { name: 'Close examples' }).click();
  await expect(page.locator('#examples-panel')).not.toHaveClass(/is-open/);
  await page.locator('#examples-toggle').click();
  await expect(page.locator('#examples-panel')).toHaveClass(/is-open/);
  await page.locator('#examples-toggle').click();
  await expect(page.locator('#examples-panel')).not.toHaveClass(/is-open/);
});

test('uses an overlay examples drawer on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const editorWidthBefore = await page
    .locator('#editor')
    .evaluate((node) => node.getBoundingClientRect().width);

  await page.locator('#examples-toggle').click();
  await expect(page.locator('#examples-panel')).toHaveClass(/is-open/);
  await expect
    .poll(
      async () =>
        page
          .locator('#examples-panel')
          .evaluate((node) => node.getBoundingClientRect().width),
      { timeout: 3000 },
    )
    .toBeGreaterThan(300);
  const editorWidthOpen = await page
    .locator('#editor')
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(Math.abs(editorWidthBefore - editorWidthOpen)).toBeLessThanOrEqual(1);

  await page
    .locator('#examples-builtin .example-item')
    .filter({ hasText: 'Hello world' })
    .click();
  await expect(page.locator('#examples-panel')).not.toHaveClass(/is-open/);
  await expect(page.locator('.cm-content')).toBeFocused();
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const editorWidthAfter = await page
    .locator('#editor')
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(Math.abs(editorWidthBefore - editorWidthAfter)).toBeLessThanOrEqual(1);
});

test('disables stale test generation after edits', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('#copy-checks')).toBeEnabled();
  await page.getByRole('button', { name: 'Manual' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n');
  await expect(page.locator('#copy-checks')).toBeDisabled();
  await expect(page.locator('#generate-test')).toBeDisabled();
});

test('shows unsupported instructions directly with a stack frame', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = ((url?: string | URL) => {
      (window as unknown as { __issueUrl?: string }).__issueUrl = String(url);
      return null;
    }) as typeof window.open;
  });
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    'declare i32 @unknown()\ndefine i32 @main() {\n  %res = call i32 @unknown()\n  ret i32 %res\n}\n',
  );
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveClass(/status-error/);
  await expect(page.locator('#output')).toContainText(
    'Unrecognized instruction:   %res = call i32 @unknown()',
  );
  await expect(page.locator('#output .stack')).toHaveCount(1);
  await expect(page.locator('.stack-instruction')).toContainText(
    '%res = call i32 @unknown()',
  );

  await page.locator('#report-bug').click();
  const issueUrl = await page.evaluate(
    () => (window as unknown as { __issueUrl?: string }).__issueUrl ?? '',
  );
  const params = new URL(issueUrl).searchParams;
  expect(params.get('title')).toBe(
    '[llubi] Unrecognized instruction:   %res = call i32 @unknown()',
  );
  expect(params.get('labels')).toBe('tools:llubi');
});

test('auto-indents LLVM IR on Enter', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Manual' }).click();
  await page.locator('.cm-line', { hasText: 'define i32 @main() {' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('%x = alloca i32');
  const inserted = page.locator('.cm-line', { hasText: '%x = alloca i32' });
  expect(await inserted.evaluate((node) => node.textContent)).toBe(
    '  %x = alloca i32',
  );
});

test('opts the editor out of Grammarly', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const content = page.locator('.cm-content');
  await expect(content).toHaveAttribute('data-gramm', 'false');
  await expect(content).toHaveAttribute('data-gramm_editor', 'false');
  await expect(content).toHaveAttribute('data-enable-grammarly', 'false');
  await expect(content).toHaveAttribute('spellcheck', 'false');
});

test('builds a prefilled LLVM issue report', async ({ page }) => {
  await page.addInitScript(() => {
    window.open = ((url?: string | URL) => {
      (window as unknown as { __issueUrl?: string }).__issueUrl = String(url);
      return null;
    }) as typeof window.open;
  });
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('#build-info')).toContainText('LLVM');
  await page.locator('#report-bug').click();
  const issueUrl = await page.evaluate(
    () => (window as unknown as { __issueUrl?: string }).__issueUrl ?? '',
  );
  const parsed = new URL(issueUrl);
  expect(parsed.origin + parsed.pathname).toBe(
    'https://github.com/llvm/llvm-project/issues/new',
  );
  expect(parsed.searchParams.get('title')).toBe(
    '[llubi] Unexpected behavior: TODO',
  );
  expect(parsed.searchParams.get('labels')).toBe('tools:llubi');
  const body = parsed.searchParams.get('body') ?? '';
  expect(body.split('\n').slice(0, 3)).toEqual([
    'Reproducer:',
    '```llvm',
    '; bin/llubi --verbose input.ll',
  ]);
  expect(body).toContain('define i32 @main');
  expect(body).toContain('llubi output:');
  expect(body).toContain('Entering function: main');
  expect(body).not.toContain('; CHECK');
  expect(body).not.toContain('NOTE: Assertions have been autogenerated');
  expect(body).toContain('llvm version:');
});

test('opens the generated third-party licenses page', async ({ page }) => {
  await page.goto('./');
  const link = page.getByRole('link', { name: 'Licenses' });
  await expect(link).toHaveAttribute('href', 'licenses.html');
  await link.click();
  await expect(page).toHaveTitle('Third-party licenses - llubi playground');
  await expect(
    page.getByRole('heading', { name: 'Third-party licenses' }),
  ).toBeVisible();
  await expect(page.locator('#llvm')).toContainText('LLVM Project and llubi');
  await expect(page.locator('#frontend')).toContainText('@codemirror/view');
  await expect(page.locator('#frontend')).toContainText('MIT');
  await expect(page.locator('a[href="licenses/LLVM.txt"]')).toBeVisible();
});

test('follows the system appearance until a theme is chosen', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-select')).toHaveValue('system');
  await expect(
    page.locator('#theme-select option[value="system"]'),
  ).toHaveText('System (Dark)');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(
    page.locator('#theme-select option[value="system"]'),
  ).toHaveText('System (Light)');
  await page.reload();
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#theme-select')).toHaveValue('system');
  await expect(
    page.locator('#theme-select option[value="system"]'),
  ).toHaveText('System (Light)');
});

test('polls the system appearance every minute', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    let dark = false;
    window.matchMedia = (query: string) => {
      const media = original(query);
      if (query !== '(prefers-color-scheme: dark)') return media;
      return {
        get matches() {
          return dark;
        },
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      } as MediaQueryList;
    };
    (
      window as unknown as { setSystemDark(value: boolean): void }
    ).setSystemDark = (value) => {
      dark = value;
    };
  });

  await page.goto('./');
  await page.clock.fastForward(1000);
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(
    page.locator('#theme-select option[value="system"]'),
  ).toHaveText('System (Light)');

  await page.evaluate(() =>
    (window as unknown as { setSystemDark(value: boolean): void }).setSystemDark(
      true,
    ),
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.clock.fastForward(60_000);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page.locator('#theme-select option[value="system"]'),
  ).toHaveText('System (Dark)');
});

test('applies and persists explicit and accessible themes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  const select = page.locator('#theme-select');

  await select.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(select).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.emulateMedia({ colorScheme: 'light' });
  await select.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await expect(select).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await select.selectOption('colorblind');
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    'colorblind',
  );
  const colorblind = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      accent: style.getPropertyValue('--accent').trim(),
      error: style.getPropertyValue('--error').trim(),
    };
  });
  expect(colorblind).toEqual({ accent: '#56b4e9', error: '#e67300' });

  await select.selectOption('high-contrast');
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    'high-contrast',
  );
  const highContrast = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bg: style.getPropertyValue('--bg').trim(),
      border: style.getPropertyValue('--border').trim(),
      accent: style.getPropertyValue('--accent').trim(),
    };
  });
  expect(highContrast).toEqual({
    bg: '#000000',
    border: '#ffffff',
    accent: '#ffff00',
  });

  await select.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('starts when local storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('storage disabled', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('storage disabled', 'SecurityError');
    };
  });
  await page.goto('./');
  await expect(page.locator('#status')).toHaveClass(/status-ok/);
  await page.getByRole('button', { name: 'Parameters' }).click();
  const plus = page.locator(
    '.number-button[data-target="opt-max-mem"][data-direction="1"]',
  );
  await plus.click();
  await expect(page.locator('#opt-max-mem')).toHaveValue('128');
  await page.locator('#theme-select').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
