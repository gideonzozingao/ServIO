// Adds `.js` to relative import/export specifiers in src/**/*.ts (required for ESM / nodenext).
// Safe for CommonJS builds too. Skips specifiers that already have an extension. Idempotent.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src', import.meta.url).pathname;
const skip = new Set(['generated']);
const re = /(\b(?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]+?)(['"])/g;
let changed = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!skip.has(name)) walk(p); continue; }
    if (!p.endsWith('.ts')) continue;
    const src = readFileSync(p, 'utf8');
    const out = src.replace(re, (m, a, spec, b) => (/\.(c|m)?js$|\.json$/.test(spec) ? m : `${a}${spec}.js${b}`));
    if (out !== src) { writeFileSync(p, out); changed++; }
  }
}
walk(root);
console.log(`updated ${changed} files`);
