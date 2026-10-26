import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serveFiles } from '../../server/static.js';

const files = new Map([
  ['public/index.html', Buffer.from('<script type="module" src="js/main.js"></script>')],
  ['public/audio/rifle.wav', Buffer.from('wave')],
  ['public-secret/token', Buffer.from('private')],
  ['shared-secret/token', Buffer.from('private')],
]);

async function request(url, method = 'GET') {
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers);
      return this;
    },
    end(body) {
      this.body = body;
    },
  };
  await serveFiles({ files })({ url, method }, response);
  return response;
}

test('file mounts reject encoded traversal, including siblings sharing the same prefix', async () => {
  for (const url of [
    '/%2e%2e%2fpublic-secret/token',
    '/shared/%2e%2e%2fshared-secret/token',
    '/vendor/three/%2e%2e%2fbuild-secret/token',
  ]) {
    assert.equal((await request(url)).status, 403, url);
  }
  for (const url of ['/%GG', '/%00']) assert.equal((await request(url)).status, 400);
  assert.equal((await request('/', 'POST')).status, 405);
  assert.equal((await request('/missing')).status, 404);
});

test('LAN pages and audio have correct headers and HEAD matches GET without a body', async () => {
  const get = await request('/');
  const head = await request('/', 'HEAD');
  assert.equal(get.status, 200);
  assert.match(get.body, /type="importmap"/);
  assert.equal(get.headers['x-content-type-options'], 'nosniff');
  assert.equal(get.headers['referrer-policy'], 'no-referrer');
  assert.equal(get.headers['content-length'], Buffer.byteLength(get.body));
  assert.deepEqual(head.headers, get.headers);
  assert.equal(head.body, undefined);
  assert.equal((await request('/audio/rifle.wav')).headers['content-type'], 'audio/wav');
});
