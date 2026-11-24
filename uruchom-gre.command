#!/usr/bin/env bash
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Pierwsze uruchomienie - instaluję potrzebne paczki, to może potrwać chwilę..."
  npm install
fi

( sleep 2; open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null ) &
npm run dev
