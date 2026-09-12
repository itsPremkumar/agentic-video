#!/usr/bin/env node
/**
 * scripts/setup-voicebox.mjs — one-time installer for the vendored Voicebox TTS
 * backend (vendor/voicebox/speech).
 *
 * Creates a dedicated venv at .venv-voicebox (so Agentic Video's own interpreter
 * stays clean) and installs the backend requirements into it.
 *
 * Usage:
 *   node scripts/setup-voicebox.mjs                 # CPU build
 *   node scripts/setup-voicebox.mjs --cuda cu126    # NVIDIA GPU build
 *   node scripts/setup-voicebox.mjs --venv PATH     # custom venv location
 *
 * After it finishes, the plugins will use that interpreter automatically if you
 * set VOICEBOX_PYTHON (the script prints the exact value).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQ = path.join(root, 'vendor', 'voicebox', 'speech', 'requirements.txt');

function parseArgs(argv) {
    const out = { cuda: null, venv: path.join(root, '.venv-voicebox'), python: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--cuda') out.cuda = argv[++i] ?? 'cu126';
        else if (argv[i] === '--venv') out.venv = path.resolve(argv[++i] ?? '');
        else if (argv[i] === '--python') out.python = argv[++i] ?? null;
        else if (argv[i] === '--help' || argv[i] === '-h') {
            console.log('Usage: node scripts/setup-voicebox.mjs [--cuda cu126] [--venv PATH] [--python EXE]');
            process.exit(0);
        }
    }
    return out;
}

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    if (r.error) throw r.error;
    if (r.status !== 0) {
        console.error(`\nCommand failed (exit ${r.status}): ${cmd} ${args.join(' ')}`);
        process.exit(r.status ?? 1);
    }
}

const opts = parseArgs(process.argv.slice(2));

if (!fs.existsSync(REQ)) {
    console.error('Missing ' + REQ);
    console.error('The vendored Voicebox backend does not appear to be present.');
    process.exit(1);
}

const isWin = process.platform === 'win32';
const basePython = opts.python ?? 'python';
const venvPython = path.join(opts.venv, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

console.log('=== Agentic Video · Voicebox setup ===');
console.log('venv      :', opts.venv);

if (!fs.existsSync(venvPython)) {
    console.log('\n[1/3] Creating virtual environment...');
    run(basePython, ['-m', 'venv', opts.venv]);
} else {
    console.log('\n[1/3] Reusing existing virtual environment.');
}

console.log('\n[2/3] Upgrading pip...');
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

if (opts.cuda) {
    console.log(`\n[3/3] Installing PyTorch (CUDA ${opts.cuda}) — this is a large download...`);
    run(venvPython, [
        '-m', 'pip', 'install',
        '--index-url', `https://download.pytorch.org/whl/${opts.cuda}`,
        'torch', 'torchaudio',
    ]);
} else {
    console.log('\n[3/3] Installing PyTorch (CPU build)...');
    run(venvPython, ['-m', 'pip', 'install', 'torch', 'torchaudio']);
}

console.log('\n[+] Installing backend requirements...');
run(venvPython, ['-m', 'pip', 'install', '-r', REQ]);

console.log('\n=== Done ===');
console.log('Set this so the plugins pick up the right interpreter:\n');
if (isWin) {
    console.log('  set VOICEBOX_PYTHON=' + venvPython);
    console.log('  (PowerShell) $env:VOICEBOX_PYTHON="' + venvPython + '"\n');
} else {
    console.log('  export VOICEBOX_PYTHON=' + venvPython + '\n');
}
console.log('Then:  npx tsx bin/forge.ts run voice.voicebox_server --input action=start');
