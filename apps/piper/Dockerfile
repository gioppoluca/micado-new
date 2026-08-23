FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# curl: richiesto dal healthcheck del docker-compose (CMD-SHELL curl ...).
# ca-certificates: necessario per la callback HTTPS verso il backend in
#   ambienti dove PIPER_CALLBACK_BASE_URL punta a un host TLS.
# libsndfile1: NON è una dipendenza dichiarata di piper-tts 1.7.0 (che
#   richiede solo onnxruntime + pathvalidate — verificato via
#   `pip show piper-tts` in fase di riprogettazione). Lasciato per
#   compatibilità con la versione precedente di questo Dockerfile: se una
#   build pulita risulta funzionante senza, va rimosso.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY app /app/app

# Utente non privilegiato — stesso principio già applicato al backend
# (Dockerfile del backend usa `USER node`).
RUN useradd --create-home --uid 1000 piper \
    && mkdir -p /models /audio \
    && chown -R piper:piper /app /models /audio
USER piper

EXPOSE 8080

# --workers 1: la concorrenza CPU-bound è già gestita ESPLICITAMENTE dal
# pool di worker interno dell'applicazione (PIPER_WORKER_CONCURRENCY), che
# usa asyncio.to_thread() per non bloccare l'event loop. Più worker uvicorn
# moltiplicherebbero i modelli caricati in RAM (un processo = una cache voci
# separata) senza un reale beneficio, dato che la coda è già in-process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
