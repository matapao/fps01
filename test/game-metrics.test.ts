import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameMetrics, metricDimensions } from '../src/game-metrics.ts';
test('completed round results are numeric, emitted once and measured from play', () => {
  const reports: [string, number][] = [];
  const metrics = new GameMetrics((name, value) => reports.push([name, value]));
  metrics.complete(1000, { kills: [20], captures: [0, 0] });
  assert.deepEqual(reports, []);
  metrics.begin(1000);
  metrics.begin(9000);
  metrics.elimination();
  metrics.capture();
  metrics.complete(11000, { kills: [3, 7], captures: [1, 2] });
  metrics.complete(12000, { kills: [999], captures: [9, 9] });
  assert.deepEqual(reports, [
    ['eliminations_total', 1],
    ['captures_total', 1],
    ['rounds_total', 1],
    ['round_seconds', 10],
    ['round_kills', 7],
    ['round_captures', 3],
  ]);
  metrics.reset();
  metrics.begin(12000);
  metrics.complete(15000, { kills: [], captures: [] });
  assert.deepEqual(reports.slice(-4), [
    ['rounds_total', 1],
    ['round_seconds', 3],
    ['round_kills', 0],
    ['round_captures', 0],
  ]);
});

test('unknown maps and modes cannot contaminate standard result series', () => {
  assert.deepEqual(metricDimensions('ctf', 'fort'), { mode: 'ctf', map: 'fort' });
  assert.equal(metricDimensions('custom', 'fort'), null);
  assert.equal(metricDimensions('dm', 'custom'), null);
});
