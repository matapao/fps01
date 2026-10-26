# Shared engineering standard

Version 1 · agreed baseline, 2026-10-24 · applies to zirbel, fps01, td01 (craftdef), and derby01.

The canonical source is `docs/engineering/` in the Zirbel repository (`matapao/zirbel`). The same
files are mirrored into each game's `docs/engineering/` so a standalone checkout carries the rules.
Edit the canonical source, then synchronize; do not create competing project editions.

This is the default for new code and extracted modules. Existing differences are listed in
`ADOPTION.md`; they are migration work, not evidence that every repository already conforms.
Local architecture and product contracts still specify domain behavior. When a technical rule
needs an exception, record its scope, reason, verification and removal condition in `ADOPTION.md`.
Human instructions take precedence. No rule here authorizes publishing or unrelated rewrites.

## Language and formatting

- Use JavaScript ES modules (`type: module`), named exports, `const` by default and `let` for mutation.
  Keep existing public default exports compatible. Avoid CommonJS in owned application code.
- Prefer TypeScript for new application/rule modules. JavaScript remains supported in fps01 and
  existing tooling; use explicit JSDoc contracts at changed public boundaries. Do not convert a
  subsystem just to rename its files. New standalone Node tooling uses erasable TypeScript.
- Use Prettier with `prettier.json`: two spaces, semicolons, single quotes, trailing commas and a
  110-column print width. Use UTF-8, LF and a final newline as specified in `editorconfig`.
  All four repositories enforce the shared formatter on maintained owned files. Format touched modules; keep bulk formatting separate from behavior changes.
- Use camelCase for values/functions, PascalCase for types/classes, UPPER_SNAKE_CASE for true shared
  constants, and descriptive kebab-case filenames. Preserve existing public URLs and import paths.
  Prefer one declaration per statement and straightforward control flow over dense one-liners.
- Use named functions for public operations; small callbacks may be arrows. Use classes when an object
  owns state/lifecycle, plain records for serialized state, and functions for algorithms. No mandatory OOP.
- Comments explain units, invariants, ownership or a non-obvious decision. Names should explain actions.

## TypeScript contract

`tsconfig.portable.json` is the strict baseline for new portable modules. It includes checked indexing,
exact optional properties, exhaustive control-flow checks and erasable syntax. `tsc` checks; it does not emit.

- Treat external input as `unknown`; narrow it with real validation. Do not silence it with `as T`, `any`,
  catch-all index signatures, `@ts-ignore`, or non-null assertions without an established invariant.
- Model commands, events, lifecycle and results with discriminated unions. Make switches exhaustive
  using a `never` check. Keep nullable values distinct from absent optional fields.
- Use `import type` for types. Runtime modules have no import-time I/O, singleton mutation or boot work.
- Node tools/adapters use NodeNext and explicit `.ts`/`.js` relative import extensions. Browser bundles
  use ESNext plus bundler resolution. These are environment adapters, not different language styles.
- Portable code gets ES2022 libraries and `types: []`; add DOM or Node types only in the owning adapter
  config. A type environment must not accidentally make browser APIs available to a simulation.
- Enable the baseline when extracting a module and include it in the real typecheck gate. Do not claim
  a whole loose legacy project is strict because one new config exists. Exceptions may only shrink.

## Runtime, packages and library choices

Node 24 is the common supported runtime baseline. CI must exercise Node 24; additional versions are
optional. Use native Node type stripping for erasable TypeScript. ES2022 is the portable output target.
Use npm with a committed version-3 `package-lock.json` in all four projects. Install reproducibly with `npm ci`
(`--ignore-scripts` where the dependency set supports it); never run an install inside a check command.
Derby has migrated from pnpm; do not reintroduce a competing lockfile or runtime bootstrap.

| Concern                           | Shared choice                                         | Rule                                                                  |
| --------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| Type checking                     | TypeScript                                            | One compiler line; strict baseline above                              |
| Formatting                        | Prettier                                              | Shared configuration, no second formatter                             |
| Unit/integration tests            | `node:test` and `node:assert/strict`                  | No Jest, Vitest, Mocha or Chai for the same role                      |
| Browser automation                | `puppeteer-core` with installed Chrome                | Reuse one launch/cleanup adapter; no new CDP client implementation    |
| Production bundling               | esbuild directly                                      | Vite remains td01's recorded development/build exception              |
| Browser 3D                        | three.js                                              | Reuse existing render ownership; no second engine for equivalent work |
| HTTP, files, crypto, processes    | Platform/`node:` APIs                                 | Prefer `fetch`, URL, Web Crypto and Node built-ins to wrappers        |
| WebSockets                        | Native client API; `ws` for Node servers              | Keep transport separate from rules and protocols                      |
| Zirbel host transport             | Public `@zirbel/net` API or its existing vendored SDK | No second host/session stack per game                                 |
| Shared platform validation/policy | Public `@zirbel/core` exports                         | Reuse schema/session/permission algorithms; keep game semantics local |
| Game content                      | Existing JSON plus schema and semantic checks         | One owning rule/data definition; no duplicate tuning constants        |

The enforced exact versions for matching dependency roles are:
TypeScript `7.0.2`, Prettier `3.9.10`, esbuild `0.28.2`, `@types/node` `24.19.2`, three `0.186.1`,
`@types/three` `0.186.0`, ws `8.22.0`, `@types/ws` `8.18.2`, and puppeteer-core `25.14.0`.
These are coordination targets, not a claim of the newest or safest releases. The lockfile is the
installed source of truth. Upgrade compatible tools together, check advisories when changing
dependencies, and test three.js upgrades against rendering before removing a version exception.

Declare direct dependencies in the owning package and pin newly aligned versions exactly. Reuse
the chosen library for an existing role. Before adding a library or shared helper, search these
repositories and the public core/net exports. A new role needs a concrete use case and an adoption
record; no speculative dependency, framework rewrite or generic abstraction layer.

## Architecture and implementation ownership

```text
portable algorithms/contracts <- domain rules <- application coordination <- I/O and presentation
```

- Dependencies point inward. Rules have explicit state and small injected dependencies; they do not
  import DOM, rendering, storage, transport, global browser state or their coordinators. Initialization
  happens in the composition root. Keep runtime graphs acyclic and import public package exports.
- Put a capability in its existing owning module/package. Extract a focused module before growing a
  coordinator. Preserve local size budgets; do not hide complexity in a generic `utils` bag.
- One authoritative path owns each mutation. UI, rendering, agents and transports submit commands;
  they do not independently award resources, apply damage or implement permission policy.
- Decode untrusted input at ingress, then validate state-dependent authorization and gameplay in the
  owner. Bound sizes, rates, queues and numeric ranges. Static types do not validate a wire message.
- Deterministic rules use seeded RNG and explicit simulation time with fixed steps. Presentation
  randomness, wall clocks, network timing and audio must not consume authoritative randomness.
- Keep state serializable and schemas versioned. Incompatible protocols get an explicit version change.
  Test old-save defaults/migrations, full snapshots, incremental updates and deterministic continuation.
- Each timer, listener, socket, worker and GPU/audio resource has an owner and disposal path.
  Async cancellation cannot resurrect a stopped owner; cleanup is idempotent and awaitable where needed.
- Throw for programmer/configuration failures. Represent expected rejection explicitly, handle errors
  where recovery is possible, and never catch-and-ignore failures that affect correctness or permissions.
  Keep credentials and personal data out of logs, URLs and client messages.

Share an implementation when its semantics and lifecycle are the same. Portable platform algorithms
belong in `@zirbel/core`; transport/session behavior belongs in `@zirbel/net`; a game owns its domain
rules. Consume a public package or the existing reproducibly built SDK, never a sibling checkout's
source path. Extract only after demonstrating equivalent consumers with contract tests. Similar-looking
game math, movement, damage and message shapes are not automatically the same contract.

## Testing and change practice

- Write behavior tests against the lowest useful public boundary. Reproduce a bug before fixing it.
  Test rejection and recovery as well as success. Do not test source spelling or copy an implementation
  into its expected result; architecture checks may inspect dependencies and forbidden APIs.
- Use `node:test` named cases and strict assertions for new suites, with explicit fixtures, seeded input,
  injected clocks and isolated temporary stores. Avoid sleeps where an observable condition suffices.
- Tests close resources, use bounded timeouts/concurrency and never touch real saves or live accounts.
  Browser scenarios cover actual rendering/input; headless mocks are not proof of a WebGL flow.
- The complete gate covers formatting, type checking, architecture, maintained tests and production
  builds. A check must not download, reformat source, change releases or weaken assertions.
  Keep current script names until migration; the exact commands are in `ADOPTION.md`.
- Run LAN/save/network integration when those boundaries change, and the affected browser flow for
  input/UI/rendering changes. Preserve local requirements that are stronger than this common baseline.
- Keep contracts and attribution current. Separate implemented behavior from proposals. Preserve local
  work; no automatic reset, clean, commit, push or deployment. Report checks actually run, failures,
  hardware used for performance claims, and remaining uncertainty.
- Every playable game change carries a one-line player-facing change title, at most 100 characters:
  use a concise clean commit subject or supply an explicit title for uncommitted work. Retain immutable
  build artifacts and branch/author provenance. Alpha/Beta expose branch revisions (main by default);
  Released games publish only explicitly approved versions with a changelog, never every commit.
- A reviewed legal/security withdrawal may remove unauthorized artifact bytes from servers and source.
  Preserve a validated withdrawal tombstone, artifact hash, provenance and revision position; never silently
  replace bytes or reuse their identity. Previously delivered recipient copies cannot be recalled.

## Maintaining the standard

Change the canonical standard, templates and adoption record together. In the Zirbel checkout run
`node tools/engineering-sync.ts --write`, then `node tools/engineering-sync.ts --check` to refresh and
check all four local copies and their AGENTS.md references. Explicit checkout paths may follow either
flag. The sync check verifies documentation/templates, not whole-project conformance or CI coverage.
Each repository runs `node docs/engineering/check.mjs` and `style.mjs` in its complete gate.
The guard checks active formatter/editor/runtime settings, exact dependency declarations, root lockfile
agreement and resolved strict flags for the profiles in `strict-profiles.json`. Keep those profiles
in the actual compiler gate. Completed legacy typing migrations are recorded in `ADOPTION.md`; do not shrink profile membership
or maintained-source coverage, reintroduce unchecked-JS ledgers, or add child overrides that weaken the baseline.

Browser consumers import `@zirbel/engineering/browser`. Its source is Zirbel's
`packages/engineering`; `npm pack ./packages/engineering` rebuilds the distributable. td01 and derby
consume the same checked-in `vendor/zirbel-engineering-1.0.0.tgz` through npm's file dependency.
The guard checks compiled files against `browser-package.json`, and consumer archives/lockfiles against
its integrity. After adapter changes rebuild once, update that canonical metadata, replace both artifacts,
refresh both lockfiles and run the adapter
regressions plus affected consumer scenarios. Do not import the sibling adapter source.

For each touched subsystem: read this standard and its local contract, reuse its implementation owner
and library choices, obey the current gate, and reduce the listed exceptions when the change permits it.
