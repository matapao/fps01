import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { startServer } from '../../server/index.js';

let server;
before(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' });
});
after(() => server.close());
const address = () => `127.0.0.1:${server.port}`;
const connect = (origin) => new WebSocket(`ws://${address()}/ws`, origin ? { origin } : {});

test('LAN connections accept the served origin and native clients, and reject foreign websites', async () => {
  for (const origin of [undefined, `http://${address()}`]) {
    const client = connect(origin);
    await once(client, 'open');
    const closed = once(client, 'close');
    client.close();
    await closed;
  }
  for (const origin of ['https://other.example', 'null', `http://${address()}.evil.example`]) {
    const client = connect(origin);
    await assert.rejects(once(client, 'open'), /403/);
  }
});

test('an oversized frame closes its connection while the server remains available', async () => {
  const client = connect();
  await once(client, 'open');
  // The server closes or terminates the offending connection, without an unhandled error.
  const closed = once(client, 'close');
  client.send('x'.repeat(5000));
  await closed;
  const healthy = connect();
  await once(healthy, 'open');
  const done = once(healthy, 'close');
  healthy.close();
  await done;
  assert.equal((await fetch(`http://${address()}/`)).status, 200);
});
