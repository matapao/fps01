import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import './fixtures/data.js';
import { WEAPONS } from '../shared/weapons.js';

registerHooks({
  resolve: (specifier, context, next) =>
    specifier.startsWith('/shared/')
      ? next(new URL(`..${specifier}`, import.meta.url).href, context)
      : next(specifier, context),
});
const { WeaponTips } = await import('../public/js/weapon-tips.js');

function setup(saved = null) {
  let stored = saved,
    view = null;
  const tips = new WeaponTips({
    read: () => stored,
    write: (ids) => {
      stored = JSON.stringify(ids);
    },
    show: (tip) => {
      view = tip;
    },
  });
  return { tips, view: () => view, stored: () => stored };
}

test('each shipped weapon has a brief primary and secondary lesson', () => {
  for (const spec of Object.values(WEAPONS)) {
    assert.ok(spec.tips.primary.length > 0 && spec.tips.primary.length <= 100, spec.id);
    assert.ok(spec.tips.secondary.length > 0 && spec.tips.secondary.length <= 100, spec.id);
  }
  assert.match(WEAPONS.rocket.tips.extra, /rocket jump/);
});

test('a new weapon shows prominently, pauses with the game, fades, and stays learned after reload', () => {
  const f = setup();
  f.tips.update('rocket', false, 50);
  assert.equal(f.view(), null);
  assert.equal(f.stored(), null, 'a hidden lesson has not been taught');
  f.tips.update('rocket', true, 0);
  assert.equal(f.view().name, 'Rocket launcher');
  assert.match(f.view().primary, /^Left click:/);
  assert.match(f.view().secondary, /^Right click:/);
  assert.equal(f.view().opacity, 1);
  f.tips.update('rocket', true, 2);
  assert.deepEqual(JSON.parse(f.stored()), ['rocket']);
  f.tips.update('rocket', false, 100);
  assert.equal(f.view(), null);
  f.tips.update('rocket', true, 0);
  assert.equal(f.view().opacity, 1, 'pausing does not consume reading time');
  f.tips.update('rocket', true, 4.5);
  assert.ok(f.view().opacity > 0 && f.view().opacity < 1, 'fades instead of disappearing abruptly');
  f.tips.update('rocket', true, 0.4);
  assert.equal(f.view(), null);
  const later = setup(f.stored());
  later.tips.update('rocket', true, 0);
  assert.equal(later.view(), null, 'already learned');
  later.tips.update('launcher', true, 0);
  assert.equal(later.view().name, 'Grenade launcher', 'other weapons still get their own lesson');
});

test('a lesson interrupted before it can be read remains available, with device-appropriate controls', () => {
  const f = setup();
  f.tips.update('rocket', true, 0.5);
  f.tips.update('shotgun', true, 0.1, 'pad');
  assert.match(f.view().primary, /^RT:/);
  assert.match(f.view().secondary, /^LT:/);
  f.tips.update('rocket', true, 0.1, 'touch');
  assert.match(f.view().primary, /^Fire:/);
  assert.equal(f.view().secondary, '', 'does not describe a missing touch alt-fire control');
  assert.match(f.view().extra, /floor stays intact/);
  assert.equal(f.stored(), null);
});

test('invalid or blocked storage cannot interrupt gameplay or repeat a learned lesson in this visit', () => {
  const views = [];
  const tips = new WeaponTips({
    read: () => '{bad',
    write: () => {
      throw new Error('blocked');
    },
    show: (tip) => views.push(tip),
  });
  assert.doesNotThrow(() => tips.update('rifle', true, 2));
  tips.update('shotgun', true, 0);
  tips.update('rifle', true, 0);
  assert.equal(views.at(-1), null);
  assert.doesNotThrow(
    () =>
      new WeaponTips({
        read: () => {
          throw new Error('blocked');
        },
        write() {},
        show() {},
      }),
  );
});

test('rocket jump lessons name the active fire and jump buttons, including a live device switch', () => {
  const f = setup();
  for (const [device, fire, jump] of [
    ['mouse', 'Left click', 'Space'],
    ['pad', 'RT', 'A'],
    ['touch', 'Fire', 'Jump'],
  ]) {
    f.tips.update('rocket', true, 0.1, device);
    assert.ok(f.view().extra.includes(`+ ${fire} to rocket jump`));
    assert.ok(
      f
        .view()
        .extra.includes(
          `${device === 'touch' ? `${jump}, then ${fire}` : `${jump} + ${fire}`} for more height`,
        ),
    );
    assert.doesNotMatch(f.view().extra, /[{}]/, 'no unresolved control labels');
  }
});

test('a status interruption pauses an unread lesson without learning or fading it behind the warning', () => {
  const f = setup();
  f.tips.update('rocket', true, 0.4, 'touch');
  assert.equal(f.view().opacity, 1);
  f.tips.update('rocket', false, 10, 'touch');
  assert.equal(f.view(), null);
  assert.equal(f.stored(), null, 'the hidden reading time does not count as a learned lesson');
  f.tips.update('rocket', true, 1.5, 'touch');
  assert.equal(f.view().opacity, 1);
  assert.equal(f.stored(), null);
  f.tips.update('rocket', true, 0.2, 'touch');
  assert.deepEqual(JSON.parse(f.stored()), ['rocket']);
});
