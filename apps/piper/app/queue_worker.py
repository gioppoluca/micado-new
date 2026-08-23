"""
app/queue_worker.py

Coda in-process limitata + pool di worker asincroni: questo è il
meccanismo che risponde al problema "se arrivano chiamate consecutive non
ci stiamo dietro". Senza questo, ogni POST /jobs che spawna il proprio
task di sintesi farebbe gareggiare per la CPU un numero illimitato di
sintesi contemporanee (ognuna CPU-bound), rallentandole tutte.

── Design ─────────────────────────────────────────────────────────────────
- asyncio.Queue con maxsize: se la coda è piena, POST /jobs ritorna 503
  subito (backpressure esplicita) invece di accettare un backlog illimitato
  o bloccare la richiesta HTTP in attesa di spazio.
- N worker coroutine (PIPER_WORKER_CONCURRENCY) consumano la coda in
  sequenza; ciascuna sintesi gira in un thread separato via
  asyncio.to_thread() perché piper-tts/PyAV sono librerie SINCRONE — senza
  to_thread(), una singola sintesi bloccherebbe l'intero event loop e
  persino /health smetterebbe di rispondere durante la sintesi.
- Ogni job, a fine lavorazione (successo o fallimento), genera SEMPRE una
  callback verso il backend — è il fail-fast che sostituisce la necessità
  di un polling lato backend.

── Persistenza della coda ────────────────────────────────────────────────
La coda è SOLO in memoria: un riavvio del container perde i job non ancora
lavorati. Accettabile per la v1 (il backend ha un timeout di attesa
generoso e degrada in modo non fatale, vedi la documentazione di
progettazione) — se in futuro serve sopravvivere ai riavvii, la coda va
sostituita con qualcosa di backed da Redis (es. arq: il progetto ha già
Redis nello stack come servizio `cache`, quindi non introdurrebbe una
nuova dipendenza infrastrutturale, solo di codice).
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from .config import settings
from .schemas import TtsCallbackPayload
from .notifier import notify_backend
from .paths import is_safe_relative_path
from .tts import SynthesisError, VoiceNotAvailableError, synthesize_to_file

logger = logging.getLogger("piper.queue")


@dataclass(frozen=True)
class SynthesisJob:
    text: str
    lang: str
    output_relative_path: str
    callback_workflow_id: str
    callback_topic: str


class JobQueueFullError(Exception):
    pass


class JobQueue:
    def __init__(self, maxsize: int, concurrency: int) -> None:
        self._queue: asyncio.Queue[SynthesisJob] = asyncio.Queue(maxsize=maxsize)
        self._concurrency = concurrency
        self._workers: list[asyncio.Task] = []

    @property
    def depth(self) -> int:
        return self._queue.qsize()

    def enqueue(self, job: SynthesisJob) -> int:
        """Ritorna la posizione in coda, o solleva JobQueueFullError."""
        try:
            self._queue.put_nowait(job)
        except asyncio.QueueFull as exc:
            raise JobQueueFullError from exc
        return self._queue.qsize()

    async def start(self) -> None:
        self._workers = [
            asyncio.create_task(self._worker_loop(worker_id), name=f"piper-worker-{worker_id}")
            for worker_id in range(self._concurrency)
        ]
        logger.info("worker pool started workers=%d queue_maxsize=%d", self._concurrency, self._queue.maxsize)

    async def stop(self) -> None:
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        logger.info("worker pool stopped")

    async def _worker_loop(self, worker_id: int) -> None:
        while True:
            job = await self._queue.get()
            try:
                await self._process(worker_id, job)
            finally:
                self._queue.task_done()

    async def _process(self, worker_id: int, job: SynthesisJob) -> None:
        logger.info("worker=%d picked up job path=%s lang=%s", worker_id, job.output_relative_path, job.lang)

        target = is_safe_relative_path(settings.OUTPUT_DIR, job.output_relative_path)
        if target is None:
            # Già validato in ingresso da /jobs (400 immediato) — questo è
            # un controllo di difesa in profondità, non dovrebbe mai attivarsi.
            await self._notify(job, status="failed", error_message="invalid output_relative_path")
            return

        try:
            await asyncio.to_thread(synthesize_to_file, job.text, job.lang, target)
        except VoiceNotAvailableError as exc:
            # Non dovrebbe capitare: /jobs valida già la lingua in ingresso.
            # Se capita comunque (es. manifest ricaricato/cambiato a runtime),
            # trattalo come fallimento riportato via callback, non come crash.
            logger.warning("worker=%d voice unavailable at synthesis time: %s", worker_id, exc)
            await self._notify(job, status="failed", error_message=str(exc))
            return
        except SynthesisError as exc:
            logger.error("worker=%d synthesis failed path=%s error=%s", worker_id, job.output_relative_path, exc)
            await self._notify(job, status="failed", error_message=str(exc))
            return
        except Exception as exc:  # noqa: BLE001 — un worker non deve MAI morire per un job
            logger.exception("worker=%d unexpected error path=%s", worker_id, job.output_relative_path)
            await self._notify(job, status="failed", error_message=f"unexpected error: {exc}")
            return

        public_path = f"/media/audio/{job.output_relative_path}"
        await self._notify(job, status="ready", public_path=public_path)

    async def _notify(
        self, job: SynthesisJob, *, status: str,
        public_path: str | None = None, error_message: str | None = None,
    ) -> None:
        payload = TtsCallbackPayload(
            callback_workflow_id=job.callback_workflow_id,
            callback_topic=job.callback_topic,
            output_relative_path=job.output_relative_path,
            lang=job.lang,
            status=status,  # type: ignore[arg-type]
            public_path=public_path,
            error_message=error_message,
        )
        await notify_backend(payload)


job_queue = JobQueue(maxsize=settings.PIPER_QUEUE_MAXSIZE, concurrency=settings.PIPER_WORKER_CONCURRENCY)
