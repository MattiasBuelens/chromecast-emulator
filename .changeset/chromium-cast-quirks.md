---
'@mattiasbuelens/chromecast-emulator': patch
---

Behave more like Chrome: ask the receiver for its media status after a launch, honor the auto join policy when a sender leaves, only send media errors to the sender they are for, ignore unknown v2 messages, and report `appType` and `universalAppId` in the session.
