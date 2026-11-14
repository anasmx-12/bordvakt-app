#!/bin/bash
# Bordvakt: stoppar AI-motorn och tar bort autostarten. Programfilerna och .env ligger kvar.
set -uo pipefail
LABEL="se.bordvakt.engine"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
pkill -f "cloudflared tunnel --no-autoupdate" 2>/dev/null || true
echo "AI-motorn är stoppad och startar inte längre av sig själv."
echo "Koppla också bort datorn i webbappen (Inställningar → AI-datorn → Skapa ny kopplingskod) om den inte ska användas mer."
