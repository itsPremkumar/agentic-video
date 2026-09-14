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

// Try to find a Python 3.12 executable automatically on Windows.
function findPython312() {
    if (!isWin) return 'python3.12';
    const candidates = [
        'C:\\Python312\\python.exe',
        'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
        'C:\\Program Files\\Python312\\python.exe',
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

// Warn if the user is on Python 3.13+ (Kokoro 0.9.4 requires 3.10-3.12).
function checkPythonVersion(pyExe) {
    const r = spawnSync(pyExe, ['--version'], { encoding: 'utf8', shell: isWin });
    const line = (r.stdout || r.stderr || '').trim();
    const m = line.match(/Python\s+(\d+)\.(\d+)/);
    if (!m) return { ok: false, msg: 'Could not detect Python version from: ' + line };
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    if (major === 3 && minor >= 10 && minor <= 12) {
        return { ok: true, version: `${major}.${minor}` };
    }
    return {
        ok: false,
        version: `${major}.${minor}`,
        msg: `Python ${major}.${minor} detected. Kokoro 0.9.4 requires Python 3.10-3.12.`,
    };
}

let basePython = opts.python ?? 'python';
const py312 = findPython312();
if (py312 && !opts.python) {
    console.log('Auto-detected Python 3.12 at:', py312);
    basePython = py312;
}

const venvPython = path.join(opts.venv, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

console.log('=== Agentic Video · Voicebox setup ===');
console.log('venv      :', opts.venv);
console.log('python    :', basePython);

// Validate Python version before doing anything expensive.
const pyCheck = checkPythonVersion(basePython);
if (!pyCheck.ok) {
    console.error('\n[x] Python version check failed:', pyCheck.msg);
    if (py312 && basePython !== py312) {
        console.error('    Try: node scripts/setup-voicebox.mjs --python "' + py312 + '"');
    } else {
        console.error('    Install Python 3.12 from https://www.python.org/downloads/release/python-3120/');
    }
    process.exit(1);
}
console.log('Python version:', pyCheck.version, '(OK)');

if (!fs.existsSync(venvPython)) {
    console.log('\n[1/4] Creating virtual environment...');
    run(basePython, ['-m', 'venv', opts.venv]);
} else {
    console.log('\n[1/4] Reusing existing virtual environment.');
}

console.log('\n[2/4] Upgrading pip...');
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

if (opts.cuda) {
    console.log(`\n[3/4] Installing PyTorch (CUDA ${opts.cuda}) — this is a large download (~2.6 GB)...`);
    run(venvPython, [
        '-m', 'pip', 'install',
        '--index-url', `https://download.pytorch.org/whl/${opts.cuda}`,
        'torch', 'torchaudio',
    ]);
} else {
    console.log('\n[3/4] Installing PyTorch (CPU build)...');
    run(venvPython, ['-m', 'pip', 'install', 'torch', 'torchaudio']);
}

console.log('\n[4/4] Installing backend requirements...');
run(venvPython, ['-m', 'pip', 'install', '-r', REQ]);

// Verify installation
console.log('\n[+] Verifying installation...');
const verify = spawnSync(venvPython, ['-c', 'import torch; print(f"PyTorch {torch.__version__} | CUDA available: {torch.cuda.is_available()} | Devices: {torch.cuda.device_count()}")'], { encoding: 'utf8', shell: isWin });
console.log(verify.stdout?.trim() || verify.stderr?.trim() || 'Verification output unavailable.');

console.log('\n========================================');
console.log('  Voicebox Setup Complete!');
console.log('========================================');
console.log('\nSet this environment variable so plugins find the interpreter:\n');
if (isWin) {
    console.log('  CMD:     set VOICEBOX_PYTHON=' + venvPython);
    console.log('  PowerShell: $env:VOICEBOX_PYTHON="' + venvPython + '"\n');
} else {
    console.log('  export VOICEBOX_PYTHON=' + venvPython + '\n');
}
console.log('Start the server:');
console.log('  npx tsx bin/forge.ts run voice.voicebox_server --input action=start\n');
console.log('Generate your first voice:');
console.log('  npx tsx bin/forge.ts run voice.voicebox_kokoro --input text="Hello world" --input profile=af_heart');
