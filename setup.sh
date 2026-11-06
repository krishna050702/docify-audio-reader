#!/usr/bin/env bash
set -e

echo "============================================================"
echo "   Docify — Spotify for PDF & Word Documents (Setup)        "
echo "============================================================"

# 1. Backend Python Setup
if command -v python3 &>/dev/null; then
  echo "[1/3] Setting up Python FastAPI Backend..."
  cd backend
  python3 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip -q
  pip install -r requirements.txt
  deactivate
  cd ..
  echo "  -> Backend dependencies installed!"
else
  echo "  [!] python3 not found. Please install Python 3.10+."
fi

# 2. Mobile React Native (Expo) Setup
if command -v npm &>/dev/null; then
  echo "[2/3] Installing React Native (Expo) dependencies..."
  cd mobile
  npm install
  cd ..
  echo "  -> Mobile dependencies installed!"
else
  echo "  [!] npm not found. Install Node.js LTS from https://nodejs.org to run the mobile app."
fi

# 3. Environment file
if [ -f ".env.example" ] && [ ! -f ".env" ]; then
  cp .env.example .env
  echo "[3/3] Created .env from .env.example"
fi

echo ""
echo "Setup complete! Quick commands:"
echo "  • Run Backend API:   cd backend && source .venv/bin/activate && uvicorn main:app --port 8000 --reload"
echo "  • Run Mobile App:    cd mobile && npx expo start"
echo "  • Open Web Preview:  open web-preview/index.html"
