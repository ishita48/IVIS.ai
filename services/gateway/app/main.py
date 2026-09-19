from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import hint, run, session, source, voice

app = FastAPI(title="lens-gateway")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (run.router, hint.router, session.router, source.router, voice.router):
    app.include_router(r)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
