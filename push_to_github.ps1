# ============================================================================
# Docify — One-Click GitHub Push Script for krishna050702
# ============================================================================
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$DefaultRepoUrl = "https://github.com/krishna050702/docify-audio-reader.git"

if (Test-Path " render.yaml") {
    Remove-Item " render.yaml" -Force
}

Write-Host "============================================================" -ForegroundColor Green
Write-Host "   Push Docify to https://github.com/krishna050702          " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

$gitCandidates = @(
    "C:\Program Files\Git\cmd",
    "C:\Program Files (x86)\Git\cmd",
    "$env:LOCALAPPDATA\Programs\Git\cmd"
)
foreach ($candidate in $gitCandidates) {
    if ((Test-Path $candidate) -and ($env:PATH -notlike "*$candidate*")) {
        $env:PATH = "$candidate;$env:PATH"
    }
}

if (Get-Command git -ErrorAction SilentlyContinue) {
    if (-Not (Test-Path ".git")) {
        Write-Host "-> Initializing Git repository..." -ForegroundColor Cyan
        git init
        git branch -M main
    }

    Write-Host "-> Staging project files..." -ForegroundColor Cyan
    git add .

    $status = git status --porcelain
    if ($status) {
        Write-Host "-> Creating commit..." -ForegroundColor Cyan
        git commit -m "Initial commit: Docify — Spotify for PDF & Word Documents (React Native + FastAPI)"
    }

    Write-Host ""
    $inputUrl = Read-Host "Press Enter to push to [$DefaultRepoUrl] or paste a custom URL"
    $repoUrl = if ($inputUrl.Trim()) { $inputUrl.Trim() } else { $DefaultRepoUrl }

    $existingRemote = git remote
    if ($existingRemote -contains "origin") {
        git remote set-url origin $repoUrl
    } else {
        git remote add origin $repoUrl
    }

    Write-Host "-> Pushing to $repoUrl (main branch)..." -ForegroundColor Green
    git push -u origin main
    Write-Host ""
    Write-Host "Successfully pushed Docify to $repoUrl !" -ForegroundColor Green
} else {
    Write-Host "-> Using built-in Python GitHub Uploader for krishna050702..." -ForegroundColor Cyan
    Write-Host ""
    python upload_to_github_api.py
}
