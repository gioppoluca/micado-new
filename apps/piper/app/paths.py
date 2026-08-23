"""
app/paths.py

Validazione di path relativi condivisa da più moduli (voci del job in
ingresso, endpoint di debug per leggere i file già generati). Isolata qui
(non più dentro voices.py, dove viveva prima) perché non ha nulla a che
fare con la risoluzione lingua->voce — solo con la sicurezza filesystem.
"""
from __future__ import annotations

from pathlib import Path


def is_safe_relative_path(root: Path, relative: str) -> Path | None:
    """
    Valida che `relative` risolva DENTRO `root` (niente path traversal via
    "..", path assoluti, o simlink che scappano dalla cartella). Ritorna il
    path assoluto risolto, o None se non valido.
    """
    if not relative or relative.startswith("/") or ".." in Path(relative).parts:
        return None
    candidate = (root / relative).resolve()
    root_resolved = root.resolve()
    if candidate != root_resolved and root_resolved not in candidate.parents:
        return None
    return candidate
