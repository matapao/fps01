// Data contracts mirror the runtime JSON schemas; schemas remain the authority for untrusted data.
export type Vector3 = [number, number, number];
export type Axis = 0 | 1 | 2;
export type Pieces = {
  pieces: {
    id: string;
    name: string;
    about?: string;
    asset?:
      | 'pickups/health'
      | 'pickups/orb'
      | 'pickups/armor'
      | 'pickups/weapon'
      | 'props/jump-pad'
      | 'props/pedestal'
      | 'props/flag';
    color?: string;
    sound?:
      | 'sounds/shot'
      | 'sounds/shotgun'
      | 'sounds/launch'
      | 'sounds/rocket'
      | 'sounds/zap'
      | 'sounds/overload'
      | 'sounds/rail'
      | 'sounds/boom'
      | 'sounds/empty'
      | 'sounds/clink'
      | 'sounds/click'
      | 'sounds/step'
      | 'sounds/pad'
      | 'sounds/dodge'
      | 'sounds/kick'
      | 'sounds/pickup-weapon'
      | 'sounds/pickup-armor'
      | 'sounds/pickup-orb'
      | 'sounds/pickup-health'
      | 'sounds/medal'
      | 'sounds/strike'
      | 'sounds/powerup'
      | 'sounds/crate'
      | 'sounds/baa'
      | 'sounds/teleport'
      | 'sounds/chew'
      | 'sounds/creak'
      | 'sounds/crash'
      | 'sounds/pour'
      | 'sounds/splash'
      | 'sounds/planet'
      | 'sounds/toss'
      | 'sounds/thrown'
      | 'sounds/charge'
      | 'sounds/hit'
      | 'sounds/hurt'
      | 'sounds/hook'
      | 'sounds/flourish'
      | 'sounds/choir'
      | 'sounds/rumble';
    cells?: GeometryPart[];
    components?: (PiecesPickup | PiecesJumppad)[];
  }[];
};
export type PiecesPickup = {
  type: 'pickup';
  gives: 'health' | 'armor' | 'weapon';
  amount?: number;
  cap?: number;
  weapon?: string;
  respawnMs: number;
  warnMs?: number;
};
export type PiecesJumppad = { type: 'jumpPad'; clear?: number };
export type Characters = {
  health: { start: number; max: number; overheal: number };
  armor: { max: number };
  decay: { above: number; perSecond: number };
  colors: string[];
  teams: { red: { name: string; color: string }; blue: { name: string; color: string } };
};
export type Projectiles = {
  projectiles: {
    id: string;
    speed: number;
    gravity: number;
    size: number;
    fuseMs: number;
    bounce?: number;
    steer?: boolean;
    split?: { into: string; count: number };
    blast?: { damage: number; radius: number; hole: number; push: number };
    hit?: { damage: number; headshot: number };
    credit?: string;
    model:
      | 'projectiles/grenade'
      | 'projectiles/bouncer'
      | 'projectiles/rocket'
      | 'projectiles/mortar'
      | 'projectiles/bomblet'
      | 'projectiles/splitter'
      | 'projectiles/splitter-bit'
      | 'projectiles/choir'
      | 'projectiles/missile'
      | 'projectiles/pilot'
      | 'projectiles/ball';
  }[];
};
export type Layouts = {
  layouts: {
    id: string;
    name: string;
    about?: string;
    floor: string;
    roof: { at: number; m: string; skylights?: { at: [number, number]; size: [number, number] }[] };
    look: { sky: string; ground: string; sun: string };
    parts: GeometryPart[];
    spawns: {
      at: [number, number, number];
      mirror?: 'x' | 'z' | 'xz' | 'point';
      repeat?: { count: number; step: [number, number, number] };
      about?: string;
    }[];
    pickups?: {
      piece: string;
      at: [number, number, number];
      mirror?: 'x' | 'z' | 'xz' | 'point';
      repeat?: { count: number; step: [number, number, number] };
      about?: string;
    }[];
    pads?: {
      piece?: string;
      at: [number, number, number];
      to: [number, number, number];
      clear?: number;
      mirror?: 'x' | 'z' | 'xz' | 'point';
      repeat?: { count: number; step: [number, number, number] };
      about?: string;
    }[];
    zones?: {
      flags?: { red: [number, number, number]; blue: [number, number, number] };
      pedestal?: [number, number, number];
      pool?: {
        name: string;
        min: [number, number, number];
        max: [number, number, number];
        basin: { min: [number, number, number]; max: [number, number, number] };
      };
    };
  }[];
};
export type Hud = {
  crosshair: { shape: 'cross' | 'cross-dot' | 'dot' | 'circle' | 't'; color: string; spread: boolean };
  fov: number;
  look: { mouse: number; touch: number };
  touch: { reach: number; dead: number; side: number };
  ping: boolean;
  pad?: { look: number; dead: number; curve: number };
};
export type Geometry = GeometryPart;
export type GeometryBox = {
  type: 'box';
  min: [number, number, number];
  max: [number, number, number];
  m: string;
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryBlock = {
  type: 'block';
  at: [number, number, number];
  size: [number, number, number];
  m: string;
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryHole = {
  type: 'hole';
  at: [number, number, number];
  size: [number, number, number];
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryFloor = {
  type: 'floor';
  at: [number, number, number];
  size: [number, number];
  thick?: number;
  m: string;
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryWalls = {
  type: 'walls';
  at: [number, number, number];
  size: [number, number, number];
  thick?: number;
  m: string;
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryStairs = {
  type: 'stairs';
  at: [number, number, number];
  dir: 'east' | 'west' | 'south' | 'north';
  steps: number;
  run?: number;
  rise?: number;
  width?: number;
  from?: number;
  m: string;
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryRamp = {
  type: 'ramp';
  at: [number, number, number];
  dir: 'east' | 'west' | 'south' | 'north';
  length: number;
  rise: number;
  width?: number;
  m: string;
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryTiers = {
  type: 'tiers';
  at: [number, number, number];
  m: string;
  layers: { size: [number, number, number]; m?: string }[];
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryGroup = {
  type: 'group';
  at?: [number, number, number];
  turn?: 0 | 90 | 180 | 270;
  flip?: 'x' | 'z' | 'xz';
  parts: GeometryPart[];
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryPrefab = {
  type: 'prefab';
  id: string;
  at: [number, number, number];
  turn?: 0 | 90 | 180 | 270;
  flip?: 'x' | 'z' | 'xz';
  scale?: [number, number, number];
  swap?: { [key: string]: string };
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryPiece = {
  type: 'piece';
  id: string;
  at: [number, number, number];
  turn?: 0 | 90 | 180 | 270;
  flip?: 'x' | 'z' | 'xz';
  scale?: [number, number, number];
  swap?: { [key: string]: string };
  about?: string;
  mirror?: 'x' | 'z' | 'xz' | 'point';
  repeat?: { count: number; step: [number, number, number] };
};
export type GeometryPart =
  | GeometryBox
  | GeometryBlock
  | GeometryHole
  | GeometryFloor
  | GeometryWalls
  | GeometryStairs
  | GeometryRamp
  | GeometryTiers
  | GeometryGroup
  | GeometryPrefab
  | GeometryPiece;
export type Weapons = {
  spawn: string[];
  spread: { still: number; moving: number; air: number };
  weapons: {
    id: string;
    slot: number;
    name: string;
    tips?: { primary: string; secondary: string; extra?: string };
    short: string;
    kind: 'bullet' | 'pellets' | 'launcher' | 'beam' | 'rail';
    ammo: number | null;
    cooldownMs: number;
    damage?: number;
    headshot?: number;
    range?: number;
    precise?: boolean;
    pellets?: number;
    cone?: number;
    projectile?: string;
    alt?: WeaponsZoom | WeaponsSlug | WeaponsLaunch | WeaponsOverload | WeaponsCharge;
    pressure?: { range: number; push: number };
    model:
      | 'weapons/rifle'
      | 'weapons/shotgun'
      | 'weapons/launcher'
      | 'weapons/rocket'
      | 'weapons/spark'
      | 'weapons/rail';
    sound:
      | 'sounds/shot'
      | 'sounds/shotgun'
      | 'sounds/launch'
      | 'sounds/rocket'
      | 'sounds/zap'
      | 'sounds/overload'
      | 'sounds/rail'
      | 'sounds/boom'
      | 'sounds/empty'
      | 'sounds/clink'
      | 'sounds/click'
      | 'sounds/step'
      | 'sounds/pad'
      | 'sounds/dodge'
      | 'sounds/kick'
      | 'sounds/pickup-weapon'
      | 'sounds/pickup-armor'
      | 'sounds/pickup-orb'
      | 'sounds/pickup-health'
      | 'sounds/medal'
      | 'sounds/strike'
      | 'sounds/powerup'
      | 'sounds/crate'
      | 'sounds/baa'
      | 'sounds/teleport'
      | 'sounds/chew'
      | 'sounds/creak'
      | 'sounds/crash'
      | 'sounds/pour'
      | 'sounds/splash'
      | 'sounds/planet'
      | 'sounds/toss'
      | 'sounds/thrown'
      | 'sounds/charge'
      | 'sounds/hit'
      | 'sounds/hurt'
      | 'sounds/hook'
      | 'sounds/flourish'
      | 'sounds/choir'
      | 'sounds/rumble';
    recoil?: number;
    flash?: number;
    fling?: number;
    best?: number;
  }[];
  kick: { damage: number; reach: number; push: number; cooldownMs: number; fling: number };
  juggling: { speed: number; tricks: string[]; projectile: string; cooldownMs: number; fling: number };
};
export type WeaponsZoom = { kind: 'zoom'; fov: number; slow: number; steady: number };
export type WeaponsSlug = { kind: 'slug'; damage: number; range: number; hole: number; cooldownMs: number };
export type WeaponsLaunch = { kind: 'launch'; projectile: string; cost?: number; cooldownMs?: number };
export type WeaponsOverload = {
  kind: 'overload';
  damage: number;
  chain: number;
  reach: number;
  links: number;
  cost: number;
  cooldownMs: number;
};
export type WeaponsCharge = { kind: 'charge'; ms: number; pierce: number };
export type Rules = {
  modes: ('dm' | 'ctf')[];
  deathmatch: { kills: number; timeLimitMs: number };
  round: { breakMs: number; suddenDeath: boolean; crumblePerSecond: number };
  respawn: { delayMs: number; protectionMs: number };
  damage: { armorShare: number; selfBlast: number; friendlyFire: boolean; voidCreditMs: number };
  medals: { multiKillMs: number; assistMs: number; spree: number };
  ctf: {
    captures: number;
    timeLimitMs: number;
    flagReach: number;
    flagReturnMs: number;
    weaponsStay: boolean;
    defendRange: number;
  };
};
export type Radar = {
  show: boolean;
  range: number;
  size: number;
  touchSize: number;
  turn: 'view' | 'north';
  rings: number;
  refreshHz: number;
  pickups: 'all' | string[];
  drops: boolean;
  powerups: boolean;
  countdown: boolean;
  ping: { style: 'pulse' | 'flash' | 'both'; ms: number; pulses: number; edge: boolean };
  colors: {
    disc: string;
    rim: string;
    rings: string;
    you: string;
    drop: string;
    crate: string;
    healthCrate: string;
  };
};
export type Materials = {
  materials: {
    id: string;
    name: string;
    about?: string;
    color: string;
    ceiling?: string;
    breakable: boolean;
    hits?: number;
    floor?: boolean;
    slippery?: boolean;
    tiles?: boolean;
    rubble?: boolean;
  }[];
};
export type Movement = {
  run: number;
  jump: number;
  gravity: number;
  groundAccel: number;
  airAccel: number;
  friction: number;
  stopSpeed: number;
  speedCap: number;
  dodge: { speed: number; hop: number; cooldownMs: number };
  padCooldownMs: number;
  slippery: { friction: number; accel: number };
  water: { speed: number; gravity: number; accel: number; swim: number };
  hook: { range: number; pull: number; speed: number; arrive: number; hop: number; cooldownMs: number };
  lift: { rise: number; fall: number; airAccel: number };
};
export type Prefabs = { prefabs: { id: string; name: string; about?: string; parts: GeometryPart[] }[] };
export type Loot = {
  powerups: {
    firstMs: number;
    everyMs: number;
    warningMs: number;
    lastsMs: number;
    droppedMs: number;
    kinds: {
      id: 'triple' | 'rush' | 'mend' | 'shimmer' | 'guard' | 'lift';
      name: string;
      color: string;
      damage?: number;
      speed?: number;
      perSecond?: number;
      cap?: number;
      share?: number;
    }[];
  };
  crates: {
    firstMs: number;
    everyMs: [number, number];
    fallSpeed: number;
    lastsMs: number;
    reach: number;
    dropHeight: number;
    items: {
      id: 'woolly' | 'splitter' | 'choir' | 'airstrike' | 'pilot' | 'teleport' | 'health';
      name: string;
      chance: number;
      about: string;
      health?: number;
      cap?: number;
    }[];
  };
  woolly: {
    speed: number;
    hop: number;
    ms: number;
    blast: { damage: number; radius: number; hole: number; push: number };
  };
  airstrike: { missiles: number; spacing: number };
  pilot: { turn: number };
  teleport: { range: number };
};
export type Sky = {
  planets: {
    name: string;
    dir: [number, number, number];
    size: number;
    look:
      'sky/planet-ringed' | 'sky/planet-rocky' | 'sky/planet-icy' | 'sky/planet-moon' | 'sky/planet-violet';
  }[];
  debris: { strikes: number; radius: [number, number]; arriveMs: [number, number] };
};
export interface GameData {
  pieces: Pieces;
  characters: Characters;
  projectiles: Projectiles;
  layouts: Layouts;
  hud: Hud;
  weapons: Weapons;
  rules: Rules;
  radar: Radar;
  materials: Materials;
  movement: Movement;
  prefabs: Prefabs;
  loot: Loot;
  sky: Sky;
}
