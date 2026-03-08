from pathlib import Path

TOKEN_PATH = Path("/bootstrap/gitea-weblate.token")

def _read_token() -> str:
    if TOKEN_PATH.exists():
        return TOKEN_PATH.read_text(encoding="utf-8").strip()
    return ""

_gitea_token = _read_token()

if _gitea_token:
    GITEA_CREDENTIALS = {
        "gitea:3000": {
            "username": "weblate-bot",
            "token": _gitea_token,
        }
    }
else:
    GITEA_CREDENTIALS = {}
