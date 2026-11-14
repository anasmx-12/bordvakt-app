#!/bin/bash
# Bordvakt: installerar AI-motorn på restaurangens Mac.
#
#   bash install/install-mac.sh
#
# Gör så här:
# 1. Installerar Python-paketen (i mappen .venv).
# 2. Installerar cloudflared (den krypterade tunneln till webbappen).
# 3. Installerar chatten Vakti (Ollama och språkmodellen), om du vill.
# 4. Frågar efter kopplingskoden (webbappen: Inställningar → AI-datorn) och sparar den i .env.
# 5. Startar AI-motorn och ser till att den startar av sig själv när datorn slås på,
#    och startas om om den skulle krascha.
#
# Kan köras igen, t.ex. med en ny kopplingskod. Avinstallera: bash install/uninstall-mac.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="se.bordvakt.engine"
AGENT_DIR="${BORDVAKT_AGENT_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$AGENT_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Bordvakt"
BIN="$HOME/.local/bin"
DRY_RUN="${BORDVAKT_DRY_RUN:-0}"   # 1 = gör allt utom att starta tjänsten (för test)

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mFel: %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "Det här programmet är för Mac."
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=amd64 ;;
  *) fail "Okänd processor: $(uname -m)" ;;
esac
mkdir -p "$BIN" "$LOG_DIR"

# ---------------------------------------------------------------- 1. Python
say "1/5 Python och paket"
good_python() { [ -x "$1" ] && "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; }
if ! good_python "$DIR/.venv/bin/python"; then
  # Macens egen Python är för gammal (3.9). uv hämtar en ny Python utan att något annat ändras.
  UV="$(command -v uv || true)"
  if [ -z "$UV" ]; then
    UV_ARCH=$([ "$ARCH" = arm64 ] && echo aarch64 || echo x86_64)
    TMP="$(mktemp -d)"
    curl -fsSL -o "$TMP/uv.tgz" "https://github.com/astral-sh/uv/releases/latest/download/uv-$UV_ARCH-apple-darwin.tar.gz" \
      || fail "Kunde inte ladda ner Python-verktyget. Kontrollera internet och försök igen."
    tar -xzf "$TMP/uv.tgz" -C "$TMP"
    install -m 755 "$TMP/uv-$UV_ARCH-apple-darwin/uv" "$BIN/uv"
    rm -rf "$TMP"
    UV="$BIN/uv"
  fi
  rm -rf "$DIR/.venv"
  "$UV" venv --quiet --python 3.12 --seed "$DIR/.venv" || fail "Kunde inte installera Python."
fi
"$DIR/.venv/bin/python" -m pip install --quiet --upgrade pip
"$DIR/.venv/bin/python" -m pip install --quiet -r "$DIR/requirements.txt" || fail "Kunde inte installera paketen."
echo "Klart."

# ---------------------------------------------------------------- 2. Tunnel
say "2/5 Tunnel (cloudflared)"
if command -v cloudflared >/dev/null || [ -x "$BIN/cloudflared" ]; then
  echo "Redan installerad."
else
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/cf.tgz" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" \
    || fail "Kunde inte ladda ner cloudflared. Kontrollera internet och försök igen."
  tar -xzf "$TMP/cf.tgz" -C "$TMP"
  install -m 755 "$TMP/cloudflared" "$BIN/cloudflared"
  rm -rf "$TMP"
  echo "Installerad: $("$BIN/cloudflared" --version)"
fi

# ---------------------------------------------------------------- 3. Vakti
say "3/5 Chatten Vakti (valfritt, ca 3 GB)"
OLLAMA="$HOME/.local/ollama/ollama"
command -v ollama >/dev/null && OLLAMA="$(command -v ollama)"
if [ -x "$OLLAMA" ]; then
  echo "Ollama finns redan."
  WANT_CHAT=j
else
  WANT_CHAT="${BORDVAKT_CHAT:-}"
  [ -n "$WANT_CHAT" ] || read -r -p "Installera chatten som hjälper personalen? [J/n] " WANT_CHAT </dev/tty || WANT_CHAT=j
  WANT_CHAT="${WANT_CHAT:-j}"
  if [[ "$WANT_CHAT" =~ ^[JjYy] ]]; then
    mkdir -p "$HOME/.local/ollama"
    curl -fsSL -o "$HOME/.local/ollama/ollama.tgz" "https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz" \
      || fail "Kunde inte ladda ner Ollama."
    tar -xzf "$HOME/.local/ollama/ollama.tgz" -C "$HOME/.local/ollama" && rm "$HOME/.local/ollama/ollama.tgz"
    OLLAMA="$HOME/.local/ollama/ollama"
  fi
fi
if [[ "$WANT_CHAT" =~ ^[JjYy] ]] && [ -x "$OLLAMA" ]; then
  MODEL="$(grep -E '^CHAT_MODEL=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  MODEL="${MODEL:-qwen3:4b-instruct}"
  pgrep -qf "ollama serve" || ("$OLLAMA" serve >/dev/null 2>&1 &)
  for _ in $(seq 1 20); do curl -fs http://127.0.0.1:11434/api/version >/dev/null && break; sleep 0.5; done
  echo "Laddar ner språkmodellen $MODEL (kan ta några minuter)..."
  "$OLLAMA" pull "$MODEL" || echo "Kunde inte ladda ner modellen nu. Chatten laddar ner den senare."
fi

# ---------------------------------------------------------------- 4. Kopplingskod
say "4/5 Koppla datorn till restaurangen"
ENV="$DIR/.env"
[ -f "$ENV" ] || cp "$DIR/.env.example" "$ENV"
CURRENT="$(grep -E '^ENGINE_CODE=BV1\.' "$ENV" | cut -d= -f2- || true)"
echo "Skapa koden i webbappen: Inställningar → AI-datorn → Skapa kopplingskod."
if [ -n "$CURRENT" ]; then
  echo "(Tryck bara Enter för att behålla koden som redan finns.)"
fi
CODE="${BORDVAKT_CODE:-}"   # kan också ges i förväg: BORDVAKT_CODE=BV1.... bash install/install-mac.sh
if [ -z "$CODE" ]; then
  read -r -s -p "Klistra in kopplingskoden: " CODE </dev/tty || CODE=""
  echo
fi
CODE="$(printf '%s' "$CODE" | tr -d '[:space:]')"
CODE="${CODE:-$CURRENT}"
"$DIR/.venv/bin/python" -c 'import sys, engine_security as s; sys.exit(0 if s.parse_code(sys.argv[1]) else 1)' "$CODE" 2>/dev/null \
  || fail "Koden ser inte rätt ut. Kopiera hela koden (den börjar med BV1.) och försök igen."

# Spara koden. Service-nyckeln och RESTAURANT_ID behövs inte längre och tas bort.
TMP_ENV="$(mktemp)"
grep -vE '^(ENGINE_CODE|SUPABASE_SERVICE_KEY|RESTAURANT_ID)=' "$ENV" > "$TMP_ENV" || true
printf '\n# Kopplingskoden (Inställningar → AI-datorn). Hemlig: dela den inte.\nENGINE_CODE=%s\n' "$CODE" >> "$TMP_ENV"
mv "$TMP_ENV" "$ENV"
chmod 600 "$ENV"   # bara den här användaren kan läsa filen
echo "Sparad."

# ---------------------------------------------------------------- 5. Autostart
say "5/5 Starta AI-motorn (och vid varje omstart)"
mkdir -p "$AGENT_DIR"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DIR/.venv/bin/python</string>
    <string>$DIR/AI.py</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$BIN:$HOME/.local/ollama:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>PYTHONUNBUFFERED</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG_DIR/engine.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/engine.log</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null || fail "Kunde inte skapa startfilen."

if [ "$DRY_RUN" = "1" ]; then
  echo "Testläge: startar inte tjänsten. Startfil: $PLIST"
  exit 0
fi

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

# Väntar på att motorn svarar
PORT="$(grep -E '^STREAM_PORT=' "$ENV" | cut -d= -f2- || true)"; PORT="${PORT:-8080}"
for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null; then
  say "Klart! AI-motorn är igång och startar av sig själv när datorn slås på."
  echo "Gå tillbaka till webbappen och fortsätt installationen där."
else
  echo "AI-motorn startade inte än. Se loggen: $LOG_DIR/engine.log"
fi
cat <<TIPS

Bra att veta:
- Datorn ska stå på och inte gå i viloläge (Systeminställningar → Energi → Förhindra automatisk vila).
- Loggen finns i $LOG_DIR/engine.log
- Starta om:     launchctl kickstart -k gui/\$(id -u)/$LABEL
- Avinstallera:  bash install/uninstall-mac.sh
TIPS
