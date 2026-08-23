"""
app/voices.py

Risoluzione lingua -> voce Piper, tramite un manifest JSON che vive nello
stesso volume dei modelli (MODELS_DIR/voices.json), non nel codice.

Esempio di MODELS_DIR/voices.json:
{
  "en": "en_US-lessac-medium",
  "it": "it_IT-riccardo-x_low",
  "fr": "fr_FR-siwis-medium",
  "ar": "ar_JO-kareem-medium"
}

Per ogni voce ci si aspetta <nome>.onnx e <nome>.onnx.json nella stessa
cartella (è la struttura standard di distribuzione dei modelli Piper).

Aggiungere una lingua = aggiungere i due file del modello + una riga qui
dentro, sullo stesso volume — MAI un rebuild dell'immagine.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from .config import settings

logger = logging.getLogger("piper.voices")


class VoiceRegistry:
    def __init__(self, models_dir: Path, manifest_filename: str) -> None:
        self._models_dir = models_dir
        self._manifest_path = models_dir / manifest_filename
        self._lang_to_voice: dict[str, str] = {}

    def reload(self) -> None:
        """Ricarica il manifest da disco. Chiamato all'avvio e disponibile
        per un eventuale reload a runtime (endpoint admin) in futuro."""
        if not self._manifest_path.exists():
            logger.warning(
                "voices manifest not found path=%s — nessuna lingua sarà disponibile",
                self._manifest_path,
            )
            self._lang_to_voice = {}
            return

        raw = json.loads(self._manifest_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{self._manifest_path} deve contenere un oggetto JSON piatto lingua -> voce")

        resolved: dict[str, str] = {}
        for lang, voice_name in raw.items():
            model_path = self._models_dir / f"{voice_name}.onnx"
            config_path = self._models_dir / f"{voice_name}.onnx.json"
            if not model_path.exists() or not config_path.exists():
                logger.warning(
                    "voice listed in manifest but files missing lang=%s voice=%s "
                    "(atteso %s e %s) — lingua esclusa",
                    lang, voice_name, model_path.name, config_path.name,
                )
                continue
            resolved[lang.lower()] = voice_name

        self._lang_to_voice = resolved
        logger.info("voices manifest loaded languages=%s", sorted(resolved.keys()))

    def resolve(self, lang: str) -> str | None:
        return self._lang_to_voice.get(lang.lower())

    def available_languages(self) -> list[str]:
        return sorted(self._lang_to_voice.keys())

    def model_paths(self, voice_name: str) -> tuple[Path, Path]:
        return (
            self._models_dir / f"{voice_name}.onnx",
            self._models_dir / f"{voice_name}.onnx.json",
        )


registry = VoiceRegistry(settings.MODELS_DIR, settings.VOICES_MANIFEST_FILENAME)
