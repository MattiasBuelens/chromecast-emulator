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

- `pnpm dev`: builds the emulator and runs the demo. Open `/sender/` and click the cast button.
- `pnpm build`: builds the emulator (into `emulator/dist`) and the demo (into `demo/dist`).
- `pnpm test:e2e`: builds the emulator and runs the demo's end-to-end test.
- `pnpm format`: formats the code with Prettier.

## Publishing the Emulator

```bash
cd emulator
npm publish
```

`prepack` builds `dist/` first, so the published package is always up to date with `src/`.

## License

[MIT](./LICENSE), except for the demo sender in [`demo/sender`](./demo/sender), which is based on
Google's CastVideos-chrome sample and licensed under the [Apache License 2.0](./demo/sender/LICENSE).
