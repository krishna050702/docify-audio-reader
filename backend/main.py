import os
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from parser import extract_docx_layout_aware, extract_pdf_layout_aware
from tts_service import synthesize_neural_with_timestamps

app = FastAPI(
    title="Docify — Spotify for Documents API",
    version="1.0.0",
    description="Layout-aware PDF/DOCX extraction & Neural TTS streaming with word-level timestamps.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SynthesizeRequest(BaseModel):
    text: str
    voice: str = "en-US-AvaMultilingualNeural"
    speed: float = 1.0


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "docify-backend"}


@app.post("/api/parse-document")
async def parse_document(file: UploadFile = File(...)):
    filename = (file.filename or "").lower()
    raw_bytes = await file.read()

    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        if filename.endswith(".pdf"):
            result = extract_pdf_layout_aware(raw_bytes)
        elif filename.endswith(".docx"):
            result = extract_docx_layout_aware(raw_bytes)
        else:
            text = raw_bytes.decode("utf-8", errors="ignore")
            result = {"pageCount": 1, "text": text}

        return {
            "filename": file.filename,
            "pageCount": result["pageCount"],
            "text": result["text"],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Document parsing error: {exc}")


@app.post("/api/tts/synthesize")
async def tts_synthesize(req: SynthesizeRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    try:
        data = await synthesize_neural_with_timestamps(
            text=req.text.strip(),
            voice=req.voice,
            speed=req.speed,
        )
        return data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {exc}")


@app.get("/")
async def serve_web_preview():
    preview_path = Path(__file__).resolve().parent.parent / "web-preview" / "index.html"
    if preview_path.exists():
        return FileResponse(preview_path)
    return {"message": "Docify API is running. Visit /docs for OpenAPI documentation."}
