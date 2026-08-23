"""
app/main.py

Micado Piper TTS service — due sole responsabilità:
  1) POST /jobs: riceve una richiesta di sintesi, la accoda, risponde subito.
  2) A sintesi conclusa (in background): scrive il file sul volume condiviso
     e chiama il backend per notificarlo (successo o fallimento).

Nessuna terza responsabilità. Le credenziali/logica del modello a tre
livelli (content_item/content_revision/content_revision_translation)
restano DI PROPRIETÀ ESCLUSIVA del backend — questo servizio non sa nulla
del dominio applicativo, solo di testo-in / file-mp3-out.

OpenAPI generata automaticamente da FastAPI a partire dagli schemi Pydantic
in app/schemas.py — nessuna configurazione aggiuntiva richiesta oltre
title/version/description qui sotto. Disponibile su:
  GET /docs        — Swagger UI
  GET /redoc       — ReDoc
  GET /openapi.json — schema grezzo
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.responses import FileResponse, JSONResponse

from .config import settings
from .files import list_audio_files
from .queue_worker import JobQueueFullError, SynthesisJob, job_queue
from .paths import is_safe_relative_path
from .schemas import (
    ErrorResponse,
    HealthResponse,
    JobAcceptedResponse,
    ListFilesResponse,
    SynthesisJobRequest,
    VoicesResponse,
)
from .voices import registry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("piper.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    registry.reload()
    await job_queue.start()
    logger.info(
        "piper-tts service ready languages=%s models_dir=%s output_dir=%s",
        registry.available_languages(), settings.MODELS_DIR, settings.OUTPUT_DIR,
    )
    yield
    await job_queue.stop()


app = FastAPI(
    title="Micado Piper TTS",
    description=(
        "Servizio interno di sintesi vocale (testo -> MP3) basato su Piper. "
        "Accetta una richiesta di sintesi in modo asincrono (fire-and-forget) "
        "e notifica il chiamante via webhook quando il file è pronto sul "
        "volume audio condiviso."
    ),
    version="0.2.0",
    lifespan=lifespan,
)


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["operations"],
    summary="Healthcheck — usato dal healthcheck Docker Compose del servizio `piper`.",
)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        queue_depth=job_queue.depth,
        worker_concurrency=settings.PIPER_WORKER_CONCURRENCY,
    )


@app.get(
    "/voices",
    response_model=VoicesResponse,
    tags=["operations"],
    summary="Lingue con una voce installata e mappata in voices.json.",
    description=(
        "Fonte di verità delle lingue effettivamente supportate: il backend "
        "può interrogarlo invece di tenere una mappa lingua->voce duplicata "
        "e a rischio di disallineamento con i modelli realmente installati."
    ),
)
async def voices() -> VoicesResponse:
    return VoicesResponse(languages=registry.available_languages())


@app.post(
    "/jobs",
    response_model=JobAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["synthesis"],
    summary="Accoda una richiesta di sintesi (fire-and-forget).",
    description=(
        "Risponde 202 non appena il job è stato messo in coda: NON aspetta "
        "che la sintesi sia completata. L'esito arriva più tardi via webhook "
        "verso PIPER_CALLBACK_BASE_URL + PIPER_CALLBACK_PATH, con "
        "callback_workflow_id/callback_topic restituiti invariati così come "
        "ricevuti in questa richiesta.\n\n"
        "- 422 se `lang` non ha una voce mappata in voices.json — rifiuto "
        "immediato, nessuna attesa.\n"
        "- 400 se `output_relative_path` non è un path valido/sicuro.\n"
        "- 503 se la coda interna è piena — riprovare più tardi."
    ),
    responses={
        422: {"model": ErrorResponse, "description": "Lingua non supportata"},
        400: {"model": ErrorResponse, "description": "Richiesta non valida"},
        503: {"model": ErrorResponse, "description": "Coda piena, riprovare più tardi"},
    },
)
async def create_job(payload: SynthesisJobRequest) -> JobAcceptedResponse:
    voice_name = registry.resolve(payload.lang)
    if voice_name is None:
        logger.warning("job rejected — unsupported lang=%s", payload.lang)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported lang: {payload.lang}",
        )

    if is_safe_relative_path(settings.OUTPUT_DIR, payload.output_relative_path) is None:
        logger.warning("job rejected — invalid output_relative_path=%s", payload.output_relative_path)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid output_relative_path")

    job = SynthesisJob(
        text=payload.text,
        lang=payload.lang,
        output_relative_path=payload.output_relative_path,
        callback_workflow_id=payload.callback_workflow_id,
        callback_topic=payload.callback_topic,
    )

    try:
        position = job_queue.enqueue(job)
    except JobQueueFullError:
        logger.error("job REJECTED — queue full path=%s", payload.output_relative_path)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Synthesis queue is full, try again later",
        ) from None

    logger.info("job accepted lang=%s path=%s queue_position=%d", payload.lang, payload.output_relative_path, position)
    return JobAcceptedResponse(queued_position=position)


@app.get(
    "/files",
    response_model=ListFilesResponse,
    tags=["debug"],
    summary="Elenca i file audio già scritti sul volume (solo debug/ops).",
    description=(
        "Risponde alla domanda \"è andato a buon fine?\" senza dover entrare "
        "nel container o ispezionare il volume a mano. NON è il percorso di "
        "produzione con cui gli utenti ricevono l'audio (quello è nginx su "
        "PA/migrant) — solo per sviluppo e troubleshooting. Più recenti "
        "prima. Disattivabile con PIPER_DEBUG_FILE_API=false."
    ),
)
async def list_files(
    prefix: str = Query("", description="Filtra per prefisso del path relativo, es. \"user-types/42/\"."),
    limit: int = Query(200, ge=1, le=1000),
) -> ListFilesResponse:
    if not settings.PIPER_DEBUG_FILE_API:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return list_audio_files(settings.OUTPUT_DIR, prefix=prefix, limit=limit)


@app.get(
    "/files/{file_path:path}",
    tags=["debug"],
    summary="Scarica/riproduce un file audio già generato (solo debug/ops).",
    description=(
        "Serve il file direttamente dal volume — comodo per ascoltare al "
        "volo l'esito di una sintesi durante lo sviluppo. Risponde 404 se "
        "il file non esiste ancora (job non concluso, o mai partito) o se "
        "PIPER_DEBUG_FILE_API=false. Il path è validato allo stesso modo di "
        "output_relative_path in POST /jobs — nessun accesso fuori da "
        "OUTPUT_DIR è possibile."
    ),
    responses={404: {"model": ErrorResponse, "description": "File non trovato"}},
)
async def get_file(file_path: str) -> FileResponse:
    if not settings.PIPER_DEBUG_FILE_API:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    target = is_safe_relative_path(settings.OUTPUT_DIR, file_path)
    if target is None or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    # FileResponse supporta le Range request in modo nativo (utile per fare
    # lo scrubbing dell'audio da un player durante il debug).
    return FileResponse(path=target, media_type="audio/mpeg", filename=target.name)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception) -> Response:  # noqa: ANN001
    # Difesa in profondità: un errore non previsto non deve far crashare il
    # processo né restituire uno stacktrace grezzo al chiamante.
    logger.exception("unhandled exception on %s", request.url)
    return JSONResponse(status_code=500, content={"detail": "internal error"})
