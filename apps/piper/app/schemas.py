"""
app/schemas.py

Modelli Pydantic per richieste/risposte — sono anche la fonte da cui FastAPI
genera automaticamente lo schema OpenAPI (/openapi.json, /docs, /redoc).
Le description qui sotto finiscono direttamente nella documentazione generata.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class SynthesisJobRequest(BaseModel):
    """Corpo di POST /jobs — richiesta di sintesi asincrona."""

    text: str = Field(
        min_length=1,
        max_length=5000,
        description="Testo da sintetizzare.",
        examples=["Richiedente asilo"],
    )
    lang: str = Field(
        min_length=2,
        description="Codice lingua ISO 639-1 (o con region, es. pt-BR). "
                     "Risolto in una voce tramite il manifest voices.json.",
        examples=["it"],
    )
    output_relative_path: str = Field(
        description="Path relativo ALLA RADICE del volume audio, deciso dal "
                     "chiamante (il backend possiede la convenzione di naming). "
                     "Piper lo tratta come opaco, a parte la validazione anti "
                     "path-traversal.",
        examples=["user-types/42/it/6f2ab3d1-9e4a-4c1a-8b1e-3d0f6a2c9e11.mp3"],
    )
    callback_workflow_id: str = Field(
        description="Identificatore opaco: viene restituito INVARIATO nella "
                     "callback finale. Piper non ne interpreta il contenuto — "
                     "è il backend a sapere come instradarlo (es. un workflow "
                     "DBOS in attesa).",
        examples=["tr:6f2ab3d1-9e4a-4c1a-8b1e-3d0f6a2c9e11:it"],
    )
    callback_topic: str = Field(
        description="Identificatore opaco, restituito invariato nella callback.",
        examples=["piper-tts:it"],
    )


class JobAcceptedResponse(BaseModel):
    accepted: Literal[True] = True
    queued_position: int = Field(description="Posizione nella coda al momento dell'accettazione.")


class ErrorResponse(BaseModel):
    detail: str


class VoicesResponse(BaseModel):
    languages: list[str] = Field(description="Lingue con una voce installata e mappata nel manifest.")


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    queue_depth: int
    worker_concurrency: int


class FileEntry(BaseModel):
    """Una riga della listing di debug — vedi GET /files."""

    path: str = Field(description="Path relativo alla radice OUTPUT_DIR.")
    bytes: int
    modified_at: str = Field(description="Timestamp ISO 8601 dell'ultima scrittura.")
    url: str = Field(description="Path assoluto per scaricare/riprodurre il file: GET /files/{path}.")


class ListFilesResponse(BaseModel):
    count: int
    truncated: bool = Field(description="true se il volume contiene più file di quelli elencati (vedi `limit`).")
    files: list[FileEntry]


class TtsCallbackPayload(BaseModel):
    """Corpo del POST che Piper invia al backend a sintesi conclusa."""

    callback_workflow_id: str
    callback_topic: str
    output_relative_path: str
    lang: str
    status: Literal["ready", "failed"]
    public_path: Optional[str] = None
    error_message: Optional[str] = None
