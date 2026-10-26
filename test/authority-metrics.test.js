import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js';
import { Game } from '../server/game.js';
test('the actual game reports a finished round through its adapter port', () => {
  const reports = [];
  let now = 1000;
  const game = new Game({
    now: () => now,
    reportMetric: (name, value) => reports.push([name, value]),
  });
  const socket = { OPEN: 1, readyState: 1, send() {} };
  try {
    game.join(socket, null);
    const player = [...game.players.values()][0];
    assert(player);
    player.kills = 9;
    now = 6000;
    game.endRound(null);
    game.endRound(null);
    assert.deepEqual(
      reports.filter(([name]) => name === 'round_kills'),
      [['round_kills', 9]],
    );
    assert.deepEqual(
      reports.filter(([name]) => name === 'round_seconds'),
      [['round_seconds', 5]],
    );
  } finally {
    game.stop();
  }
});
