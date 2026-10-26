import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageBudget } from '../shared/messages.js';
import { sendText, toDirection } from '../server/util.js';

test('input budgets allow normal gameplay, limit expensive requests, and refill with time', () => {
  let now = 0;
  const budget = new MessageBudget(() => now);
  for (let i = 0; i < 8; i++) assert.ok(budget.read('{"type":"data"}'));
  assert.equal(budget.read('{"type":"data"}'), null);
  now += 250;
  assert.ok(budget.read('{"type":"data"}'));
  for (let second = 0; second < 10; second++) {
    for (let frame = 0; frame < 60; frame++) {
      now += 1000 / 60;
      assert.ok(budget.read('{"type":"state","feet":[0,0,0]}'));
    }
  }
});

test('input requires a typed JSON object and measures UTF-8 bytes', () => {
  const budget = new MessageBudget();
  for (const data of [
    'null',
    '[]',
    'false',
    '{',
    '{}',
    '{"type":12}',
    JSON.stringify({ type: 'state', junk: '💥'.repeat(1100) }),
  ]) {
    assert.equal(budget.read(data), null);
  }
  assert.equal(budget.read(Buffer.from('{"type":"ping","t":1}')).t, 1);
});

test('stalled outbound connections are dropped instead of accumulating snapshots', () => {
  const sent = [];
  let terminated = 0;
  const socket = {
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    send: (text) => sent.push(text),
    terminate: () => terminated++,
  };
  sendText(socket, 'one');
  socket.bufferedAmount = 1024 * 1024 + 1;
  sendText(socket, 'two');
  assert.deepEqual(sent, ['one']);
  assert.equal(terminated, 1);
});

test('overflowing aim vectors cannot normalize into a zero direction', () => {
  assert.equal(toDirection([Number.MAX_VALUE, Number.MAX_VALUE, 0]), null);
  assert.deepEqual(toDirection([0, 0, -2]), [0, 0, -1]);
});

test('message input rejects objects without invoking untrusted coercion', () => {
  const budget = new MessageBudget();
  let invoked = false;
  const hostile = {
    toString() {
      invoked = true;
      throw new Error('must not coerce');
    },
  };
  for (const input of [hostile, null, undefined, 42, [], {}]) assert.equal(budget.read(input), null);
  assert.equal(invoked, false);
  const bytes = new TextEncoder().encode('{"type":"ping"}');
  assert.equal(budget.read(bytes)?.type, 'ping');
  assert.equal(budget.read(bytes.buffer)?.type, 'ping');
});
