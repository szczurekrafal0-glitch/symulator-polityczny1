@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo Pierwsze uruchomienie - instaluje potrzebne paczki, to moze potrwac chwile...
  call npm install
)

start "" http://localhost:5173
call npm run dev
