"""
app/notifier.py

Notifica il backend a sintesi conclusa (successo o fallimento) — questo è
il meccanismo che "sblocca" il DBOS.recv() del backend, invece di un
polling lato backend.

Firma opzionale: se PIPER_WEBHOOK_SECRET è impostato, il body viene firmato
con HMAC-SHA256, seguendo lo stesso principio già in uso nel backend per il
webhook Weblate (vedi weblate-webhook-signature.service.ts) — qui con uno
schema più semplice perché controlliamo entrambi i lati della comunicazione:

    X-Piper-Timestamp: <unix seconds>
    X-Piper-Signature: sha256=<hex hmac(secret, f"{timestamp}.{raw_body}")>
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import time

import httpx

from .config import settings
from .schemas import TtsCallbackPayload

logger = logging.getLogger("piper.notifier")


def _sign(raw_body: bytes, timestamp: str) -> str:
    message = timestamp.encode("utf-8") + b"." + raw_body
    digest = hmac.new(settings.PIPER_WEBHOOK_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


async def notify_backend(payload: TtsCallbackPayload) -> None:
    """Invia la callback con qualche retry — il backend potrebbe essere
    temporaneamente irraggiungibile (riavvio, deploy in corso). Non solleva
    mai eccezioni verso il chiamante: un fallimento qui è solo loggato, il
    file sul volume resta comunque presente per una diagnostica manuale."""
    url = f"{settings.PIPER_CALLBACK_BASE_URL.rstrip('/')}{settings.PIPER_CALLBACK_PATH}"
    raw_body = payload.model_dump_json().encode("utf-8")

    headers = {"Content-Type": "application/json"}
    if settings.PIPER_WEBHOOK_SECRET:
        timestamp = str(int(time.time()))
        headers["X-Piper-Timestamp"] = timestamp
        headers["X-Piper-Signature"] = _sign(raw_body, timestamp)

    attempts = max(1, settings.PIPER_CALLBACK_MAX_ATTEMPTS)
    async with httpx.AsyncClient(timeout=settings.PIPER_CALLBACK_TIMEOUT_SECONDS) as client:
        for attempt in range(1, attempts + 1):
            try:
                response = await client.post(url, content=raw_body, headers=headers)
                response.raise_for_status()
                logger.info(
                    "callback delivered path=%s status=%s attempt=%d/%d",
                    payload.output_relative_path, payload.status, attempt, attempts,
                )
                return
            except Exception as exc:  # noqa: BLE001 — vogliamo ritentare su QUALSIASI errore di rete/HTTP
                logger.warning(
                    "callback delivery failed path=%s attempt=%d/%d error=%s",
                    payload.output_relative_path, attempt, attempts, exc,
                )
                if attempt < attempts:
                    await asyncio.sleep(2 ** attempt)

    logger.error(
        "callback NOT delivered after %d attempts path=%s status=%s — "
        "il file (se generato) resta comunque sul volume condiviso",
        attempts, payload.output_relative_path, payload.status,
    )
