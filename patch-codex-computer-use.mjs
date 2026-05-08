#!/usr/bin/env node
import { mkdtemp, rm, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const FALLBACK_PLUGIN = `{
composerIconPath:null,
description:"Control Mac apps from Codex",
displayName:"Computer Use",
logoPath:null,
marketplaceDisplayName:null,
marketplaceName:"openai-bundled",
marketplacePath:null,
remoteMarketplaceName:"openai-bundled",
plugin:{
authPolicy:"ON_INSTALL",
enabled:!1,
id:"computer-use@openai-bundled",
installed:!1,
interface:{
brandColor:"#0F172A",
category:"Productivity",
defaultPrompt:["Build & run my open Xcode project and test it for bugs","Play a game in Chess.app"],
developerName:"OpenAI",
displayName:"Computer Use",
shortDescription:"Control Mac apps from Codex"
},
name:"computer-use"
}
}`.replace(/\n/g, "");

const usage = `Usage:
  ./patch-codex-computer-use.mjs /path/to/Codex.app

Options:
  --dry-run       Extract and patch temp files only
  --no-backup     Do not create .bak-* copies
  --no-codesign   Skip ad-hoc codesign
  --allow-missing Continue even if a known patch point is missing
  --strict        Kept for compatibility; fail-fast is the default
`;

function parseArgs(argv) {
  const options = { dryRun: false, backup: true, codesign: true, allowMissing: false };
  let appPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-backup") options.backup = false;
    else if (arg === "--no-codesign") options.codesign = false;
    else if (arg === "--allow-missing") options.allowMissing = true;
    else if (arg === "--strict") options.allowMissing = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(usage.trim());
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (appPath == null) {
      appPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return { appPath: resolve(appPath ?? "Codex.app"), options };
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    ...opts,
  });
  if (result.status !== 0) {
    const detail = opts.capture ? `\n${result.stderr || result.stdout || ""}` : "";
    throw new Error(`${cmd} ${args.join(" ")} failed${detail}`);
  }
  return result.stdout ?? "";
}

async function readText(path) {
  return readFile(path, "utf8");
}

async function writeText(path, text) {
  await writeFile(path, text, "utf8");
}

async function listFiles(root) {
  const out = run("find", [root, "-type", "f"], { capture: true });
  return out.split("\n").filter(Boolean);
}

function replaceOnce(text, matcher, replacement, label, changes) {
  const next = text.replace(matcher, replacement);
  if (next !== text) changes.push(label);
  return next;
}

function syntheticPluginFunction(name) {
  return `function ${name}(){return ${FALLBACK_PLUGIN}}`;
}

function idPattern() {
  return String.raw`[A-Za-z_$][\w$]*`;
}

async function patchMainFeatureAvailability(root, summary) {
  const files = (await listFiles(join(root, ".vite", "build"))).filter((file) => file.endsWith(".js"));
  let touched = 0;
  let candidates = 0;
  for (const file of files) {
    let text = await readText(file);
    if (!text.includes("computerUseNodeRepl") && !text.includes("CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE")) continue;
    candidates += 1;
    const changes = [];
    text = replaceOnce(
      text,
      /computerUse:!1,computerUseNodeRepl:!1/g,
      "computerUse:!0,computerUseNodeRepl:!0",
      "main default availability",
      changes,
    );
    text = replaceOnce(
      text,
      /function\s+([A-Za-z_$][\w$]*)\(e,\{env:[^)]*?platform:[^)]*?\}=\{\}\)\{return[\s\S]*?CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE[\s\S]*?\}\}function\s+([A-Za-z_$][\w$]*)\(/,
      (_match, fn, nextFn) => `function ${fn}(e,t={}){return{...e,computerUse:!0,computerUseNodeRepl:!0}}function ${nextFn}(`,
      "main platform gate",
      changes,
    );
    text = replaceOnce(
      text,
      new RegExp(
        String.raw`\{name:(${idPattern()}),isAvailable:\(\{features:(${idPattern()}),platform:(${idPattern()})\}\)=>\3===` + "`darwin`" + String.raw`&&\2\.computerUse,migrate:(${idPattern()})\}`,
      ),
      "{forceReload:!0,installWhenMissing:!0,name:$1,isAvailable:({features:$2,platform:$3})=>$3===`darwin`&&$2.computerUse,migrate:$4}",
      "main auto-install descriptor",
      changes,
    );
    if (changes.length > 0) {
      await writeText(file, text);
      summary.changed.push(`${relative(root, file)}: ${[...new Set(changes)].join(", ")}`);
      touched += 1;
    }
  }
  if (touched === 0) {
    if (candidates > 0) summary.skipped.push("main feature availability already patched or not gated");
    else summary.missing.push("main feature availability");
  }
}

async function patchUseModelSettings(root, summary) {
  const assets = (await listFiles(join(root, "webview", "assets"))).filter((file) => file.endsWith(".js"));
  let patched = false;
  let candidates = 0;
  for (const file of assets) {
    let text = await readText(file);
    if (!text.includes("isComputerUseAvailable") && !text.includes("computer-use@openai-bundled")) continue;
    candidates += 1;
    const changes = [];

    text = replaceOnce(
      text,
      /let\s+([A-Za-z_$][\w$]*)=[^;]*?===`electron`[^;]*?&&[^;]*?\([^;]*?\),([A-Za-z_$][\w$]*)=\1&&![^,;]*?&&[^,;]*?\.enabled&&![^,;]*?\.isLoading,([A-Za-z_$][\w$]*)=\1&&[^,;]*?\.isLoading,([A-Za-z_$][\w$]*)=\1&&\([^;]*?\.isLoading\),([A-Za-z_$][\w$]*);/,
      (_match, available, enabled, loading, blocked, reason) =>
        `let ${available}=!0,${enabled}=!0,${loading}=!1,${blocked}=!1,${reason};`,
      "computer use availability",
      changes,
    );

    if (text.includes("browser-use@openai-bundled") && !text.includes("computer-use@openai-bundled")) {
      text = text.replace(
        /`browser-use@openai-bundled`/,
        "`browser-use@openai-bundled`,`computer-use@openai-bundled`",
      );
      changes.push("featured plugin id");
    }

    if (!text.includes("codexComputerUseFallback")) {
      text = replaceOnce(
        text,
        /function\s+([A-Za-z_$][\w$]*)\(\{plugins:([A-Za-z_$][\w$]*),isComputerUseAvailable:([A-Za-z_$][\w$]*)\}\)\{return[\s\S]*?\}function\s+([A-Za-z_$][\w$]*)\(/,
        (_match, fn, plugins, available, nextFn) =>
          `function ${fn}({plugins:${plugins},isComputerUseAvailable:${available}}){return ${plugins}.some(${plugins}=>${plugins}.plugin.name==="computer-use"||${plugins}.plugin.id==="computer-use@openai-bundled")?${plugins}:[codexComputerUseFallback(),...${plugins}]}${syntheticPluginFunction("codexComputerUseFallback")}function ${nextFn}(`,
        "plugin list fallback",
        changes,
      );
    }

    text = replaceOnce(
      text,
      new RegExp(
        String.raw`function\s+(${idPattern()})\(e,\{isComputerUseAvailable:(${idPattern()}),isExternalBrowserUseAvailable:(${idPattern()}),isInAppBrowserUseAvailable:(${idPattern()})\}\)\{return!\(!\4&&(${idPattern()})\(e\)\|\|!\3&&(${idPattern()})\(e\)\|\|!\2&&(${idPattern()})\(e\)\)\}`,
      ),
      (_match, fn, computer, external, inApp, isBrowserUse, isExternalBrowser, _isComputerUse) =>
        `function ${fn}(e,{isComputerUseAvailable:${computer},isExternalBrowserUseAvailable:${external},isInAppBrowserUseAvailable:${inApp}}){return!(!${inApp}&&${isBrowserUse}(e)||!${external}&&${isExternalBrowser}(e))}`,
      "plugin availability filter",
      changes,
    );

    if (changes.length > 0) {
      await writeText(file, text);
      summary.changed.push(`${relative(root, file)}: ${[...new Set(changes)].join(", ")}`);
      patched = true;
    }
  }
  if (!patched) {
    if (candidates > 0) summary.skipped.push("webview model settings already patched");
    else summary.missing.push("webview model settings");
  }
}

async function patchInstallFlow(root, summary) {
  const assets = (await listFiles(join(root, "webview", "assets"))).filter((file) => file.endsWith(".js"));
  let patched = false;
  let candidates = 0;
  for (const file of assets) {
    let text = await readText(file);
    if (!text.includes("openPluginInstall:")) continue;
    candidates += 1;
    const changes = [];
    text = replaceOnce(
      text,
      /if\((![A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.plugin\.id\))\)\{([A-Za-z_$][\w$]*)\(\);return\}/g,
      "if(!1&&$1){$2();return}",
      "install auth toast gate",
      changes,
    );
    text = replaceOnce(
      text,
      /openPluginInstall:\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)=\{\}\)=>\{([A-Za-z_$][\w$]*)\|\|![^&{}]+&&[A-Za-z_$][\w$]*\(\1\.plugin\.id\)\|\|\(([^{}]+?)\)\}/,
      "openPluginInstall:($1,$2={})=>{$3||($4)}",
      "install modal gate",
      changes,
    );
    text = replaceOnce(
      text,
      new RegExp(
        String.raw`openPluginInstall:\((${idPattern()}),(${idPattern()})=\{\}\)=>\{(${idPattern()})\|\|![^|{}]+?\|\|![^|{}]+?\|\|![^|{}]+?\|\|\(`,
      ),
      "openPluginInstall:($1,$2={})=>{$3||(",
      "install modal gate",
      changes,
    );
    if (changes.length > 0) {
      await writeText(file, text);
      summary.changed.push(`${relative(root, file)}: ${[...new Set(changes)].join(", ")}`);
      patched = true;
    }
  }
  if (!patched) {
    if (candidates > 0) summary.skipped.push("plugin install flow already patched");
    else summary.missing.push("plugin install flow");
  }
}

async function patchAuthDetailGate(root, summary) {
  const assets = (await listFiles(join(root, "webview", "assets"))).filter((file) => file.endsWith(".js"));
  let patched = false;
  let candidates = 0;
  for (const file of assets) {
    let text = await readText(file);
    if (!text.includes("chatgpt")) continue;
    candidates += 1;
    const changes = [];
    text = replaceOnce(
      text,
      /return\s+[A-Za-z_$][\w$]*!==`chatgpt`/g,
      "return !1",
      "auth detail blocker",
      changes,
    );
    if (changes.length > 0) {
      await writeText(file, text);
      summary.changed.push(`${relative(root, file)}: ${[...new Set(changes)].join(", ")}`);
      patched = true;
    }
  }
  if (!patched) {
    if (candidates > 0) summary.skipped.push("auth detail blocker already patched or absent");
    else summary.missing.push("auth detail blocker");
  }
}

async function patchComputerUseSettings(root, summary) {
  const assets = (await listFiles(join(root, "webview", "assets"))).filter((file) => file.endsWith(".js"));
  let patched = false;
  let candidates = 0;
  for (const file of assets) {
    let text = await readText(file);
    if (!text.includes("settings.computerUse.install") && !text.includes("Computer Use plugin unavailable")) continue;
    candidates += 1;
    const changes = [];
    if (!text.includes("codexComputerUseSettingsFallback")) {
      text = replaceOnce(
        text,
        /function\s+([A-Za-z_$][\w$]*)\(e\)\{let t=e\.filter\([\s\S]*?computer-use[\s\S]*?\);return([\s\S]*?)\?\?null\}function\s+([A-Za-z_$][\w$]*)\(/,
        (_match, fn, body, nextFn) =>
          `function ${fn}(e){let t=e.filter(e=>e.plugin.name==="computer-use"||e.plugin.id.split("@")[0]==="computer-use");return${body}??codexComputerUseSettingsFallback()}${syntheticPluginFunction("codexComputerUseSettingsFallback")}function ${nextFn}(`,
        "settings fallback",
        changes,
      );
    }
    text = replaceOnce(
      text,
      new RegExp(
        String.raw`let\s+(${idPattern()})=(${idPattern()})\((${idPattern()})\);if\((${idPattern()})\((${idPattern()})\)!=null\)`,
      ),
      (_match, availability, hook, args, routeMatch, route) =>
        `let ${availability}={...${hook}(${args}),available:!0};if(${routeMatch}(${route})!=null)`,
      "settings availability gate",
      changes,
    );
    if (changes.length > 0) {
      await writeText(file, text);
      summary.changed.push(`${relative(root, file)}: ${[...new Set(changes)].join(", ")}`);
      patched = true;
    }
  }
  if (!patched) {
    if (candidates > 0) summary.skipped.push("computer use settings fallback already patched");
    else summary.missing.push("computer use settings fallback");
  }
}

async function patchSettingsNavAvailability(root, summary) {
  const assets = (await listFiles(join(root, "webview", "assets"))).filter((file) => file.endsWith(".js"));
  let patched = false;
  let candidates = 0;
  for (const file of assets) {
    let text = await readText(file);
    if (!text.includes("case`computer-use`:return")) continue;
    candidates += 1;
    const changes = [];
    text = replaceOnce(
      text,
      /case`computer-use`:return[^;]+;/g,
      "case`computer-use`:return!0;",
      "settings nav computer-use availability",
      changes,
    );
    if (changes.length > 0) {
      await writeText(file, text);
      summary.changed.push(`${relative(root, file)}: ${[...new Set(changes)].join(", ")}`);
      patched = true;
    }
  }
  if (!patched) {
    if (candidates > 0) summary.skipped.push("settings nav computer-use availability already patched");
    else summary.missing.push("settings nav computer-use availability");
  }
}

async function patchPluginSelectorFallback(root, summary) {
  const assets = (await listFiles(join(root, "webview", "assets"))).filter((file) => file.endsWith(".js"));
  let patched = false;
  let candidates = 0;
  for (const file of assets) {
    let text = await readText(file);
    if (!text.includes("plugin.id.split(`@`)[0]") || !text.includes("openai-curated")) continue;
    candidates += 1;
    const changes = [];
    if (!text.includes("codexComputerUseSelectorFallback")) {
      text = replaceOnce(
        text,
        new RegExp(
          String.raw`function\s+(${idPattern()})\(e,(${idPattern()})\)\{let\s+(${idPattern()})=e\.filter\(e=>e\.plugin\.name===\2\|\|e\.plugin\.id\.split\(` + "`@`" + String.raw`\)\[0\]===\2\),(${idPattern()})=(${idPattern()})\((${idPattern()})\(\)\);return`,
        ),
        (_match, fn, name, filtered, preferred, normalize, source) =>
          `${syntheticPluginFunction("codexComputerUseSelectorFallback")}function ${fn}(e,${name}){let ${filtered}=e.filter(e=>e.plugin.name===${name}||e.plugin.id.split(\`@\`)[0]===${name});${name}===\`computer-use\`&&${filtered}.length===0&&(${filtered}=[codexComputerUseSelectorFallback(),...${filtered}]);let ${preferred}=${normalize}(${source}());return`,
        "selector fallback",
        changes,
      );
    }
    if (changes.length > 0) {
      await writeText(file, text);
      summary.changed.push(`${relative(root, file)}: ${[...new Set(changes)].join(", ")}`);
      patched = true;
    }
  }
  if (!patched) {
    if (candidates > 0) summary.skipped.push("plugin selector fallback already patched");
    else summary.missing.push("plugin selector fallback");
  }
}

async function ensureMarketplaceEntry(marketplacePath, summary, label) {
  if (!existsSync(marketplacePath)) {
    summary.missing.push(label);
    return;
  }
  const json = JSON.parse(await readText(marketplacePath));
  json.plugins ??= [];
  if (!json.plugins.some((plugin) => plugin.name === "computer-use")) {
    json.plugins.push({
      name: "computer-use",
      category: "Productivity",
      policy: { authentication: "ON_INSTALL", installation: "AVAILABLE" },
      source: { source: "local", path: "./plugins/computer-use" },
    });
    await writeText(marketplacePath, `${JSON.stringify(json, null, 2)}\n`);
    summary.changed.push(`${label}: computer-use entry`);
  } else {
    summary.skipped.push(`${label} already has computer-use`);
  }
}

function bundledMarketplaceRoot(appPath) {
  return join(appPath, "Contents", "Resources", "plugins", "openai-bundled");
}

async function ensureBundledMarketplace(appPath, summary) {
  const marketplacePath = join(bundledMarketplaceRoot(appPath), ".agents", "plugins", "marketplace.json");
  await ensureMarketplaceEntry(marketplacePath, summary, "bundled marketplace");
}

async function ensureRuntimeBundledMarketplace(appPath, summary) {
  const sourceRoot = bundledMarketplaceRoot(appPath);
  const sourcePlugin = join(sourceRoot, "plugins", "computer-use");
  if (!existsSync(sourcePlugin)) {
    summary.missing.push("bundled computer-use plugin");
    return;
  }

  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const runtimeRoot = join(codexHome, ".tmp", "bundled-marketplaces", "openai-bundled");
  await mkdir(join(runtimeRoot, ".agents", "plugins"), { recursive: true });
  await mkdir(join(runtimeRoot, "plugins"), { recursive: true });

  const runtimeMarketplace = join(runtimeRoot, ".agents", "plugins", "marketplace.json");
  if (!existsSync(runtimeMarketplace)) {
    await cp(join(sourceRoot, ".agents", "plugins", "marketplace.json"), runtimeMarketplace);
    summary.changed.push("runtime bundled marketplace: marketplace.json");
  }

  await cp(sourcePlugin, join(runtimeRoot, "plugins", "computer-use"), {
    force: true,
    recursive: true,
    verbatimSymlinks: true,
  });
  summary.changed.push("runtime bundled marketplace: computer-use plugin");
  await ensureMarketplaceEntry(runtimeMarketplace, summary, "runtime bundled marketplace");
}

function codexHomePath() {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

function upsertPluginEnabled(text, pluginId) {
  const escaped = pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = `[plugins."${pluginId}"]`;
  const sectionPattern = new RegExp(
    `(^|\\n)(\\[plugins\\."${escaped}"\\]\\n)([\\s\\S]*?)(?=\\n\\[|$)`,
  );
  const match = text.match(sectionPattern);
  if (match) {
    const body = match[3].match(/^enabled\s*=/m)
      ? match[3].replace(/^enabled\s*=.*$/m, "enabled = true")
      : `enabled = true\n${match[3]}`;
    return text.replace(sectionPattern, `${match[1]}${match[2]}${body}`);
  }

  const browserSection = /\n\[plugins\."browser-use@openai-bundled"\]\nenabled = true\n?/;
  if (browserSection.test(text)) {
    return text.replace(browserSection, (existing) => `${existing}\n${section}\nenabled = true\n`);
  }
  return `${text.trimEnd()}\n\n${section}\nenabled = true\n`;
}

async function ensureUserPluginInstall(appPath, summary) {
  const sourcePlugin = join(bundledMarketplaceRoot(appPath), "plugins", "computer-use");
  const manifestPath = join(sourcePlugin, ".codex-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    summary.missing.push("bundled computer-use manifest");
    return;
  }

  const codexHome = codexHomePath();
  const manifest = JSON.parse(await readText(manifestPath));
  const cacheRoot = join(codexHome, "plugins", "cache", "openai-bundled", "computer-use", manifest.version);
  await mkdir(dirname(cacheRoot), { recursive: true });
  await cp(sourcePlugin, cacheRoot, { force: true, recursive: true, verbatimSymlinks: true });
  summary.changed.push(`plugin cache: computer-use ${manifest.version}`);

  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) {
    summary.missing.push("Codex config.toml");
    return;
  }
  const before = await readText(configPath);
  const after = upsertPluginEnabled(before, "computer-use@openai-bundled");
  if (after !== before) {
    await writeText(configPath, after);
    summary.changed.push("config.toml: enable computer-use plugin");
  } else {
    summary.skipped.push("config.toml already enables computer-use plugin");
  }
}

function collectUnpackGlob(appPath) {
  const unpacked = join(appPath, "Contents", "Resources", "app.asar.unpacked");
  if (!existsSync(unpacked)) return null;
  const out = run("find", [unpacked, "-type", "f"], { capture: true });
  const patterns = new Set();
  for (const file of out.split("\n").filter(Boolean)) {
    const rel = relative(unpacked, file);
    const parts = rel.split("/");
    if (parts[0] === "node_modules" && parts.length >= 2) {
      const name = parts[1].startsWith("@") && parts[2] ? `${parts[1]}/${parts[2]}` : parts[1];
      patterns.add(`node_modules/${name}/**`);
    } else if (parts[0]) {
      patterns.add(`${parts[0]}/**`);
    }
  }
  if (patterns.size === 0) return null;
  return patterns.size === 1 ? [...patterns][0] : `{${[...patterns].join(",")}}`;
}

function asarHeaderHash(asarPath) {
  const buffer = spawnSync(process.execPath, [
    "-e",
    `
const fs=require("node:fs"),crypto=require("node:crypto");
const b=fs.readFileSync(process.argv[1]);
const n=b.readUInt32LE(12);
process.stdout.write(crypto.createHash("sha256").update(b.subarray(16,16+n)).digest("hex"));
`,
    asarPath,
  ], { encoding: "utf8" });
  if (buffer.status !== 0) throw new Error(buffer.stderr || "failed to hash asar header");
  return buffer.stdout.trim();
}

function plistSetAsarHash(infoPlist, hash) {
  const set = spawnSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`,
    infoPlist,
  ], { stdio: "ignore" });
  if (set.status === 0) return;
  run("/usr/libexec/PlistBuddy", ["-c", "Add :ElectronAsarIntegrity dict", infoPlist]);
  run("/usr/libexec/PlistBuddy", ["-c", "Add :ElectronAsarIntegrity:Resources/app.asar dict", infoPlist]);
  run("/usr/libexec/PlistBuddy", ["-c", "Add :ElectronAsarIntegrity:Resources/app.asar:algorithm string SHA256", infoPlist]);
  run("/usr/libexec/PlistBuddy", ["-c", `Add :ElectronAsarIntegrity:Resources/app.asar:hash string ${hash}`, infoPlist]);
}

async function checkJs(files) {
  for (const file of files) run(process.execPath, ["--check", file], { capture: true });
}

async function main() {
  const { appPath, options } = parseArgs(process.argv.slice(2));
  const asarPath = join(appPath, "Contents", "Resources", "app.asar");
  const infoPlist = join(appPath, "Contents", "Info.plist");
  if (!existsSync(asarPath) || !existsSync(infoPlist)) throw new Error(`${appPath} is not a packaged Codex.app`);

  const tmp = await mkdtemp(join(tmpdir(), "codex-computer-use-patch-"));
  const work = join(tmp, "app");
  const summary = { changed: [], skipped: [], missing: [] };
  try {
    if (options.backup && !options.dryRun) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await cp(asarPath, `${asarPath}.bak-${stamp}`);
      await cp(infoPlist, `${infoPlist}.bak-${stamp}`);
    }

    run("npx", ["--yes", "@electron/asar", "extract", asarPath, work]);
    await patchMainFeatureAvailability(work, summary);
    await patchUseModelSettings(work, summary);
    await patchInstallFlow(work, summary);
    await patchAuthDetailGate(work, summary);
    await patchComputerUseSettings(work, summary);
    await patchSettingsNavAvailability(work, summary);
    await patchPluginSelectorFallback(work, summary);
    if (!options.dryRun) {
      await ensureBundledMarketplace(appPath, summary);
      await ensureRuntimeBundledMarketplace(appPath, summary);
      await ensureUserPluginInstall(appPath, summary);
    }

    const changedJs = summary.changed
      .map((entry) => entry.split(":")[0])
      .filter((file) => file.endsWith(".js"))
      .map((file) => join(work, file));
    await checkJs([...new Set(changedJs)]);

    if (!options.allowMissing && summary.missing.length > 0) {
      throw new Error(`Missing patch points: ${summary.missing.join(", ")}`);
    }

    if (!options.dryRun) {
      const unpackGlob = collectUnpackGlob(appPath);
      const packArgs = ["--yes", "@electron/asar", "pack", work, asarPath];
      if (unpackGlob != null) packArgs.push("--unpack", unpackGlob);
      run("npx", packArgs);
      plistSetAsarHash(infoPlist, asarHeaderHash(asarPath));
      if (options.codesign) run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
      run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { capture: true });
    }

    console.log(`Changed: ${summary.changed.length}`);
    for (const item of summary.changed) console.log(`  ${item}`);
    if (summary.skipped.length > 0) console.log(`Skipped: ${summary.skipped.length}`);
    if (summary.missing.length > 0) {
      console.log(`Missing: ${summary.missing.join(", ")}`);
    }
    if (options.dryRun) console.log("Dry run only.");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
