# Voicebox Setup Script for Windows
# Run this on your actual machine (not sandbox) for full GPU support

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Voicebox Setup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check Python version
$pythonVersion = python --version 2>&1
Write-Host "Python version: $pythonVersion"

if ($pythonVersion -notmatch "3\.12") {
    Write-Host "WARNING: Voicebox requires Python 3.12. You have: $pythonVersion" -ForegroundColor Yellow
    Write-Host "Please install Python 3.12 from https://python.org" -ForegroundColor Yellow
    exit 1
}

# Check for GPU
Write-Host "`nChecking GPU..." -ForegroundColor Green
$nvidiaSmi = nvidia-smi 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "NVIDIA GPU detected:" -ForegroundColor Green
    Write-Host $nvidiaSmi
} else {
    Write-Host "No NVIDIA GPU detected via nvidia-smi. Will use CPU mode." -ForegroundColor Yellow
}

# Create venv
$venvPath = ".venv-voicebox-py312"
if (-not (Test-Path $venvPath)) {
    Write-Host "`nCreating Python 3.12 virtual environment..." -ForegroundColor Green
    python -m venv $venvPath
}

# Activate venv
Write-Host "`nActivating virtual environment..." -ForegroundColor Green
& "$venvPath\Scripts\Activate.ps1"

# Upgrade pip
Write-Host "`nUpgrading pip..." -ForegroundColor Green
python -m pip install --upgrade pip setuptools wheel

# Install PyTorch with CUDA 12.6
Write-Host "`nInstalling PyTorch with CUDA 12.6 support..." -ForegroundColor Green
python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126

# Install Voicebox requirements
Write-Host "`nInstalling Voicebox requirements..." -ForegroundColor Green
$requirementsPath = "vendor\voicebox\speech\requirements.txt"
if (Test-Path $requirementsPath) {
    python -m pip install -r $requirementsPath
} else {
    Write-Host "requirements.txt not found at $requirementsPath" -ForegroundColor Red
    exit 1
}

# Verify PyTorch CUDA
Write-Host "`nVerifying PyTorch CUDA..." -ForegroundColor Green
python -c "import torch; print(f'PyTorch: {torch.__version__}'); print(f'CUDA available: {torch.cuda.is_available()}'); print(f'CUDA version: {torch.version.cuda}'); print(f'Device count: {torch.cuda.device_count()}')"

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "`nTo start Voicebox server, run:" -ForegroundColor Cyan
Write-Host "  & '$venvPath\Scripts\Activate.ps1'" -ForegroundColor White
Write-Host "  cd vendor\voicebox\speech" -ForegroundColor White
Write-Host "  python -m speech.main --host 127.0.0.1 --port 17493" -ForegroundColor White
Write-Host "`nThen in another terminal, use VideoForge plugins:" -ForegroundColor Cyan
Write-Host "  npx forge voice.voicebox_kokoro --text 'Hello world' --profile af_heart" -ForegroundColor White
