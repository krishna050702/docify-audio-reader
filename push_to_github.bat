@echo off
title Push Docify to GitHub (krishna050702)
cd /d "%~dp0"
if exist " render.yaml" del /f /q " render.yaml"
python upload_to_github_api.py
