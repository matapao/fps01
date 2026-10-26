// Writes the data's JSON files (data/*.json) in one style: anything that fits on a line of 120
// characters stays on one line, everything else is spread out, two spaces at a time.
//
//   node tools/format-data.js [files…]   (every file in data/ when none are named)

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WIDTH = 120;

// value as JSON on one line: [1, 2], { "a": 1 }.
/** @param {unknown} value @returns {string} */
function flat(value) {
  if (Array.isArray(value)) return `[${value.map(flat).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    return entries.length
      ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${flat(v)}`).join(', ')} }`
      : '{}';
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Value is not JSON serializable');
  return json;
}

// value as JSON, starting `used` characters into a line indented by indent.
/** @param {unknown} value @param {string} indent @param {number} used @returns {string} */
export function format(value, indent = '', used = indent.length) {
  const line = flat(value);
  if (used + line.length <= WIDTH || typeof value !== 'object' || value === null) return line;
  const inner = indent + '  ';
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + format(v, inner)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value)
    .map(([k, v]) => {
      const key = `${inner}${JSON.stringify(k)}: `;
      return key + format(v, inner, key.length);
    })
    .join(',\n')}\n${indent}}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync(join(ROOT, 'data'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(ROOT, 'data', name));
  for (const file of files) writeFileSync(file, format(JSON.parse(readFileSync(file, 'utf8'))) + '\n');
  console.log(`formatted ${files.length} files`);
}
