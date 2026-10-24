#!/usr/bin/env node
/*
 * Generate the deployed third-party license page.
 *
 * The frontend package list and license texts come from the installed
 * production dependency tree via license-checker-rseidelsohn. Core toolchain
 * notices are copied into web/public/licenses by scripts/build.py beforehand.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB = join(ROOT, 'web');
const OUTPUT = join(WEB, 'public', 'licenses.html');
const LICENSE_DIR = join(WEB, 'public', 'licenses');
const CHECKER = join(
  WEB,
  'node_modules',
  'license-checker-rseidelsohn',
  'bin',
  'license-checker-rseidelsohn.js',
);

function die(message) {
  console.error(`[licenses] error: ${message}`);
  process.exit(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readLicense(path, fallback) {
  if (!path) return fallback;
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return fallback;
  }
}

function licenseName(value) {
  if (Array.isArray(value)) return value.join(' / ');
  return value || 'Unknown';
}

let packages;
try {
  const output = execFileSync(
    process.execPath,
    [
      CHECKER,
      '--production',
      '--json',
      '--excludePrivatePackages',
      '--start',
      WEB,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, cwd: WEB },
  );
  packages = JSON.parse(output);
} catch (error) {
  die(`license-checker failed: ${error.message}`);
}

const frontend = Object.entries(packages)
  .map(([key, info]) => {
    const separator = key.lastIndexOf('@');
    const name = key.slice(0, separator);
    const version = key.slice(separator + 1);
    const license = licenseName(info.licenses);
    const text = readLicense(
      info.licenseFile,
      `License text for ${name}@${version} is available from its package repository.`,
    );
    return { name, version, license, text, repository: info.repository || '' };
  })
  .sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );

const groups = new Map();
for (const pkg of frontend) {
  const key = `${pkg.license}\u0000${pkg.text}`;
  if (!groups.has(key)) {
    groups.set(key, {
      license: pkg.license,
      text: pkg.text,
      packages: [],
    });
  }
  groups.get(key).packages.push(pkg);
}

function readCoreLicense(name) {
  try {
    return readFileSync(join(LICENSE_DIR, name), 'utf8').trim();
  } catch {
    die(
      `missing ${name}; run scripts/build.py first to stage third-party license texts`,
    );
  }
}

const core = [
  {
    id: 'llvm',
    title: 'LLVM Project and llubi',
    description:
      'The WebAssembly interpreter, LLVM libraries, and generated completion, example, and LangRef catalogs. The catalogs are derived from LLVM source, tests, and documentation.',
    license: 'Apache-2.0 WITH LLVM-exception',
    text: readCoreLicense('LLVM.txt'),
  },
  {
    id: 'emscripten',
    title: 'Emscripten',
    description:
      'The WebAssembly toolchain and generated JavaScript loader/runtime.',
    license: 'MIT / University of Illinois/NCSA',
    text: readCoreLicense('Emscripten.txt'),
  },
  {
    id: 'musl',
    title: 'musl libc',
    description: 'libc code linked into the WebAssembly runtime.',
    license: 'MIT',
    text: readCoreLicense('musl.txt'),
  },
];

const packageRows = frontend
  .map(
    (pkg) => `<tr><td><code>${escapeHtml(pkg.name)}</code></td><td>${escapeHtml(
      pkg.version,
    )}</td><td>${escapeHtml(pkg.license)}</td></tr>`,
  )
  .join('\n');

const coreSections = core
  .map(
    (component) => `<section id="${component.id}">
<h2>${escapeHtml(component.title)}</h2>
<p>${escapeHtml(component.description)}</p>
<p class="meta">License: ${escapeHtml(component.license)}</p>
<pre>${escapeHtml(component.text)}</pre>
</section>`,
  )
  .join('\n');

const frontendSections = [...groups.values()]
  .map((group, index) => {
    const packagesInGroup = group.packages
      .map(
        (pkg) =>
          `<li><code>${escapeHtml(pkg.name)}</code> ${escapeHtml(pkg.version)}</li>`,
      )
      .join('\n');
    return `<section id="frontend-${index + 1}">
<h2>${escapeHtml(group.license)}</h2>
<ul class="packages">${packagesInGroup}</ul>
<pre>${escapeHtml(group.text)}</pre>
</section>`;
  })
  .join('\n');

const nav = [
  ...core.map(
    (component) =>
      `<a href="#${component.id}">${escapeHtml(component.title)}</a>`,
  ),
  `<a href="#frontend">Frontend packages</a>`,
  `<a href="#notes">Notes</a>`,
].join('\n');

const frontendTextPath = join(LICENSE_DIR, 'frontend-runtime.txt');
const frontendText = [
  'Third-party licenses for frontend runtime dependencies',
  '=================================================',
  '',
  'The built playground JavaScript bundle includes the following packages.',
  `Generated at build time with license-checker-rseidelsohn.`,
  '',
  ...[...groups.values()].flatMap((group) => [
    'Packages:',
    ...group.packages.map(
      (pkg) => `  ${pkg.name} ${pkg.version} (${group.license})`,
    ),
    '',
    group.text,
    '',
    '-'.repeat(79),
    '',
  ]),
].join('\n');
mkdirSync(LICENSE_DIR, { recursive: true });
writeFileSync(frontendTextPath, frontendText.trimEnd() + '\n', 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>Third-party licenses - llubi playground</title>
<style>
  :root {
    color-scheme: light dark;
    --background: #f5f6f8;
    --panel: #ffffff;
    --text: #1c2533;
    --muted: #5c6675;
    --accent: #365f91;
    --border: #cbd2dc;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #161a21;
      --panel: #202631;
      --text: #e6e9ef;
      --muted: #a7b0bd;
      --accent: #8bb8e8;
      --border: #3c4655;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--background);
    color: var(--text);
    font: 1rem/1.5 system-ui, sans-serif;
  }
  main { max-width: 68rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  header { border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.75rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 0.5rem; }
  p { margin: 0.5rem 0; }
  a { color: var(--accent); }
  .meta, .intro { color: var(--muted); }
  nav { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin: 1rem 0; }
  nav a { white-space: nowrap; }
  pre {
    margin: 0.75rem 0 0;
    padding: 1rem;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    font: 0.8125rem/1.45 ui-monospace, monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); text-align: left; }
  th { font-weight: 600; }
  .packages { columns: 2 18rem; margin: 0.5rem 0; padding-left: 1.25rem; }
  section { scroll-margin-top: 1rem; }
  .back { display: inline-block; margin-bottom: 0.75rem; }
  @media (max-width: 40rem) {
    .packages { columns: 1; }
    h1 { font-size: 1.35rem; }
  }
</style>
</head>
<body>
<main>
<header>
<a class="back" href="./">&larr; llubi playground</a>
<h1>Third-party licenses</h1>
<p class="intro">The deployed playground includes the third-party components below. Frontend package data is generated at build time from the installed production dependencies with <code>license-checker-rseidelsohn</code>.</p>
<p class="meta">Raw texts: <a href="licenses/LLVM.txt">LLVM</a> · <a href="licenses/Emscripten.txt">Emscripten</a> · <a href="licenses/musl.txt">musl</a> · <a href="licenses/frontend-runtime.txt">frontend packages</a></p>
<nav>${nav}</nav>
</header>
${coreSections}
<section id="frontend">
<h2>Frontend packages</h2>
<p class="intro">${frontend.length} production packages from the web bundle.</p>
<table>
<thead><tr><th>Package</th><th>Version</th><th>License</th></tr></thead>
<tbody>${packageRows}</tbody>
</table>
${frontendSections}
</section>
<section id="notes">
<h2>Notes</h2>
<p>Emscripten's default allocator includes dlmalloc by Doug Lea, released to the public domain under CC0. No attribution is required for dlmalloc.</p>
<p>LLVM's license file explains how third-party files inside its source tree identify their own notices; those per-file terms remain applicable.</p>
<p>LLVM is a trademark of the LLVM Foundation. This project is an independent playground and is not affiliated with or endorsed by the LLVM Project or the LLVM Foundation.</p>
<p>See also <a href="https://github.com/dtcxzyw/llubi/blob/main/THIRD_PARTY_NOTICES.md">THIRD_PARTY_NOTICES.md</a>.</p>
</section>
</main>
</body>
</html>
`;

writeFileSync(OUTPUT, html, 'utf8');
console.log(
  `[licenses] ${frontend.length} frontend packages, ${groups.size} license texts -> ${OUTPUT}`,
);
