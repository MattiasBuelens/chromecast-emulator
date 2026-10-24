# @mattiasbuelens/chromecast-emulator

## 0.2.0

### Minor Changes

- Add a Picture-in-Picture mode that opens the receiver in a Document Picture-in-Picture window instead of a popup. ([#13](https://github.com/MattiasBuelens/chromecast-emulator/pull/13))

### Patch Changes

- Show the "Click to allow media playback" bar when the autoplay policy blocks media that the receiver starts with the autoplay attribute, as CAF does, instead of stalling on a loading spinner. ([#13](https://github.com/MattiasBuelens/chromecast-emulator/pull/13))

## 0.1.1

### Patch Changes

- Behave more like Chrome: ask the receiver for its media status after a launch, honor the auto join policy when a sender leaves, only send media errors to the sender they are for, ignore unknown v2 messages, and report `appType` and `universalAppId` in the session. ([#16](https://github.com/MattiasBuelens/chromecast-emulator/pull/16))

- Fill in fields a receiver leaves out of a media status from the previous status of the same media session, like Chrome does, so the sender SDK always gets media info. ([#15](https://github.com/MattiasBuelens/chromecast-emulator/pull/15))

## 0.1.0

### Minor Changes

- Initial release. ([#10](https://github.com/MattiasBuelens/chromecast-emulator/pull/10))
