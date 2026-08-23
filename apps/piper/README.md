# Micado Piper TTS

Servizio interno di sintesi vocale (testo → MP3), basato su [Piper](https://github.com/OHF-voice/piper1-gpl).
Vive sotto `apps/piper` nel monorepo, buildato via Docker Compose.

## Cosa fa (e cosa NON fa)

Due sole responsabilità:

1. **`POST /jobs`** — riceve un comando di sintesi, lo accoda, risponde `202` subito (fire-and-forget). Non aspetta la sintesi.
2. **A sintesi conclusa** — scrive il file `.mp3` sul volume audio condiviso e chiama il backend (`PIPER_CALLBACK_BASE_URL`) per notificarlo, sia in caso di successo sia di fallimento.

Non sa nulla del modello dati applicativo (content_item/content_revision/content_revision_translation) — quello resta di competenza esclusiva del backend, che decide anche la convenzione di naming dei file (`output_relative_path` è opaco per questo servizio, a parte la validazione anti path-traversal).

## Volumi

Il container si aspetta due volumi montati (nomi coerenti con `docker-compose.yml`):

| Path in container | Volume compose | Scrittura | Contenuto |
|---|---|---|---|
| `/models` | `piper_models` | sola lettura per questo servizio | modelli `.onnx`/`.onnx.json` + `voices.json` |
| `/audio`  | `piper_audio`  | **unico scrittore RW** | file `.mp3` generati |

Tutti gli altri servizi (`backend`, `pa_frontoffice`, `migrants`, eventualmente `ngo_frontoffice`) montano `piper_audio` in **sola lettura** — vedi le note di infrastruttura nel documento di riprogettazione.

### `voices.json`

File JSON dentro `/models`, lingua → nome voce (senza estensione):

```json
{
  "en": "en_US-lessac-medium",
  "it": "it_IT-riccardo-x_low"
}
```

Per ogni voce ci si aspetta `<nome>.onnx` e `<nome>.onnx.json` nella stessa cartella. Aggiungere una lingua = aggiungere i due file del modello + una riga qui — **mai** un rebuild dell'immagine. Un esempio è in `models/voices.example.json` (rinominare in `voices.json` sul volume reale).

## Configurazione (variabili d'ambiente)

Vedi `app/config.py` per l'elenco completo con i default. Le più rilevanti:

| Variabile | Default | Note |
|---|---|---|
| `MODELS_DIR` | `/models` | invariata rispetto alla versione precedente |
| `OUTPUT_DIR` | `/audio` | invariata rispetto alla versione precedente |
| `PIPER_CALLBACK_BASE_URL` | `http://backend:3000` | dove notificare a sintesi conclusa |
| `PIPER_WEBHOOK_SECRET` | *(vuoto)* | se impostato, firma la callback (HMAC-SHA256) |
| `PIPER_WORKER_CONCURRENCY` | `2` | sintesi CPU-bound concorrenti |
| `PIPER_QUEUE_MAXSIZE` | `100` | oltre questo, `POST /jobs` risponde `503` |
| `OUTPUT_SAMPLE_RATE` / `OUTPUT_BITRATE` | `22050` / `64000` | parametri MP3 di output |
| `PIPER_DEBUG_FILE_API` | `true` | espone `GET /files` e `GET /files/{path}` — vedi sotto |

## API

OpenAPI generata automaticamente da FastAPI:

- `GET /docs` — Swagger UI
- `GET /redoc` — ReDoc
- `GET /openapi.json` — schema grezzo

Endpoint applicativi: `GET /health`, `GET /voices`, `POST /jobs` (vedi lo schema OpenAPI per il contratto completo).

### Debug: ispezionare i file scritti (`GET /files`)

`POST /jobs` risponde `202` subito e il vero esito arriva solo con la callback
asincrona: senza un modo per guardare dentro al volume, "è andato a buon
fine?" richiede di aprire una shell nel container. Per questo, oltre alla
callback, il servizio espone due endpoint di sola lettura pensati per
sviluppo/troubleshooting (**non** il percorso con cui gli utenti finali
ricevono l'audio — quello resta nginx su PA/migrant che legge il volume
montato in sola lettura):

- `GET /files?prefix=&limit=200` — elenca gli `.mp3` presenti sotto
  `OUTPUT_DIR`, più recenti prima. `prefix` filtra per path relativo (es.
  `user-types/42/`), `limit` (1–1000, default 200) taglia il risultato e
  imposta `truncated: true` se ce n'erano di più.
- `GET /files/{path}` — restituisce il file `.mp3` puntuale (content-type
  `audio/mpeg`, supporta le Range request per lo scrubbing da player). `404`
  se il file non esiste ancora. Stessa validazione anti path-traversal usata
  per `output_relative_path` in `POST /jobs`.

Entrambi sono disattivabili in blocco impostando `PIPER_DEBUG_FILE_API=false`
(default `true`) — utile per spegnerli in produzione senza toccare il codice;
va comunque notato che il servizio non è instradato da Traefik
(`traefik.enable=false`), quindi non è comunque raggiungibile dall'esterno
per default.

## Sviluppo locale

```bash
pip install -r requirements.txt
MODELS_DIR=./models OUTPUT_DIR=./audio uvicorn app.main:app --reload --port 8080
```

## Note di design

Nessun uso di shell/subprocess: la sintesi usa la libreria `piper-tts` direttamente (`piper.PiperVoice`), la codifica MP3 usa `av` (PyAV). Il rename del file finale è atomico (scrittura su path temporaneo + `Path.replace()`) così un consumatore che legga il volume non vede mai un file a metà scrittura.

Per il ragionamento completo (perché queste scelte, alternative valutate, cosa verificare ancora) vedi il documento di riprogettazione condiviso separatamente.
