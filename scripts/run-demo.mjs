import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import os from 'node:os';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiCandidates = [
  process.env.TRACK_API_DIR ? resolve(appDir, process.env.TRACK_API_DIR) : null,
  resolve(appDir, '..', 'work', 'track-api-mock'),
  resolve(appDir, '..', 'track-api-mock'),
].filter(Boolean);
const apiDir = apiCandidates.find((candidate) => existsSync(join(candidate, 'server.js')));
if (!apiDir) {
  console.error('Mock API not found. Clone it beside this project with: git clone https://github.com/simplify-money/track-api-mock.git ../track-api-mock');
  console.error('Or set TRACK_API_DIR to the cloned API directory.');
  process.exit(1);
}
const expoCli = resolve(appDir, 'node_modules', 'expo', 'bin', 'cli');
const children = [];
let stopping = false;
let expoArgs = process.argv.slice(2);
const askedForAndroid = expoArgs.includes('--android') || expoArgs.includes('-a');
const sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adbPath = join(sdkPath, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const androidSdkAvailable = existsSync(adbPath);

if (askedForAndroid && !androidSdkAvailable) {
  console.warn('Android SDK/adb was not found. Starting Expo Go mode; scan the QR code instead of launching an emulator.');
  expoArgs = expoArgs.filter((argument) => argument !== '--android' && argument !== '-a');
}

const lanAddresses = Object.values(os.networkInterfaces()).flatMap((entries) => entries ?? [])
  .filter((entry) => !entry.internal && entry.family === 'IPv4' && !entry.address.startsWith('169.254.'))
  .map((entry) => entry.address);
const lanAddress = lanAddresses[0];
const expoEnv = { ...process.env };
if (!expoEnv.EXPO_PUBLIC_API_BASE_URL && !expoArgs.includes('--android') && lanAddress) {
  expoEnv.EXPO_PUBLIC_API_BASE_URL = `http://${lanAddress}:4010`;
  console.log(`Phone API address: ${expoEnv.EXPO_PUBLIC_API_BASE_URL}`);
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = code;
}

const api = spawn(process.execPath, ['server.js'], { cwd: apiDir, stdio: 'inherit', env: process.env });
children.push(api);
api.on('error', (error) => { console.error(`Mock API failed to start: ${error.message}`); stopAll(1); });

const expo = spawn(process.execPath, [expoCli, 'start', ...expoArgs], { cwd: appDir, stdio: 'inherit', env: expoEnv });
children.push(expo);
expo.on('error', (error) => { console.error(`Expo failed to start: ${error.message}`); stopAll(1); });
expo.on('exit', (code) => stopAll(code ?? 0));

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

api.on('exit', (code) => {
  if (!stopping && code !== null && code !== 0) {
    console.error(`Mock API exited with code ${code}`);
    stopAll(code);
  }
});
