/** Shared formatter gate. Canonical source: Zirbel docs/engineering/style.mjs; synchronize, do not fork. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, getFileInfo } from 'prettier';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(await readFile(new URL('./prettier.json', import.meta.url), 'utf8'));
const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0');
const excluded =
  /(?:^|\/)(?:vendor|node_modules|dist|\.backup|three\.js|codex-one|fixtures)(?:\/|$)|\.legacy\.|(?:^|\/)package-lock\.json$/;
let failures = 0;
let checked = 0;
for (const name of [...new Set(names)].filter(Boolean).sort()) {
  if (excluded.test(name)) continue;
  const path = resolve(root, name);
  const info = await getFileInfo(path, { ignorePath: resolve(root, '.prettierignore') });
  if (info.ignored || !info.inferredParser) continue;
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue; // a tracked deletion in the working tree
    throw error;
  }
  const formatted = await format(source, { ...config, filepath: path });
  checked++;
  if (source === formatted) continue;
  if (process.argv.includes('--write')) {
    if ((await readFile(path, 'utf8')) !== source) throw new Error('File changed while formatting: ' + name);
    await writeFile(path, formatted);
  } else {
    console.error(`Format: ${name}`);
    failures++;
  }
}
console.log(`Shared formatting: ${checked} owned files, ${failures} differences.`);
process.exitCode = failures ? 1 : 0;
