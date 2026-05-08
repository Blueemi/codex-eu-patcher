# Codex Computer Use Patch

Reusable patcher for packaged `Codex.app` builds. It forces the Computer Use plugin to stay visible in plugin UI and settings, tolerates stale tool-call events, renders Computer Use calls through the generic MCP row to avoid the chat error screen, keeps the bundled marketplace entry present, installs the native Computer Use runtime into `~/.codex`, updates Electron ASAR integrity, and ad-hoc signs the app.

Ad-hoc signing removes the official OpenAI signature. Browser/IAB native pipes may reject the patched app because it no longer has the official TeamIdentifier. To keep Browser/IAB working, patch a copy and keep `/Applications/Codex.app` untouched:

```sh
./patch-codex-computer-use.mjs --copy-to ~/Applications/Codex-Computer-Use.app /Applications/Codex.app
```

```sh
./patch-codex-computer-use.mjs /Applications/Codex.app
```

Safer test pass:

```sh
./patch-codex-computer-use.mjs --dry-run /Applications/Codex.app
```

Useful flags:

```sh
--copy-to PATH  copy Codex.app to PATH first, then patch the copy
--no-backup     skip app.asar / Info.plist backups
--no-codesign   skip ad-hoc codesign
--allow-missing keep going if any known patch point is missing
```

The patcher uses semantic markers instead of hashed bundle filenames, so it should survive renamed Vite chunks and small minifier changes in newer app versions. It fails by default if any known patch point disappears, which is safer than silently making a partial patch. Re-run it after installing or copying a newer `Codex.app`.

The patcher also updates `~/.codex/config.toml` so `computer-use@openai-bundled`, `[features].computer_use`, and the Computer Use `turn-ended` notify hook point at a stable signed runtime under `~/.codex/computer-use`.

Quit and reopen Codex after patching. Already-open renderer processes keep the old JavaScript in memory.
