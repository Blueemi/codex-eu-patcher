# Codex Computer Use Patch

Reusable patcher for packaged `Codex.app` builds. It forces the Computer Use plugin to stay visible in plugin UI and settings, bypasses related UI blockers, keeps the bundled marketplace entry present, syncs the signed bundled Computer Use payload into the user plugin cache, updates Electron ASAR integrity, and ad-hoc signs the app.

```sh
./patch-codex-computer-use.mjs /Applications/Codex.app
```

Safer test pass:

```sh
./patch-codex-computer-use.mjs --dry-run /Applications/Codex.app
```

Useful flags:

```sh
--no-backup     skip app.asar / Info.plist backups
--no-codesign   skip ad-hoc codesign
--allow-missing keep going if any known patch point is missing
```

The patcher uses semantic markers instead of hashed bundle filenames, so it should survive renamed Vite chunks and small minifier changes in newer app versions. It fails by default if any known patch point disappears, which is safer than silently making a partial patch. Re-run it after installing or copying a newer `Codex.app`.

The cache sync is intentionally copied from the signed payload embedded in `Codex.app`. Computer Use relies on macOS Apple Events permissions, and an ad-hoc signed cache copy can start but still fail tool calls with `Sender process is not authenticated`.
