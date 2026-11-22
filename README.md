# Chromecast Emulator

Cast from an unmodified Cast Web Sender app to an unmodified Cast Web Receiver (CAF) app, both
running in your browser. No Chromecast device, browser extension or WebSocket server needed.

This repository is a [pnpm workspace](https://pnpm.io/workspaces) with two packages:

- [`emulator`](./emulator): the emulator itself, published to npm as
  [`@mattiasbuelens/chromecast-emulator`](https://www.npmjs.com/package/@mattiasbuelens/chromecast-emulator).
  A Presentation API polyfill and the sender and receiver emulator scripts. See its
  [README](./emulator/README.md) for how it works and how to use it with your own apps.
- [`demo`](./demo): a Vite app with a sender (a [Media Chrome](https://www.media-chrome.org/)
  player that casts with the Cast SDK) and a basic receiver that use the emulator, and Playwright
  end-to-end tests. See its [README](./demo/README.md), or try it at
  <https://mattiasbuelens.github.io/chromecast-emulator/>.

## Prerequisites

- Node.js with pnpm (`corepack enable`)
- `pnpm install`

## Scripts

- `pnpm dev`: runs every package's dev script in parallel. tsdown rebuilds the emulator on every
  change, and Vite serves the demo and reloads the page when the emulator is rebuilt. Open the
  demo and click the cast button in the player.
- `pnpm build`: builds the emulator (into `emulator/dist`) and the demo (into `demo/dist`).
- `pnpm test`: runs every package's tests: the emulator's Presentation API polyfill tests, adapted
  from [web-platform-tests](https://github.com/web-platform-tests/wpt/tree/master/presentation-api),
  and the demo's end-to-end test. Each builds the emulator first. Use
  `pnpm --filter <package> test` to run one package's tests.
- `pnpm typecheck`: type-checks the emulator.
- `pnpm format`: formats the code with [Oxfmt](https://oxc.rs/docs/guide/usage/formatter). CI runs
  `pnpm format:check`.
- `pnpm lint`: lints the code with [Oxlint](https://oxc.rs/docs/guide/usage/linter).

## Releasing

Releases are managed with [Changesets](https://changesets.dev/).

1. When a change should be released, run `pnpm changeset` and commit the generated file in `.changeset/` along with it.
2. On every push to `main`, the [Release workflow](.github/workflows/release.yml) opens or updates a
   "Version Packages" pull request that bumps the version and updates `emulator/CHANGELOG.md`.
3. Merging that pull request publishes the new version to npm with
   [trusted publishing](https://docs.npmjs.com/trusted-publishers), and creates a git tag and GitHub release.

`prepack` builds `dist/` first, so the published package is always up to date with `src/`.

## Acknowledgements

- [jaclynonacloud/chromecast-emulator-demo](https://github.com/jaclynonacloud/chromecast-emulator-demo)
  and the accompanying blog post
  [Simplifying Chromecast emulation for developers](https://www.redspace.com/blog/simplifying-chromecast-emulation-for-developers),
  whose emulator inspired this one.
- The [Presentation API](https://www.w3.org/TR/presentation-api/), which makes this possible.
- Google's [CastVideos-chrome](https://github.com/googlecast/CastVideos-chrome) sample, which the
  demo sender was based on until it was rewritten.

## License

[MIT](./LICENSE)
