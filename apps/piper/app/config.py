"""
app/config.py

Configurazione centralizzata via env, con pydantic-settings.

── Nota sui nomi delle variabili ────────────────────────────────────────────
MODELS_DIR e OUTPUT_DIR mantengono ESATTAMENTE i nomi già usati nel
docker-compose.yml del monorepo (servizio `piper`) — non rinominarli senza
aggiornare anche l'infrastruttura. Tutte le altre variabili sono nuove,
introdotte per la riprogettazione (coda, callback, formato output).
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=True)

    # ── Volumi (invariati rispetto al compose esistente) ────────────────────
    MODELS_DIR: Path = Path("/models")
    OUTPUT_DIR: Path = Path("/audio")

    # ── Manifest delle voci ──────────────────────────────────────────────────
    # File JSON dentro MODELS_DIR: {"it": "it_IT-riccardo-x_low", "en": "..."}.
    # Vive nello stesso volume dei modelli così aggiungere una lingua è
    # un'operazione sul volume (drop del file .onnx/.onnx.json + una riga nel
    # manifest), MAI un rebuild dell'immagine.
    VOICES_MANIFEST_FILENAME: str = "voices.json"

    # ── Callback verso il backend ────────────────────────────────────────────
    PIPER_CALLBACK_BASE_URL: str = "http://backend:3000"
    PIPER_CALLBACK_PATH: str = "/webhooks/tts-completed"
    # Se impostato, firma la callback con HMAC-SHA256 (stesso principio già
    # usato per il webhook Weblate nel backend, schema semplificato perché qui
    # controlliamo entrambi i lati). Vuoto = nessuna firma (solo rete interna).
    PIPER_WEBHOOK_SECRET: str = ""
    PIPER_CALLBACK_TIMEOUT_SECONDS: float = 10.0
    PIPER_CALLBACK_MAX_ATTEMPTS: int = 3

    # ── Coda / concorrenza ────────────────────────────────────────────────────
    # La sintesi è CPU-bound: pochi worker concorrenti evitano che richieste
    # consecutive si accodino indefinitamente rubandosi CPU a vicenda.
    PIPER_WORKER_CONCURRENCY: int = 2
    PIPER_QUEUE_MAXSIZE: int = 100

    # ── Formato audio di output ───────────────────────────────────────────────
    OUTPUT_SAMPLE_RATE: int = 22050
    OUTPUT_BITRATE: int = 64000  # bps

    # ── Sintesi ────────────────────────────────────────────────────────────────
    SYNTHESIS_TIMEOUT_SECONDS: float = 120.0

    # ── Endpoint di debug (GET /files, GET /files/{path}) ────────────────────
    # Leggono il volume audio direttamente — comodi in sviluppo per verificare
    # "è andato a buon fine?" senza aprire una shell nel container. Non sono
    # il percorso di produzione (quello è nginx su PA/migrant). Il servizio
    # non è comunque instradato da Traefik (traefik.enable=false nel
    # compose), quindi il rischio di esposizione pubblica è già basso — questo
    # flag è un ulteriore cordone di sicurezza per poterli disattivare del
    # tutto in produzione senza toccare il codice.
    PIPER_DEBUG_FILE_API: bool = True


settings = Settings()
