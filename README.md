# Chromecast Emulator

Cast from an unmodified Cast Web Sender app to an unmodified Cast Web Receiver (CAF) app, both
running in your browser. No Chromecast device, browser extension or WebSocket server needed.

This repository is a [pnpm workspace](https://pnpm.io/workspaces) with two packages:

- [`emulator`](./emulator): the emulator itself, published to npm as
  [`@mattiasbuelens/chromecast-emulator`](https://www.npmjs.com/package/@mattiasbuelens/chromecast-emulator).
  A Presentation API polyfill and the sender and receiver emulator scripts. See its
  [README](./emulator/README.md) for how it works and how to use it with your own apps.
- [`demo`](./demo): a Vite app with a sender (Google's
  [CastVideos-chrome](https://github.com/googlecast/CastVideos-chrome) sample) and a basic receiver
  that use the emulator, and a Playwright end-to-end test. See its [README](./demo/README.md).

## Prerequisites

- Node.js with pnpm (`corepack enable`)
- `pnpm install`

## Scripts

- `pnpm dev`: runs every package's dev script in parallel. tsdown rebuilds the emulator on every
  change, and Vite serves the demo and reloads the page when the emulator is rebuilt. Open
  `/sender/` and click the cast button.
- `pnpm build`: builds the emulator (into `emulator/dist`) and the demo (into `demo/dist`).
- `pnpm test`: runs every package's tests: the emulator's Presentation API polyfill tests, adapted
  from [web-platform-tests](https://github.com/web-platform-tests/wpt/tree/master/presentation-api),
  and the demo's end-to-end test. Each builds the emulator first. Use
  `pnpm --filter <package> test` to run one package's tests.
- `pnpm typecheck`: type-checks the emulator.
- `pnpm format`: formats the code with Prettier.

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

## License

[MIT](./LICENSE), except for the demo sender in [`demo/sender`](./demo/sender), which is based on
Google's CastVideos-chrome sample and licensed under the [Apache License 2.0](./demo/sender/LICENSE).
