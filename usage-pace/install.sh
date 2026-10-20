#!/usr/bin/env sh
# Installe le mod usage-pace pour toutes tes sessions Claude Code (macOS / Linux).
# Usage : sh install.sh
set -e
MOD="$(cd "$(dirname "$0")" && pwd)"
FILE="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
[ -f "$FILE" ] && cp "$FILE" "$FILE.bak"

node - "$FILE" "$MOD" <<'JS'
const fs = require('fs')
const [file, mod] = process.argv.slice(2)
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
settings.env ??= {}
// ajoute le dossier du mod à la liste (séparateur : sous macOS / Linux), sans doublon
const dirs = (settings.env.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(':').filter(d => d && d !== mod)
settings.env.CLAUDE_CODE_PLUGIN_DIRS = [...dirs, mod].join(':')
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
JS

echo "usage-pace installé depuis $MOD"
echo "Ouvre une nouvelle session Claude Code : le bandeau apparaît après la première réponse."
