"""
app/tts.py

Sintesi vocale + codifica MP3, interamente in-process: nessuna shell,
nessun subprocess, nessun binario esterno (né `piper` via CLI né `ffmpeg`
via riga di comando).

── Testo -> PCM ──────────────────────────────────────────────────────────────
Libreria ufficiale `piper-tts` (pacchetto PyPI, import `piper`), usata come
libreria — MAI `python -m piper` in un subprocess. Verificato sulla versione
realmente installata (piper-tts 1.7.0, progetto OHF-voice/piper1-gpl):

    from piper import PiperVoice
    voice = PiperVoice.load(model_path, config_path=config_path)
    voice.synthesize_wav(text, wave.Wave_write(...))   # scrive un WAV valido

`synthesize_wav` è il metodo di convenienza usato anche dal server HTTP di
riferimento incluso nel pacchetto stesso (piper.http_server) — stessa
convenzione, non reinventata qui.

⚠ NOTA IMPORTANTE SULLA LICENZA: piper-tts 1.7.0 è GPL-3.0-or-later (non più
la licenza permissiva delle versioni precedenti del progetto Piper/Rhasspy).
Per un uso come servizio interno via rete (nessun binario distribuito agli
utenti finali) questo non dovrebbe comportare obblighi di ridistribuzione
del codice sorgente del VOSTRO backend/frontend, ma non è la mia area di
competenza: fatelo verificare da chi segue la policy licenze OSS del
progetto prima del rilascio in produzione.

── PCM -> MP3 ────────────────────────────────────────────────────────────────
Libreria `av` (PyAV — binding Python di libav/FFmpeg), verificata
empiricamente in questo stesso ambiente con un round-trip completo
WAV(16kHz mono) -> resample a 22050Hz -> encode MP3 64kbps -> bytes non
vuoti. Gestisce in un solo passaggio l'eventuale resample: i modelli Piper
NON condividono tutti la stessa frequenza nativa (le voci "x_low" sono
spesso 16000Hz contro i 22050Hz delle "medium"), quindi normalizzare
esplicitamente all'output è necessario, non opzionale.

Le wheel di PyAV per Linux x86_64/aarch64 includono tipicamente le proprie
librerie FFmpeg staticamente — in teoria niente `apt-get install ffmpeg`
necessario nell'immagine. Non è stato possibile verificarlo con una build
Docker reale in questo ambiente (che ha già ffmpeg/libav di sistema
preinstallati, il che confonderebbe il test) — VERIFICARE con una build
pulita di python:3.11-slim prima di eliminare eventuali pacchetti apt di
libav dal Dockerfile.
"""
from __future__ import annotations

import io
import logging
import wave
from pathlib import Path

import av
from piper import PiperVoice

from .config import settings
from .voices import registry

logger = logging.getLogger("piper.tts")

_voice_cache: dict[str, PiperVoice] = {}


class VoiceNotAvailableError(Exception):
    pass


class SynthesisError(Exception):
    pass


def _load_voice(voice_name: str) -> PiperVoice:
    """Carica (e mette in cache) un modello .onnx — ricaricarlo ad ogni
    richiesta sarebbe il vero collo di bottiglia, non la sintesi in sé."""
    cached = _voice_cache.get(voice_name)
    if cached is not None:
        return cached

    model_path, config_path = registry.model_paths(voice_name)
    if not model_path.exists() or not config_path.exists():
        raise VoiceNotAvailableError(f"Voice model files missing on disk: {voice_name}")

    logger.info("loading voice model=%s", voice_name)
    voice = PiperVoice.load(str(model_path), config_path=str(config_path))
    _voice_cache[voice_name] = voice
    return voice


def synthesize_to_file(text: str, lang: str, target: Path) -> int:
    """
    Sincrona e CPU-bound DI PROPOSITO — va chiamata da un worker tramite
    asyncio.to_thread(), mai direttamente da un handler async.

    Scrive il file finale in modo atomico (sintesi su un path temporaneo
    nella stessa cartella, poi Path.replace() — rename atomico sullo stesso
    filesystem) e ritorna la dimensione in bytes del file scritto.
    """
    voice_name = registry.resolve(lang)
    if voice_name is None:
        raise VoiceNotAvailableError(f"No voice mapped for lang={lang}")

    voice = _load_voice(voice_name)

    try:
        wav_bytes = _synthesize_wav_bytes(voice, text)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target.with_suffix(target.suffix + ".tmp")
        _encode_mp3(wav_bytes, tmp_path)
        tmp_path.replace(target)  # rename atomico
    except VoiceNotAvailableError:
        raise
    except Exception as exc:  # noqa: BLE001 — vogliamo riportare qualunque fallimento al chiamante
        raise SynthesisError(str(exc)) from exc

    size = target.stat().st_size
    logger.info("synthesis done lang=%s path=%s bytes=%d", lang, target, size)
    return size


def _synthesize_wav_bytes(voice: PiperVoice, text: str) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    data = buffer.getvalue()
    if not data:
        raise SynthesisError("Piper ha prodotto un WAV vuoto")
    return data


def _encode_mp3(wav_bytes: bytes, out_path: Path) -> None:
    input_container = av.open(io.BytesIO(wav_bytes), mode="r")
    try:
        in_stream = input_container.streams.audio[0]

        output_container = av.open(str(out_path), mode="w", format="mp3")
        try:
            out_stream = output_container.add_stream("mp3", rate=settings.OUTPUT_SAMPLE_RATE)
            out_stream.layout = "mono"
            out_stream.bit_rate = settings.OUTPUT_BITRATE

            resampler = av.AudioResampler(
                format="s16", layout="mono", rate=settings.OUTPUT_SAMPLE_RATE,
            )

            for frame in input_container.decode(in_stream):
                for resampled in resampler.resample(frame):
                    for packet in out_stream.encode(resampled):
                        output_container.mux(packet)

            for packet in out_stream.encode(None):  # flush
                output_container.mux(packet)
        finally:
            output_container.close()
    finally:
        input_container.close()
