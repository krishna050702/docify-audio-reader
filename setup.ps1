# ============================================================================
# Docify - Automated Setup & Launcher Script (Windows PowerShell)
# ============================================================================
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host "============================================================" -ForegroundColor Green
Write-Host "   Docify - Spotify for PDF & Word Documents (Setup)        " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

# 1. Check Python & Set up FastAPI Backend Virtual Environment
Write-Host "[1/3] Checking Python environment..." -ForegroundColor Cyan
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pyVer = python --version
    Write-Host "  -> Found $pyVer" -ForegroundColor Gray

    $venvPath = Join-Path $ProjectRoot "backend\.venv"
    if (-Not (Test-Path $venvPath)) {
        Write-Host "  -> Creating Python virtual environment in backend\.venv..." -ForegroundColor Yellow
        python -m venv $venvPath
    }

    $pipExe = Join-Path $venvPath "Scripts\pip.exe"
    $reqFile = Join-Path $ProjectRoot "backend\requirements.txt"
    Write-Host "  -> Installing FastAPI, PyMuPDF, python-docx & edge-tts..." -ForegroundColor Yellow
    & $pipExe install --upgrade pip --quiet
    & $pipExe install -r $reqFile
    Write-Host "  -> Backend dependencies installed successfully!" -ForegroundColor Green
} else {
    Write-Host "  [!] Python not found in PATH. Please install Python 3.10+ from python.org." -ForegroundColor Red
}

Write-Host ""

# 2. Check Node.js & Install React Native (Expo) Mobile Dependencies
Write-Host "[2/3] Checking Node.js & npm for React Native (Expo)..." -ForegroundColor Cyan
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $nodeVer = node -v
    Write-Host "  -> Found Node.js $nodeVer" -ForegroundColor Gray
    Push-Location (Join-Path $ProjectRoot "mobile")
    Write-Host "  -> Running npm install in mobile\..." -ForegroundColor Yellow
    npm install
    Pop-Location
    Write-Host "  -> Mobile app dependencies installed successfully!" -ForegroundColor Green
} else {
    Write-Host "  [!] Node.js (npm) is not currently in your PATH." -ForegroundColor Yellow
    Write-Host "      To run or build the React Native mobile app, install Node.js LTS:" -ForegroundColor Yellow
    Write-Host "      winget install OpenJS.NodeJS.LTS" -ForegroundColor White
    Write-Host "      (You can still run the FastAPI Backend & Interactive Web Preview right now!)" -ForegroundColor Gray
}

Write-Host ""

# 3. Copy .env.example to .env if not present
$envExample = Join-Path $ProjectRoot ".env.example"
$envTarget = Join-Path $ProjectRoot ".env"
if ((Test-Path $envExample) -and (-Not (Test-Path $envTarget))) {
    Copy-Item $envExample $envTarget
    Write-Host "[3/3] Created default .env configuration file." -ForegroundColor Green
} else {
    Write-Host "[3/3] Environment configuration ready." -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Setup Complete! How would you like to launch Docify?       " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  [1] Open Instant Interactive Web Preview in Browser"
Write-Host "  [2] Start FastAPI Backend Server + Web Preview (http://localhost:8000)"
Write-Host "  [3] Start React Native (Expo) Mobile Server"
Write-Host "  [4] Exit"
Write-Host ""

$choice = Read-Host "Select an option (1-4)"

if ($choice -eq "1") {
    $htmlPath = Join-Path $ProjectRoot "web-preview\index.html"
    Start-Process $htmlPath
} elseif ($choice -eq "2") {
    $uvicornExe = Join-Path $ProjectRoot "backend\.venv\Scripts\uvicorn.exe"
    Push-Location (Join-Path $ProjectRoot "backend")
    Write-Host "Starting Docify Backend on http://localhost:8000 ..." -ForegroundColor Green
    Start-Process "http://localhost:8000"
    & $uvicornExe main:app --host 0.0.0.0 --port 8000 --reload
    Pop-Location
} elseif ($choice -eq "3") {
    Push-Location (Join-Path $ProjectRoot "mobile")
    npx expo start
    Pop-Location
} else {
    Write-Host "All set! See SETUP.md and README.md for commands." -ForegroundColor Cyan
}

