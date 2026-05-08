# Codex Computer Use Patch

Reusable patcher for packaged `Codex.app` builds. It forces the Computer Use plugin to stay visible in plugin UI and settings, bypasses related UI blockers, keeps the bundled marketplace entry present, updates Electron ASAR integrity, and ad-hoc signs the app.

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

## Verification

After patching, a dry run should report no pending changes:

```sh
./patch-codex-computer-use.mjs --dry-run /Applications/Codex.app
```

Expected:

```txt
Changed: 0
```

Optional signature check:

```sh
codesign --verify --deep --strict --verbose=2 /Applications/Codex.app
```

## Troubleshooting (macOS)

### `EPERM: operation not permitted` while copying/signing in `/Applications/Codex.app`

This is usually macOS privacy policy (`App Management`), not Unix file permissions. `sudo` alone may still fail.

Fix:

1. Quit `Codex.app`.
2. Open `System Settings -> Privacy & Security -> App Management`.
3. Allow your terminal app (`Terminal`, `iTerm`, `Ghostty`, etc.) to manage applications.
4. Re-run:

```sh
./patch-codex-computer-use.mjs /Applications/Codex.app
```

If you intentionally want to skip stages:

```sh
./patch-codex-computer-use.mjs --no-backup --no-codesign /Applications/Codex.app
```

### Keychain prompt appears after patching

Re-signing changes app identity from Keychain's perspective, so `Codex Safe Storage` access may prompt again.

If you trust the patched app, enter your login keychain password and choose `Always Allow`.

### `computer-use` works in chat but is missing in Plugin Store search

The Plugin Store list/search and in-chat tool availability are separate paths. On some builds, `computer-use` can be usable in chat even if the store UI does not show a searchable card.

Quick check:

1. Start a new chat.
2. Try invoking Computer Use directly from chat/tool picker.
3. If it is available there, plugin load is successful even if store search is empty.
