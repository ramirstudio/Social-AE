#!/bin/bash
# Installa il pannello Social AE in After Effects (macOS).
# Doppio clic sul file, oppure: bash install/install-mac.command
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/Social-AE"

# Il pannello non è firmato: CEP lo carica solo in modalità debug.
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
# Link simbolico: gli aggiornamenti della cartella arrivano subito in After Effects.
ln -s "$SRC" "$DEST"

echo "Installato in: $DEST"
echo "Riavvia After Effects e apri Finestra > Estensioni > Social AE."
