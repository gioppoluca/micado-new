"""
app/files.py

Utility di SOLO DEBUG/OPS per rispondere alla domanda "è andato a buon fine
o no?" senza dover entrare nel container o ispezionare il volume a mano.

Non è il percorso di produzione con cui gli utenti finali ricevono l'audio
(quello resta nginx su PA/migrant/NGO, che serve direttamente dal volume
montato in sola lettura) — questo è solo per sviluppo e troubleshooting:
un elenco di cosa è stato scritto finora, e un modo per riascoltare/
scaricare un file puntuale dato il suo path relativo.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

from .schemas import FileEntry, ListFilesResponse


def list_audio_files(root: Path, prefix: str = "", limit: int = 200) -> ListFilesResponse:
    if not root.exists():
        return ListFilesResponse(count=0, truncated=False, files=[])

    matches: list[Path] = [
        p for p in root.rglob("*.mp3")
        if not prefix or str(p.relative_to(root)).startswith(prefix)
    ]
    # Più recenti prima — è quasi sempre quello che si vuole vedere subito
    # dopo aver lanciato un job ("il mio ultimo test ha funzionato?").
    matches.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    truncated = len(matches) > limit
    selected = matches[:limit]

    entries = [
        FileEntry(
            path=str(p.relative_to(root)),
            bytes=p.stat().st_size,
            modified_at=dt.datetime.fromtimestamp(p.stat().st_mtime, tz=dt.timezone.utc).isoformat(),
            url=f"/files/{p.relative_to(root)}",
        )
        for p in selected
    ]

    return ListFilesResponse(count=len(matches), truncated=truncated, files=entries)
