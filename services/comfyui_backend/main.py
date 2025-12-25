from __future__ import annotations

from fastapi import FastAPI

from app.routers.comfyui import router as comfyui_router


app = FastAPI(title="ComfyUI Backend", version="1.0.0")
app.include_router(comfyui_router, prefix="/api", tags=["comfyui"])
