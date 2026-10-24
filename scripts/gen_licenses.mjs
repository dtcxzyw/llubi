#!/usr/bin/env node
/*
 * Generate the third-party license data used by the playground modal.
 *
 * Frontend package data comes from the installed production dependency tree
 * via license-checker-rseidelsohn. Core toolchain notices are copied into
 * web/public/licenses by scripts/build.py beforehand.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB = join(ROOT, 'web');
const PUBLIC = join(WEB, 'public');
const LICENSE_DIR = join(PUBLIC, 'licenses');
const OUTPUT = join(PUBLIC, 'licenses.json');
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

function packageKey(name, version) {
  return `${name}@${version}`;
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

const frontendPackages = Object.entries(packages)
  .map(([key, info]) => {
    const separator = key.lastIndexOf('@');
    const name = key.slice(0, separator);
    const version = key.slice(separator + 1);
    return {
      name,
      version,
      license: licenseName(info.licenses),
      text: readLicense(
        info.licenseFile,
        `License text for ${name}@${version} is available from its package repository.`,
      ),
    };
  })
  .sort((left, right) =>
    packageKey(left.name, left.version).localeCompare(
      packageKey(right.name, right.version),
    ),
  );

const groups = new Map();
for (const pkg of frontendPackages) {
  const key = `${pkg.license}\u0000${pkg.text}`;
  if (!groups.has(key)) {
    groups.set(key, {
      license: pkg.license,
      text: pkg.text,
      packages: [],
    });
  }
  groups.get(key).packages.push({
    name: pkg.name,
    version: pkg.version,
  });
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
    raw: 'licenses/LLVM.txt',
    text: readCoreLicense('LLVM.txt'),
  },
  {
    id: 'emscripten',
    title: 'Emscripten',
    description:
      'The WebAssembly toolchain and generated JavaScript loader/runtime.',
    license: 'MIT / University of Illinois/NCSA',
    raw: 'licenses/Emscripten.txt',
    text: readCoreLicense('Emscripten.txt'),
  },
  {
    id: 'musl',
    title: 'musl libc',
    description: 'libc code linked into the WebAssembly runtime.',
    license: 'MIT',
    raw: 'licenses/musl.txt',
    text: readCoreLicense('musl.txt'),
  },
];

const data = {
  core,
  frontend: {
    packages: frontendPackages.map(({ name, version, license }) => ({
      name,
      version,
      license,
    })),
    licenseGroups: [...groups.values()],
  },
};

mkdirSync(PUBLIC, { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(
  `[licenses] ${frontendPackages.length} frontend packages, ${groups.size} license texts -> ${OUTPUT}`,
);
