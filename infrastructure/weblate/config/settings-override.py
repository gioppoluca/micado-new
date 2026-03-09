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

# Allow HTTP git transport for internal Gitea communication.
# Weblate generates DATA_DIR/home/.gitconfig from this list at startup,
# setting each protocol to "always" or "never" accordingly.
# By default "http" is excluded; adding it here is the official way to enable it.
# See: https://docs.weblate.org/en/latest/admin/config.html
VCS_ALLOW_SCHEMES = ("http", "https", "ssh")    