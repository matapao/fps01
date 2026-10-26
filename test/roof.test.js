// The roof and its pillars (server/roof.js): a pillar blown through cracks the roof, the roof comes
// down where nothing near enough holds it, and blasts tear bigger holes in it. On a fake clock.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { Game } from '../server/game.js';
import { roofHole } from '../server/roof.js';
import { GRID_SIZE, MAPS, PILLARS } from '../shared/map.js';
import { cellOf } from '../shared/voxels.js';
import { PROJECTILES } from '../shared/weapons.js';

function setup(map) {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now, restore: { map } });
  const sent = [];
  game.broadcast = (message) => sent.push(message);
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      clock.now += 1000 / 30;
      game.tick(1 / 30);
    }
  };
  const at = (x, y, z) => game.world.get(cellOf(x, 0), cellOf(y, 1), cellOf(z, 2));
  // Blows a pillar right through, 2 m up.
  const cut = ([x, z]) => game.carve([x, 2, z], 1.6);
  return { game, sent, run, at, cut };
}

const pillar = (x, z) => PILLARS.findIndex((p) => p[0] === x && p[1] === z);
const ROOF = MAPS.canal.roof.at; // 13 m up

test('a pillar blown right through holds nothing up any more: the roof cracks round its top, and bits of it come away', () => {
  const { game, sent, cut } = setup('canal');
  const n = pillar(37, 18);
  cut(PILLARS[n]);
  assert.equal(game.roof.standing[n], false);
  assert.equal(game.roof.standing.filter(Boolean).length, PILLARS.length - 1, 'the others stand');
  assert.deepEqual(
    sent.find((m) => m.type === 'crack')?.at,
    [37, ROOF - 1, 18],
    'at its top, under the beam',
  );
  assert.ok(
    sent.some((m) => m.type === 'fall'),
    'bits of the roof come down',
  );
});

test("a pillar chipped through by a planet's pieces brings bits of the roof down on nobody", () => {
  const { game, sent } = setup('canal');
  const n = pillar(37, 18);
  game.carve([37, 2, 18], 1.6, null, { harmless: true });
  assert.equal(game.roof.standing[n], false);
  assert.ok(
    sent.some((m) => m.type === 'fall'),
    'bits of the roof come down',
  );
  assert.ok(
    [...game.physics.falling.values()].every((fall) => fall.harmless),
    'all of them harmless',
  );
});

test('with the pillars along a stretch of the edge gone, the roof over it comes down, and the rest holds', () => {
  const { game, run, at, cut } = setup('canal');
  for (const z of [12, 18, 24]) cut(PILLARS[pillar(37, z)]);
  run(3);
  assert.equal(at(37, ROOF + 0.25, 18), 0, 'the roof over the rim there has gone');
  assert.equal(at(37, ROOF - 0.75, 18), 0, 'and the beam under it');
  assert.notEqual(at(37, ROOF + 0.25, -18), 0, 'farther along the edge it holds');
  assert.notEqual(at(30, ROOF + 0.25, 18), 0, 'and so does the roof inside it');
  assert.equal(game.roof.standing.filter(Boolean).length, PILLARS.length - 3);
});

test('with no pillar left standing, the whole roof comes down', () => {
  const { game, sent, run, cut } = setup('canal');
  for (const p of PILLARS) cut(p);
  run(4);
  assert.ok(sent.filter((m) => m.type === 'fall').length > 20, 'in slabs');
  const [nx, , nz] = GRID_SIZE;
  const layer = cellOf(MAPS['canal'].roof.at + 0.01, 1);
  let left = 0;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) if (game.world.get(ix, layer, iz)) left++;
  assert.equal(left, 0, `none of it left up there: ${left} cells`);
  assert.equal(game.physics.falling.size, 0, 'all of it down');
});

test('a blast against the roof, the beam or a pillar tears a bigger hole there, and bigger again in a corner of them', () => {
  const { game, sent, run } = setup('depot'); // the roof 15 m up
  const world = game.world;
  assert.equal(roofHole(world, [-20, 1, 14.5], 2), 2, 'out in the open');
  assert.equal(roofHole(world, [-20, 14.7, 14.5], 2), 2.6, 'just under the roof');
  assert.equal(roofHole(world, [35.7, 14.7, 21], 2), 3.4, 'in the corner of the roof and the beam');
  const canal = setup('canal');
  assert.equal(roofHole(canal.game.world, [35.7, 0.3, 0], 2), 3.4, 'at the foot of a pillar');

  const socket = { readyState: 1, OPEN: 1, send() {}, on() {} };
  game.join(socket, 'Ada');
  const ada = game.bySocket.get(socket);
  ada.feet = [-20, 0, 14.5];
  game.arsenal.launch(ada, 'rocket', [0, 1, 0], [0, 0, 0]); // straight up
  run(1.5);
  const boom = sent.find((m) => m.type === 'boom' && m.kind === 'rocket');
  assert.ok(boom && Math.abs(boom.at[1] - 15) < 0.5, `it went off at the roof: ${boom?.at}`);
  assert.equal(boom.hole, Math.round(PROJECTILES.rocket.blast.hole * 1.3 * 1000) / 1000);
});

test('a piece that falls a long way shatters where it lands', () => {
  const { sent, run, at, game } = setup('canal');
  for (const x of [-11, 11]) game.carve([x, 7.75, 11.5], 2); // both ends of a bridge between the house roofs, 8 m up
  const fall = sent.find((m) => m.type === 'fall');
  assert.ok(fall, 'its middle comes loose');
  assert.ok(fall.drop >= 5, `falling ${fall.drop} m`);
  run(fall.ms / 1000 + 0.1);
  const landed = sent.find((m) => m.type === 'landed' && m.id === fall.id);
  assert.deepEqual(landed.entry, ['d'], 'none of it is left lying there');
  assert.equal(at(0, 7.75, 11.5), 0);
});
