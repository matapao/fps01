/**
 * What a layout looks like from above, for agents that build without 3D: an SVG plan of each layout
 * (data/layouts.json), drawn from the data as the engine builds it (shared/layout.js, shared/arena.js),
 * with a legend. Each half-metre column shows the top of what stands in it under the roof, in its
 * material's colour; the void, where the floor is gone, is black. Spawns, pickups, jump pads (and
 * where they throw you), the flags, the pedestal and the water are drawn over it.
 *
 *   look(data, { layout?: 'depot', region?: [x0, z0, x1, z1] })   // data: block id → its JSON
 *
 * Pure (no DOM, no fetch, no timers), and drawn in the subset of SVG a zirbel host rasterises:
 * rect, circle, line, polygon and one-line text, plain colours.
 */
import { BEAM, CELL, GRID_MIN, GRID_SIZE, buildArena, cellAt } from '../../shared/arena.js';
import { expand } from '../../shared/layout.js';

import { isGameData } from '../../shared/check.js';
export interface Legend {
  color: string;
  label: string;
}

const VOID = '#000000';
const SPAWN = '#ffffff';
const PAD = '#2fd0ff';
const PEDESTAL = '#ffb347';
const WATER = '#3fb2f0';
const FLAGS: Record<string, string> = { red: '#e8524a', blue: '#3d8bfd' };
const GAP = 6; // metres between plans, when there are several
const TITLE = 5; // metres above a plan for its name

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default function look(
  data: Record<string, unknown>,
  o: { region?: [number, number, number, number]; layout?: string } = {},
): { svg: string; legend: Legend[] } {
  if (!isGameData(data)) throw new TypeError('Cannot draw invalid game data');
  const blocks = data;
  const layouts = blocks.layouts.layouts.filter((layout) => !o.layout || layout.id === o.layout);
  if (!layouts.length) throw new Error(o.layout ? `no layout ${o.layout}` : 'no layouts');
  const materials = blocks.materials.materials;
  const place = new Map(materials.map((m, i) => [m.id, i + 1]));
  const colorOf = [VOID, ...materials.map((m) => m.color.toLowerCase())];
  const pieces = new Map(blocks.pieces.pieces.map((p) => [p.id, p]));
  const lib = { pieces, prefabs: new Map(blocks.prefabs.prefabs.map((p) => [p.id, p])) };
  const [x0, z0, x1, z1] = o.region ?? [GRID_MIN[0], GRID_MIN[2], -GRID_MIN[0], -GRID_MIN[2]];
  const width = x1 - x0;
  const depth = z1 - z0;
  const used = new Map<string, string>(); // colour → label, in the legend
  const parts: string[] = [];

  layouts.forEach((layout, n) => {
    const map = expand(layout, lib, () => [0, 0, 0]);
    const left = n * (width + GAP); // where this plan's x0 is drawn
    const ox = left - x0;
    const oz = TITLE - z0;
    parts.push(
      `<text x="${fmt(left)}" y="${fmt(TITLE - 1.6)}" font-size="3" fill="#ffffff">${esc(`${layout.name} (${layout.id})`)}</text>`,
    );
    parts.push(`<g transform="translate(${fmt(ox)} ${fmt(oz)})">`);
    parts.push(
      `<rect x="${fmt(x0)}" y="${fmt(z0)}" width="${fmt(width)}" height="${fmt(depth)}" fill="${VOID}"/>`,
    );
    // The arena as the engine builds it, and the top of each column under the roof.
    const cells = buildArena(
      {
        ...map,
        floor: place.get(map.floor) ?? 0,
        roof: { ...map.roof, m: place.get(map.roof.m) ?? 0 },
        boxes: map.boxes.map((b) => ({ ...b, m: b.m === 'air' ? 0 : (place.get(b.m) ?? 0) })),
      },
      map.flags && Object.keys(map.flags).length ? 'ctf' : 'dm',
      (id: string) => place.get(id) ?? 0,
    );
    const [nx, , nz] = GRID_SIZE;
    const below = cellAt(layout.roof.at - BEAM + 0.01, 1); // the beam and the roof above it are left out
    const top = new Uint8Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        for (let iy = below - 1; iy >= 0; iy--) {
          const m = cells[ix + nx * (iz + nz * iy)]!;
          if (m) {
            top[ix + nx * iz] = m;
            break;
          }
        }
      }
    }
    // Columns of one colour, merged into rectangles: runs along x, grown down z while they match.
    const lo = [Math.max(0, cellAt(x0, 0)), Math.max(0, cellAt(z0, 2))];
    const hi = [Math.min(nx, cellAt(x1 - 0.001, 0) + 1), Math.min(nz, cellAt(z1 - 0.001, 2) + 1)];
    const done = new Uint8Array(nx * nz);
    for (let iz = lo[1]!; iz < hi[1]!; iz++) {
      for (let ix = lo[0]!; ix < hi[0]!; ix++) {
        const k = ix + nx * iz;
        if (done[k]) continue;
        const m = top[k]!;
        let run = 1;
        while (ix + run < hi[0]! && !done[k + run] && top[k + run] === m) run++;
        let rows = 1;
        grow: while (iz + rows < hi[1]!) {
          for (let dx = 0; dx < run; dx++)
            if (done[k + nx * rows + dx] || top[k + nx * rows + dx] !== m) break grow;
          rows++;
        }
        for (let dz = 0; dz < rows; dz++) for (let dx = 0; dx < run; dx++) done[k + nx * dz + dx] = 1;
        if (!m) continue;
        const color = colorOf[m]!;
        used.set(color, materials[m - 1]!.name ?? materials[m - 1]!.id);
        parts.push(
          `<rect x="${fmt(GRID_MIN[0] + ix * CELL)}" y="${fmt(GRID_MIN[2] + iz * CELL)}" width="${fmt(run * CELL)}" height="${fmt(rows * CELL)}" fill="${color}"/>`,
        );
      }
    }
    // The water, the skylights' outlines, and what's placed on the map.
    if (map.pool) {
      const { min, max } = map.pool;
      parts.push(
        `<rect x="${fmt(min[0])}" y="${fmt(min[2])}" width="${fmt(max[0] - min[0])}" height="${fmt(max[2] - min[2])}" fill="${WATER}" fill-opacity="0.45"/>`,
      );
      used.set(WATER, 'water');
    }
    for (const [x, z, w, d] of map.roof.skylights as [number, number, number, number][]) {
      parts.push(
        `<rect x="${fmt(x - w / 2)}" y="${fmt(z - d / 2)}" width="${fmt(w)}" height="${fmt(d)}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.25"/>`,
      );
    }
    for (const { at, to } of map.pads) {
      parts.push(
        `<line x1="${fmt(at[0])}" y1="${fmt(at[2])}" x2="${fmt(to[0])}" y2="${fmt(to[2])}" stroke="${PAD}" stroke-width="0.25"/>`,
      );
      parts.push(
        `<circle cx="${fmt(at[0])}" cy="${fmt(at[2])}" r="1" fill="${PAD}" stroke="#000000" stroke-width="0.15"/>`,
      );
      parts.push(
        `<polygon points="${fmt(to[0])},${fmt(to[2] - 0.7)} ${fmt(to[0] + 0.7)},${fmt(to[2])} ${fmt(to[0])},${fmt(to[2] + 0.7)} ${fmt(to[0] - 0.7)},${fmt(to[2])}" fill="${PAD}"/>`,
      );
      used.set(PAD, 'jump pad, and where it throws you');
    }
    for (const at of map.spawns) {
      parts.push(
        `<circle cx="${fmt(at[0])}" cy="${fmt(at[2])}" r="0.55" fill="${SPAWN}" stroke="#000000" stroke-width="0.15"/>`,
      );
      used.set(SPAWN, 'spawn');
    }
    for (const { piece, at } of map.items) {
      const spec = pieces.get(piece);
      const color = (spec?.color ?? '#ffffff').toLowerCase();
      const gives = spec?.components?.find((c) => c.type === 'pickup')?.gives;
      const letter = gives === 'weapon' ? 'W' : gives === 'armor' ? 'A' : 'H';
      parts.push(
        `<circle cx="${fmt(at[0])}" cy="${fmt(at[2])}" r="0.9" fill="${color}" stroke="#000000" stroke-width="0.15"/>`,
      );
      parts.push(
        `<text x="${fmt(at[0])}" y="${fmt(at[2] + 0.45)}" font-size="1.2" text-anchor="middle" fill="#000000">${letter}</text>`,
      );
      used.set(color, `pickup: ${spec?.name ?? piece}`);
    }
    for (const [team, at] of Object.entries(map.flags ?? {})) {
      const color = FLAGS[team] ?? '#ffffff';
      parts.push(
        `<polygon points="${fmt(at[0] - 1)},${fmt(at[2] + 1)} ${fmt(at[0] + 1)},${fmt(at[2] + 1)} ${fmt(at[0])},${fmt(at[2] - 1.2)}" fill="${color}" stroke="#000000" stroke-width="0.15"/>`,
      );
      used.set(color, `${team} flag`);
    }
    if (map.pedestal) {
      parts.push(
        `<circle cx="${fmt(map.pedestal[0])}" cy="${fmt(map.pedestal[2])}" r="1.2" fill="none" stroke="${PEDESTAL}" stroke-width="0.35"/>`,
      );
      used.set(PEDESTAL, 'pedestal (powerups)');
    }
    parts.push('</g>');
  });

  const legend = [...used].map(([color, label]) => ({ color, label }));
  legend.push({ color: VOID, label: 'the void: no floor' });
  // The legend under the plans, in columns.
  const rows = Math.ceil(legend.length / 3);
  const totalWidth = layouts.length * width + (layouts.length - 1) * GAP;
  const columnWidth = totalWidth / 3;
  const legendTop = TITLE + depth + 3;
  legend.forEach(({ color, label }, i) => {
    const x = Math.floor(i / rows) * columnWidth;
    const y = legendTop + (i % rows) * 2.4;
    parts.push(
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="1.8" height="1.8" fill="${color}" stroke="#000000" stroke-width="0.1"/>`,
    );
    parts.push(
      `<text x="${fmt(x + 2.6)}" y="${fmt(y + 1.5)}" font-size="1.6" fill="#ffffff">${esc(label)}</text>`,
    );
  });
  const totalHeight = legendTop + rows * 2.4 + 1;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(-1)} 0 ${fmt(totalWidth + 2)} ${fmt(totalHeight)}" width="${Math.round((totalWidth + 2) * 10)}" height="${Math.round(totalHeight * 10)}">` +
    `<rect x="-1" y="0" width="${fmt(totalWidth + 2)}" height="${fmt(totalHeight)}" fill="#14181f"/>` +
    parts.join('') +
    '</svg>';
  return { svg, legend };
}
