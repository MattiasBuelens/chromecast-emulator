# @mattiasbuelens/chromecast-emulator

## 0.1.1

### Patch Changes

- Behave more like Chrome: ask the receiver for its media status after a launch, honor the auto join policy when a sender leaves, only send media errors to the sender they are for, ignore unknown v2 messages, and report `appType` and `universalAppId` in the session. ([#16](https://github.com/MattiasBuelens/chromecast-emulator/pull/16))

- Fill in fields a receiver leaves out of a media status from the previous status of the same media session, like Chrome does, so the sender SDK always gets media info. ([#15](https://github.com/MattiasBuelens/chromecast-emulator/pull/15))

## 0.1.0

### Minor Changes

- Initial release. ([#10](https://github.com/MattiasBuelens/chromecast-emulator/pull/10))
