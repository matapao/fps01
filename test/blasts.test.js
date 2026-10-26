// Blasts, the arena and the void, on a fake clock, with players on stand-in connections: on the Fort,
// against the chapel's west wall (x = -6 … -5); and the hook, on the Canal.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/data.js'; // the data the tests play by
import { HASH } from '../shared/data.js';
import { Game } from '../server/game.js';
import { HOOK_RANGE, MAX_HEALTH, NADE_SELF_DAMAGE } from '../shared/constants.js';
import { AIR, SPAWNS, VOID_Y } from '../shared/map.js';
import { cellOf } from '../shared/voxels.js';
import { PROJECTILES } from '../shared/weapons.js';

const Y = 0; // the floor
const FRAG = PROJECTILES.frag;

function setup(map = 'fort') {
  const clock = { now: 1_000_000 };
  const game = new Game({ protectionMs: 0, now: () => clock.now, restore: { map } });
  const sent = [];
  game.broadcast = (message) => sent.push(message);
  const add = (name, feet) => {
    const socket = { readyState: 1, OPEN: 1, send() {}, on() {} };
    game.join(socket, name);
    const player = game.bySocket.get(socket);
    player.feet = [...feet];
    return player;
  };
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      clock.now += 1000 / 30;
      game.tick(1 / 30);
    }
  };
  // A grenade from the launcher, a frag unless it says otherwise, from where the player stands.
  const launch = (player, dir, kind = 'frag') => game.arsenal.launch(player, kind, dir, [0, 0, 0]);
  return { game, clock, sent, add, run, launch };
}

const away = [0, 0.3, -1].map((v, _, a) => v / Math.hypot(...a));

test("a launcher grenade goes off where it hits and tears a hole in the floor, or in the fort's back wall, with space beyond", () => {
  const { game, clock, sent, add, run } = setup();
  const ada = add('Ada', [-16, Y, 0]);
  const shoot = (dir) => game.arsenal.launch(ada, 'frag', dir, [0, 0, 0]);
  shoot([0.6, -0.8, 0]); // at the floor in front of her
  ada.feet = [-16, Y, -12]; // out of the blast
  run(0.5);
  const boom = sent.find((m) => m.type === 'boom');
  assert.ok(boom, 'it went off');
  assert.equal(boom.hole, FRAG.blast.hole);
  assert.ok(Math.abs(boom.at[1] - Y) < 0.3, `on the floor, at ${boom.at}`);
  const cell = (x, y, z) => game.world.get(cellOf(x, 0), cellOf(y, 1), cellOf(z, 2));
  assert.equal(cell(boom.at[0], Y - 0.25, boom.at[2]), AIR, 'a hole in the floor');
  assert.deepEqual(
    game.world.history.filter((entry) => typeof entry[0] === 'number'),
    [[...boom.at, FRAG.blast.hole]],
  );

  clock.now += 700;
  ada.feet = [-34, Y, -8];
  shoot([-1, 0, 0]); // point-blank at the fort's back wall
  run(0.5);
  assert.equal(cell(-35.75, Y + 1.6, -8), AIR, 'a hole in the wall');
  assert.equal(
    game.world.raycast([-35, Y + 1.6, -8], [-1, 0, 0], 100),
    null,
    'and nothing out there but stars',
  );
});

test('a blast throws grenades close by about', () => {
  const { game, add, run, launch } = setup();
  const ada = add('Ada', [-12, Y, -12]);
  launch(ada, [0, -1, 0], 'bouncer');
  run(0.3);
  const [bouncer] = game.arsenal.flying.values();
  const before = Math.hypot(...bouncer.vel);
  detonate(game, ada, 'frag', [bouncer.pos[0] + 1.5, bouncer.pos[1], bouncer.pos[2]]);
  assert.ok(
    Math.hypot(...bouncer.vel) > before + 5 && bouncer.vel[0] < -3,
    `thrown away from it: ${bouncer.vel.map((v) => v.toFixed(1))}`,
  );
});

// Sets something of the given kind off at a point, as if it had just hit something there.
function detonate(game, owner, kind, pos) {
  const shot = { id: game.arsenal.nextId++, owner: owner.id, kind, pos, vel: [0, 0, 0], born: 0, fuseAt: 0 };
  game.arsenal.flying.set(shot.id, shot);
  game.arsenal.explode(shot);
}

test('a direct hit explodes on contact and kills', () => {
  const { game, sent, add, run, launch } = setup();
  const ada = add('Ada', [-10, Y, 12]);
  const bo = add('Bo', [-7, Y, 12]);
  launch(ada, [1, -0.1, 0]);
  run(0.4);
  assert.equal(bo.alive, false);
  assert.deepEqual(
    sent.find((m) => m.type === 'kill'),
    {
      type: 'kill',
      killer: ada.id,
      victim: bo.id,
      head: false,
      weapon: 'nade',
      spree: 1,
      multi: 1,
      first: true,
    },
  );
  assert.equal(ada.kills, 1);
});

test('a blast hurts less farther away, and walls block it', () => {
  const { game, add } = setup();
  const bomber = add('Bomber', [15, Y, -15]);
  const near = add('Near', [-9.5, Y, 2.25]); // 1.1 m from the blast
  const far = add('Far', [-8, Y, 5.75]); // 3.1 m away
  const hidden = add('Hidden', [-4.5, Y, 2.25]); // 3.1 m away, but behind the chapel's wall
  detonate(game, bomber, 'frag', [-8, Y + FRAG.size, 2.25]);
  const { damage, radius } = FRAG.blast;
  assert.equal(near.hp, MAX_HEALTH - Math.round(damage * (1 - 1.1 / radius)));
  assert.equal(far.hp, MAX_HEALTH - Math.round(damage * (1 - 3.1 / radius)));
  assert.equal(hidden.hp, MAX_HEALTH);
  assert.equal(bomber.hp, MAX_HEALTH, 'far away');
});

test('your own grenade hurts you half as much, and blowing yourself up is no kill', () => {
  const { game, sent, add } = setup();
  const ada = add('Ada', [5, Y, 15]);
  detonate(game, ada, 'frag', [5, Y + FRAG.size, 15]);
  assert.equal(ada.hp, MAX_HEALTH - FRAG.blast.damage * NADE_SELF_DAMAGE);
  detonate(game, ada, 'frag', [5, Y + FRAG.size, 15]);
  assert.equal(ada.alive, false);
  assert.equal(ada.kills, 0);
  assert.deepEqual(
    sent.find((m) => m.type === 'kill'),
    { type: 'kill', killer: ada.id, victim: ada.id, head: false, weapon: 'nade' },
  );
});

test('falling into the void kills you, and counts as a kill for whoever hurt you just before', () => {
  const { game, clock, sent, add } = setup();
  const ada = add('Ada', [-15, Y, 0]);
  const bo = add('Bo', [15, Y, 0]);
  game.damage(bo, ada, 10, { weapon: 'nade' });
  game.move(ada, { feet: [-15, VOID_Y - 0.5, 0] });
  assert.deepEqual(
    sent.find((m) => m.type === 'kill'),
    {
      type: 'kill',
      killer: bo.id,
      victim: ada.id,
      head: false,
      weapon: 'void',
      spree: 1,
      multi: 1,
      first: true,
    },
  );
  assert.equal(bo.kills, 1);

  sent.length = 0;
  game.damage(ada, bo, 10, { weapon: 'nade' });
  clock.now += 60_000; // long enough ago that it doesn't count
  game.move(bo, { feet: [15, VOID_Y - 0.5, 0] });
  assert.equal(sent.find((m) => m.type === 'kill').killer, null);
  assert.equal(ada.kills, 0);
});

test('you spawn only where there is still floor to stand on, and with none left the arena goes back up', () => {
  const { game, sent, add } = setup();
  const ada = add('Ada', [0, Y, 0]);
  const spots = () => {
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      game.spawn(ada);
      seen.add(ada.feet.join());
    }
    return seen;
  };
  assert.ok(spots().size > 5, 'all over the map');
  const [gone, ...rest] = SPAWNS;
  game.world.carve([gone[0], Y - 0.25, gone[2]], 1);
  assert.equal(spots().has(gone.join()), false, 'not where the floor has been blown away');
  for (const [x, , z] of rest) game.world.carve([x, Y - 0.25, z], 1);
  sent.length = 0;
  game.spawn(ada);
  assert.deepEqual(
    sent.find((m) => m.type === 'world'),
    { type: 'world', mode: 'dm', map: 'fort', history: [], water: 0, planets: [], data: HASH, revision: '' },
  );
  assert.deepEqual(game.world.history, []);
  assert.ok(SPAWNS.some((feet) => feet.join() === ada.feet.join()));
});

test('everyone sees where your grappling hook caught, if it is somewhere you could not walk to', () => {
  const { game, add } = setup('canal');
  const ada = add('Ada', [-32, Y, -16]);
  const hookOf = () => (game.snapshot(), game.players.get(ada.id).hook);
  game.sockets.add(ada.socket);
  game.hook(ada, { at: [-32, Y + 10.25, -21.5] }); // the lip round the top of the tower in the west square, 10.5 m up
  assert.deepEqual(hookOf(), [-32, Y + 10.25, -21.5]);
  game.hook(ada, { at: [-32, Y + 10.25, HOOK_RANGE * 2] });
  assert.deepEqual(hookOf(), [-32, Y + 10.25, -21.5], 'too far: ignored');
  game.hook(ada, { at: null });
  assert.equal(hookOf(), null);
  game.hook(ada, { at: [-32, Y, -14] }); // the floor she stands on
  assert.equal(hookOf(), null, 'somewhere she can walk to: ignored');
  game.hook(ada, { at: [-32, Y + 4, -14] }); // in mid-air
  assert.equal(hookOf(), null, 'nothing there to catch on');
});

test('the server accepts a hook on a flat overhead bridge despite a walking route', () => {
  const { game, add } = setup('canal');
  const ada = add('Ada', [10, Y, 11.5]);
  game.hook(ada, { at: [10, 7.5, 11.5] });
  assert.deepEqual(ada.hook, [10, 7.5, 11.5]);
  game.hook(ada, { at: null });
  ada.feet = [12, Y, 0];
  game.hook(ada, { at: [0, 2.5, 0] });
  assert.equal(ada.hook, null, 'the bridge side still blocks a hidden point on top');
});
