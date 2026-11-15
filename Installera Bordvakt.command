#!/bin/bash
# Dubbelklicka för att installera Bordvakt (AI-motorn) på den här Macen.
# Första gången: högerklicka → Öppna, om macOS frågar om programmet är säkert.
cd "$(dirname "$0")" || exit 1
bash install/install-mac.sh
echo
read -n 1 -s -r -p "Tryck på valfri tangent för att stänga fönstret."
