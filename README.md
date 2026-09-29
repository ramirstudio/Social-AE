# Social AE

Pannello per After Effects che trascrive il parlato di un layer video o audio e crea sottotitoli in stile TikTok/CapCut, con la parola pronunciata evidenziata in tempo reale. Ogni blocco di sottotitolo diventa un normale layer di testo, quindi resta modificabile a mano dopo la generazione.

## Come funziona

Selezioni nella timeline uno o più layer con la voce e premi "Leggi audio"; senza selezione il pannello prende tutta la composizione. Lo script entra nelle precomposizioni fino ai file originali e, fotogramma per fotogramma, annota a quale istante del file corrisponde ogni istante della composizione, tenendo conto di posizione, allungamento temporale, remapping e punti di attacco e stacco a ogni livello. I layer con l'audio spento vengono ignorati.

Poi ffmpeg estrae solo le porzioni di file che si sentono davvero. Se lo stesso file è usato in più clip vicine viene trascritto una volta sola. Whisper restituisce il tempo d'inizio e di fine di ogni parola, e il pannello li riporta in tempo di composizione. Le parole tagliate dal montaggio spariscono. Se lo stesso parlato arriva da due tracce, per esempio audio della camera e microfono, i doppioni vengono tolti.

La trascrizione appare divisa in blocchi. Un blocco si chiude quando raggiunge il numero massimo di parole o di righe, quando finisce una frase o quando c'è una pausa più lunga della soglia impostata. Con doppio clic correggi una parola (se la svuoti la elimini, se ci scrivi più parole il tempo viene diviso fra loro); con Shift + clic fai iniziare un nuovo blocco da quella parola.

Quando premi "Crea sottotitoli" ogni blocco diventa un layer di testo con questi animatori:

- "Parola attiva": colore (e scala, se diversa da 100%) applicati da un selettore di intervallo in modalità Indice, basato sulle parole. Inizio e fine del selettore sono guidati da un'espressione che contiene i tempi delle parole, quindi la selezione salta da una parola all'altra esattamente quando viene pronunciata.
- "Attenua": opacità ridotta su tutto il blocco tranne la parola in corso.
- "Comparsa": le parole non ancora dette restano invisibili.

Con "Riquadro colorato dietro la parola" viene creato anche un layer forma, imparentato al testo e posto sotto, con un rettangolo che scivola da una parola all'altra. After Effects non dà accesso alla posizione delle singole parole, quindi lo script la misura durante la creazione: cambia per un attimo il testo del layer e legge `sourceRectAtTime` per ogni prefisso di riga. Il risultato finisce nelle espressioni di Dimensione e Posizione del rettangolo. Se dopo la generazione cambi font, dimensione o testo di un blocco, il riquadro non si aggiorna: rigenera i sottotitoli.

Se vuoi ritoccare una parola a mano puoi modificare i numeri nell'array `s` dell'espressione. I layer creati hanno il commento "SocialAE caption": è così che il pulsante "Rimuovi" e l'opzione "Sostituisci quelli esistenti" li riconoscono senza toccare gli altri layer.

## Requisiti

After Effects 2021 (18.0) o successivo. L'elenco dei font installati compare solo da After Effects 24.0 in poi, perché prima non esiste un modo di leggerlo da script: nelle versioni precedenti scrivi il nome PostScript del font (per esempio `Montserrat-Black`), che trovi nel pannello Carattere.

ffmpeg deve essere installato. Su macOS con Homebrew: `brew install ffmpeg`. Su Windows scarica una build da ffmpeg.org e indica il percorso di `ffmpeg.exe` nelle impostazioni del pannello se non viene trovato da solo.

Per la trascrizione puoi scegliere tra due motori.

OpenAI Whisper usa l'API a pagamento (modello `whisper-1`, pochi centesimi al minuto) e richiede una chiave API. L'audio viene compresso in MP3 mono: il limite dell'API di 25 MB corrisponde a circa un'ora di parlato. La chiave resta salvata solo nel localStorage del pannello, sul tuo computer.

whisper.cpp gira in locale, gratis e senza inviare l'audio fuori. Compila o scarica [whisper.cpp](https://github.com/ggml-org/whisper.cpp), scarica un modello (per l'italiano `ggml-medium.bin` o `ggml-large-v3-turbo.bin` danno buoni risultati) e indica nelle impostazioni il percorso dell'eseguibile `whisper-cli` e del file del modello.

Nel campo "Parole difficili" puoi scrivere nomi propri, marchi o termini tecnici: vengono passati al modello come contesto e migliorano l'ortografia di quelle parole.

## Installazione

Nella cartella `install` ci sono due script che fanno tutto: abilitano la modalità debug di CEP, necessaria perché il pannello non è firmato, e collegano questa cartella a quella delle estensioni di After Effects.

- macOS: doppio clic su `install/install-mac.command`. Se macOS lo blocca, clic destro > Apri, oppure dal Terminale `bash install/install-mac.command`.
- Windows: doppio clic su `install/install-windows.bat`.

Poi riavvia After Effects e apri il pannello da Finestra > Estensioni > Social AE — Sottotitoli. Visto che la cartella è collegata e non copiata, non spostarla dopo l'installazione; se la sposti, rilancia lo script.

Se preferisci fare a mano, su macOS dal Terminale:

```sh
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

Su Windows, dal Prompt dei comandi:

```bat
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

e copia l'intera cartella del progetto in:

- macOS: `~/Library/Application Support/Adobe/CEP/extensions/Social-AE`
- Windows: `%APPDATA%\Adobe\CEP\extensions\Social-AE`

Per il debug, con After Effects aperto vai su `http://localhost:8088` in Chrome: la porta è definita nel file `.debug`.

## Primo test

Il codice che crea i layer è stato provato solo fuori da After Effects, con una simulazione. Al primo utilizzo conviene una prova breve: una comp verticale con 10–20 secondi di parlato, preset "Classico", poi "Crea sottotitoli". Controlla che:

- la parola evidenziata cambi esattamente mentre viene pronunciata (se tutto il blocco si colora o non si colora niente, il problema è nel selettore di intervallo: apri Testo > Parola attiva > Selettore intervallo e guarda Avanzate);
- con la scala della parola sopra 100% ogni parola cresca attorno al proprio centro e non lettera per lettera;
- l'ombra compaia con distanza e morbidezza impostate;
- con il preset "Riquadro sulla parola" il rettangolo stia dietro la parola giusta anche sulla seconda riga.

Poi prova una precomp con una clip tagliata e una con remapping, e confronta i tempi delle parole con l'audio.

Se qualcosa si rompe, il messaggio d'errore in basso nel pannello riporta la riga di `host/host.jsx` che ha fallito.

## Limiti noti

Il riquadro viene misurato una volta sola, alla creazione. Con il remapping, se la stessa frase si sente due volte (loop o ripetizioni) i sottotitoli seguono solo la prima.

## Sviluppo

La divisione in blocchi, la mappatura dei tempi e il parsing delle risposte dei due motori non dipendono da After Effects e si testano con Node 18 o successivo:

```sh
npm test
```

La struttura: `CSXS/manifest.xml` dichiara il pannello, `client/` contiene l'interfaccia (HTML, CSS e JavaScript, con accesso a Node per ffmpeg e i file), `host/host.jsx` è lo script ExtendScript che crea i layer dentro After Effects.
