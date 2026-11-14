import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/build-pages.ts');

function fixture(t: { after: (fn: () => void) => void }, failBuild = false) {
  const dir = mkdtempSync(join(tmpdir(), 'moemail-build-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'bin'));
  for (const command of ['vercel', 'next-on-pages']) {
    writeFileSync(join(dir, 'bin', command), `#!${process.execPath}
require('node:fs').appendFileSync('calls', ${JSON.stringify(command)} + ' ' + process.argv.slice(2).join(' ') + '\\n');
process.exit(${failBuild && command === 'vercel' ? 1 : 0});
`, { mode: 0o700 });
  }
  return {
    dir,
    run: () => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), script], {
      cwd: dir,
      env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
      encoding: 'utf8',
    }),
    calls: () => readFileSync(join(dir, 'calls'), 'utf8'),
  };
}

test('Pages build uses local CLIs in order and initializes offline project settings', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls(), 'vercel build\nnext-on-pages --skip-build\n');
  assert.deepEqual(JSON.parse(readFileSync(join(f.dir, '.vercel/project.json'), 'utf8')), {
    projectId: '_', orgId: '_', settings: { framework: 'nextjs' },
  });
});

test('Pages build preserves existing project settings on repeated runs', t => {
  const f = fixture(t);
  mkdirSync(join(f.dir, '.vercel'));
  const project = '{"projectId":"existing-project","settings":{"framework":"nextjs"}}';
  writeFileSync(join(f.dir, '.vercel/project.json'), project);
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(readFileSync(join(f.dir, '.vercel/project.json'), 'utf8'), project);
});

test('failed Vercel build stops before converting stale output', t => {
  const f = fixture(t, true);
  assert.notEqual(f.run().status, 0);
  assert.equal(f.calls(), 'vercel build\n');
});
