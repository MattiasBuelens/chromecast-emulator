# Chromecast Emulator Demo

A sender app and a receiver app that cast to each other in your browser, using the
[Chromecast emulator](../emulator). Both use the real, unmodified Cast SDKs.

## How to Use

From the repository root:

```bash
pnpm dev
```

1. Open the sender at `http://localhost:5173/sender/`.
1. Click the cast button. The receiver opens in a popup window. Allow pop-ups for localhost if
   Chrome blocks it. To open it in a Picture-in-Picture window instead, pick that in the
   "Open receiver in" menu at the top right, or open the sender with `?mode=pip`.
1. Pick a video. It plays in the receiver window, and the sender's controls control it.
1. If a "Click to allow media playback" bar shows up in the receiver window, click it once (see
   [Troubleshooting](../emulator/README.md#troubleshooting)).

## Sender

[`sender`](./sender) is Google's [CastVideos-chrome](https://github.com/googlecast/CastVideos-chrome)
sample app (at commit `e97c410`), licensed under the [Apache License 2.0](./sender/LICENSE). Changes:

- [`index.html`](./sender/index.html) loads [`load-cast-sdk.js`](./sender/load-cast-sdk.js) instead
  of the Cast sender SDK. That script loads the emulator scripts, and then the SDK.
- [`CastVideos.js`](./sender/CastVideos.js) resolves its image URLs with `import.meta.url`, so Vite
  includes those images in the build.

The sender uses CastVideos' own receiver application ID. The emulator opens the local receiver for
any application ID.

## Receiver

[`receiver`](./receiver) is the
[basic Web Receiver app](https://developers.google.com/cast/docs/web_receiver/basic) from the Cast
documentation: a `<cast-media-player>` and `CastReceiverContext#start()`.
[`main.js`](./receiver/main.js) loads the emulator scripts before the receiver SDK.

## How it Works

Vite only bundles module scripts, but the emulator scripts and the Cast SDKs are classic scripts
that must run in order. So the pages import the emulator scripts' URLs with Vite's `?url` suffix,
and insert them one by one with [`load-scripts.js`](./src/load-scripts.js), followed by the Cast
SDK. See the [emulator's README](../emulator/README.md) for how the emulator works.

## End-to-end Tests

[`tests/cast.test.js`](./tests/cast.test.js) drives the sender and the receiver together with
[Playwright](https://playwright.dev/): it opens the sender, clicks the cast button, picks up the
receiver popup with `page.waitForEvent('popup')`, plays a video and pauses it from the sender, and
checks the result on both sides (the receiver's `<video>`, and the sender SDK's media session).
Every test runs twice: with the receiver in a popup, and in a Picture-in-Picture window.
Both pages use the real Cast SDKs, so the test needs access to `www.gstatic.com`. The video comes
from [`tests/fixtures`](./tests/fixtures), served with `context.route()` in place of the sample
media.

```bash
pnpm --filter chromecast-emulator-demo exec playwright install chromium  # once
pnpm --filter chromecast-emulator-demo test
```

Playwright starts the dev server on port 4173 and launches Chromium with
`--autoplay-policy=no-user-gesture-required`, so the receiver plays without a click. Set
`CHROMIUM_PATH` to use a Chromium that is already installed, and `CHROMIUM_ARGS` to pass extra
command line flags.
