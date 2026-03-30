import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "/audio"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Micado Piper TTS", version="0.1.0")

class TtsRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str = Field(min_length=1)

def voice_paths(voice: str):
    model = MODELS_DIR / f"{voice}.onnx"
    config = MODELS_DIR / f"{voice}.onnx.json"
    return model, config

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/tts")
def tts(req: TtsRequest):
    model, config = voice_paths(req.voice)
    if not model.exists() or not config.exists():
        raise HTTPException(status_code=404, detail=f"Voice not found: {req.voice}")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=OUTPUT_DIR) as tmp:
        out_path = Path(tmp.name)

    cmd = [
        "python","-m","piper",
        "--model", str(model),
        "--config", str(config),
        "--output_file", str(out_path),
    ]

    try:
        subprocess.run(
            cmd,
            input=req.text.encode("utf-8"),
            capture_output=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=e.stderr.decode())

    return FileResponse(path=out_path, media_type="audio/wav")
