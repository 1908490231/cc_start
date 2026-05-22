import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFile);
const desktopDir = resolve(scriptDir, '..');
const srcTauriDir = join(desktopDir, 'src-tauri');

export function isBuildCommand(args) {
  return args[0] === 'build';
}

export function getInstallerRenamePlan({ srcTauriDir, productName, version, arch }) {
  const nsisDir = join(srcTauriDir, 'target', 'release', 'bundle', 'nsis');
  const releaseName = productName.replace(/\s+/g, '-');

  return {
    source: join(nsisDir, `${productName}_${version}_${arch}-setup.exe`),
    target: join(nsisDir, `${releaseName}_${version}_${arch}-setup.exe`),
  };
}

function getTauriArch() {
  if (process.arch === 'x64') return 'x64';
  if (process.arch === 'ia32') return 'x86';
  return process.arch;
}

function loadTauriConfig() {
  const configPath = join(srcTauriDir, 'tauri.conf.json');
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function renameInstaller() {
  const config = loadTauriConfig();
  const plan = getInstallerRenamePlan({
    srcTauriDir,
    productName: config.productName,
    version: config.version,
    arch: getTauriArch(),
  });

  if (plan.source === plan.target) return;

  if (!existsSync(plan.source)) {
    console.warn(`[release] installer not found, skipped rename: ${plan.source}`);
    return;
  }

  if (existsSync(plan.target)) {
    rmSync(plan.target);
  }

  renameSync(plan.source, plan.target);
  console.log(`[release] renamed installer: ${plan.target}`);
}

function runTauri(args) {
  const tauriCli = join(desktopDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const child = spawn(process.execPath, [tauriCli, ...args], {
    cwd: desktopDir,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    if (code !== 0) {
      process.exit(code ?? 1);
      return;
    }

    if (isBuildCommand(args)) {
      renameInstaller();
    }
  });
}

const isDirectRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  runTauri(process.argv.slice(2));
}
