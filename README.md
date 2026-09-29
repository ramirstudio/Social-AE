# Social AE

Pannello per After Effects che trascrive il parlato di un layer video o audio e crea sottotitoli in stile TikTok/CapCut, con la parola pronunciata evidenziata in tempo reale. Ogni blocco di sottotitolo diventa un normale layer di testo, quindi resta modificabile a mano dopo la generazione.

## Come funziona

Selezioni nella timeline il layer con la voce e premi "Usa layer selezionato". Il pannello legge il file sorgente, estrae con ffmpeg solo la porzione compresa tra punto di attacco e di stacco del layer, e la manda a Whisper, che restituisce il tempo d'inizio e di fine di ogni parola. I tempi vengono convertiti in tempo di composizione tenendo conto della posizione del layer e dell'eventuale allungamento temporale.

La trascrizione appare divisa in blocchi. Un blocco si chiude quando raggiunge il numero massimo di parole o di righe, quando finisce una frase o quando c'è una pausa più lunga della soglia impostata. Con doppio clic correggi una parola (se la svuoti la elimini, se ci scrivi più parole il tempo viene diviso fra loro); con Shift + clic fai iniziare un nuovo blocco da quella parola.

Quando premi "Crea sottotitoli" ogni blocco diventa un layer di testo con questi animatori:

- "Parola attiva": colore (e scala, se diversa da 100%) applicati da un selettore di intervallo in modalità Indice, basato sulle parole. Inizio e fine del selettore sono guidati da un'espressione che contiene i tempi delle parole, quindi la selezione salta da una parola all'altra esattamente quando viene pronunciata.
- "Attenua": opacità ridotta su tutto il blocco tranne la parola in corso.
- "Comparsa": le parole non ancora dette restano invisibili.

Se vuoi ritoccare una parola a mano puoi modificare i numeri nell'array `s` dell'espressione. I layer creati hanno il commento "SocialAE caption": è così che il pulsante "Rimuovi" e l'opzione "Sostituisci quelli esistenti" li riconoscono senza toccare gli altri layer.

## Requisiti

After Effects 2021 (18.0) o successivo. L'elenco dei font installati compare solo da After Effects 24.0 in poi, perché prima non esiste un modo di leggerlo da script: nelle versioni precedenti scrivi il nome PostScript del font (per esempio `Montserrat-Black`), che trovi nel pannello Carattere.

ffmpeg deve essere installato. Su macOS con Homebrew: `brew install ffmpeg`. Su Windows scarica una build da ffmpeg.org e indica il percorso di `ffmpeg.exe` nelle impostazioni del pannello se non viene trovato da solo.

Per la trascrizione puoi scegliere tra due motori.

OpenAI Whisper usa l'API a pagamento (modello `whisper-1`, pochi centesimi al minuto) e richiede una chiave API. L'audio viene compresso in MP3 mono: il limite dell'API di 25 MB corrisponde a circa un'ora di parlato. La chiave resta salvata solo nel localStorage del pannello, sul tuo computer.

whisper.cpp gira in locale, gratis e senza inviare l'audio fuori. Compila o scarica [whisper.cpp](https://github.com/ggml-org/whisper.cpp), scarica un modello (per l'italiano `ggml-medium.bin` o `ggml-large-v3-turbo.bin` danno buoni risultati) e indica nelle impostazioni il percorso dell'eseguibile `whisper-cli` e del file del modello.

Nel campo "Parole difficili" puoi scrivere nomi propri, marchi o termini tecnici: vengono passati al modello come contesto e migliorano l'ortografia di quelle parole.

## Installazione

Il pannello non è firmato, quindi va abilitata la modalità debug di CEP una volta sola.

Su macOS, dal Terminale:

```sh
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

Su Windows, dal Prompt dei comandi:

```bat
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

Poi copia (o collega con un link simbolico) l'intera cartella del progetto in:

- macOS: `~/Library/Application Support/Adobe/CEP/extensions/Social-AE`
- Windows: `%APPDATA%\Adobe\CEP\extensions\Social-AE`

Riavvia After Effects e apri il pannello da Finestra > Estensioni > Social AE — Sottotitoli.

Per il debug, con After Effects aperto vai su `http://localhost:8088` in Chrome: la porta è definita nel file `.debug`.

## Limiti noti

Il layer selezionato deve avere come sorgente un file. Per una precomposizione seleziona il layer originale dentro la precomp e lancia la trascrizione da lì. Il remapping temporale e i layer con tempo invertito non sono gestiti. Il riquadro colorato dietro la singola parola, tipico di alcuni stili CapCut, non è ancora disponibile: con gli animatori di testo di After Effects non si può disegnare un rettangolo che segua una parola.

## Sviluppo

La logica di divisione in blocchi e il parsing delle risposte dei due motori non dipendono da After Effects e si testano con Node 18 o successivo:

```sh
npm test
```

La struttura: `CSXS/manifest.xml` dichiara il pannello, `client/` contiene l'interfaccia (HTML, CSS e JavaScript, con accesso a Node per ffmpeg e i file), `host/host.jsx` è lo script ExtendScript che crea i layer dentro After Effects.
