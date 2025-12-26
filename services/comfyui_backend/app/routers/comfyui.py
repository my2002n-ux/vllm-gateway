from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Literal
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import AliasChoices, BaseModel, Field

from app.services.comfyui_client import ComfyUIClient, ComfyUIError
from app.services.workflow_builder import TemplateError, build_prompt


router = APIRouter()


@dataclass
class TaskRecord:
    task_id: str
    prompt_id: str
    status: str
    progress: float
    message: str
    outputs: List[Dict[str, Any]] = field(default_factory=list)
    params: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)


_TASKS: Dict[str, TaskRecord] = {}


class GenerateRequest(BaseModel):
    template_id: Literal["min", "lora_upscale"] = Field(..., description="min or lora_upscale")
    prompt_text: str
    seed: int
    width: int = Field(512, ge=1)
    height: int = Field(512, ge=1)
    cfg: Optional[float] = None
    enable_lora: bool = False
    lora_name: Optional[str] = None
    enable_upscale: bool = False
    upscale_model_name: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("upscale_model_name", "upscale_model"),
    )


class GenerateResponse(BaseModel):
    task_id: str
    comfy_prompt_id: str


class TaskStatusResponse(BaseModel):
    status: str
    progress: float
    message: str
    outputs: List[Dict[str, Any]]


class ImagesResponse(BaseModel):
    images: List[Dict[str, Any]]


def _normalize_status(status: str) -> str:
    if status in {"queued", "running", "success", "failed"}:
        return status
    return "running"


def _extract_images(outputs: Dict[str, Any]) -> List[Dict[str, Any]]:
    images: List[Dict[str, Any]] = []
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        for image in node_output.get("images", []) or []:
            if not isinstance(image, dict):
                continue
            record = {
                "filename": image.get("filename"),
                "subfolder": image.get("subfolder") or "",
                "type": image.get("type") or "output",
            }
            if image.get("width") is not None:
                record["width"] = image.get("width")
            if image.get("height") is not None:
                record["height"] = image.get("height")
            images.append(record)
    return images


def _normalize_download_name(filename: str, content_type: str | None) -> str:
    if "." in filename:
        return filename
    if content_type and "png" in content_type:
        return f"{filename}.png"
    return f"{filename}.bin"


async def _refresh_task(task: TaskRecord, client: ComfyUIClient) -> None:
    try:
        history = await client.get_history(task.prompt_id)
    except ComfyUIError as exc:
        task.status = "failed"
        task.message = str(exc)
        task.progress = 0.0
        return

    entry = history.get(task.prompt_id)
    if not isinstance(entry, dict):
        task.status = _normalize_status(task.status)
        return

    outputs = entry.get("outputs") or {}
    if isinstance(outputs, dict) and outputs:
        task.outputs = _extract_images(outputs)
        task.status = "success"
        task.progress = 1.0
        task.message = ""
        return

    status_info = entry.get("status") or {}
    status_str = status_info.get("status_str") if isinstance(status_info, dict) else None
    if status_str and "error" in str(status_str).lower():
        task.status = "failed"
        task.message = str(status_str)
        task.progress = 0.0
        return

    task.status = "running"
    task.progress = max(task.progress, 0.0)


@router.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest) -> GenerateResponse:
    default_cfg = 2.0
    cfg_value = default_cfg
    if request.cfg is not None:
        try:
            cfg_value = float(request.cfg)
        except (TypeError, ValueError):
            cfg_value = default_cfg

    print(f"[INFO] CFG_APPLIED={cfg_value}")
    try:
        prompt = build_prompt(
            template_id=request.template_id,
            prompt_text=request.prompt_text,
            seed=request.seed,
            width=request.width,
            height=request.height,
            cfg=cfg_value,
            batch_size=1,
            enable_lora=request.enable_lora,
            lora_name=request.lora_name,
            enable_upscale=request.enable_upscale,
            upscale_model_name=request.upscale_model_name,
        )
    except TemplateError as exc:
        raise HTTPException(status_code=400, detail=f"Template error: {exc}") from exc

    client = ComfyUIClient()
    client_id = uuid.uuid4().hex
    try:
        prompt_id = await client.submit_prompt(client_id=client_id, prompt=prompt)
    except ComfyUIError as exc:
        detail = {
            "detail": str(exc),
            "comfyui_status_code": exc.status_code,
            "comfyui_response": exc.response_json if exc.response_json is not None else exc.response_text,
        }
        raise HTTPException(status_code=502, detail=detail) from exc

    task_id = uuid.uuid4().hex
    _TASKS[task_id] = TaskRecord(
        task_id=task_id,
        prompt_id=prompt_id,
        status="running",
        progress=0.0,
        message="",
        params=request.model_dump(),
    )
    return GenerateResponse(task_id=task_id, comfy_prompt_id=prompt_id)


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task(task_id: str) -> TaskStatusResponse:
    task = _TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    client = ComfyUIClient()
    await _refresh_task(task, client)
    return TaskStatusResponse(
        status=task.status,
        progress=task.progress,
        message=task.message,
        outputs=task.outputs,
    )


@router.get("/tasks/{task_id}/images", response_model=ImagesResponse)
async def get_task_images(task_id: str, request: Request) -> ImagesResponse:
    task = _TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.outputs:
        client = ComfyUIClient()
        await _refresh_task(task, client)

    if not task.outputs:
        return ImagesResponse(images=[])

    base_url = str(request.base_url).rstrip("/")
    images: List[Dict[str, Any]] = []
    for image in task.outputs:
        if not image.get("filename"):
            continue
        params = {
            "filename": image.get("filename"),
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        }
        url = f"{base_url}/images/view?{urlencode(params)}"
        record = {**image, "url": url}
        images.append(record)

    return ImagesResponse(images=images)


@router.get("/tasks/{task_id}/image")
async def download_first_image(task_id: str) -> StreamingResponse:
    task = _TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.outputs:
        client = ComfyUIClient()
        await _refresh_task(task, client)

    if not task.outputs:
        raise HTTPException(status_code=404, detail="No images available for this task")

    image = next((item for item in task.outputs if item.get("filename")), None)
    if not image or not image.get("filename"):
        raise HTTPException(status_code=404, detail="No downloadable image found")

    client = ComfyUIClient()
    view_url = client.build_view_url()
    params = {
        "filename": image.get("filename"),
        "subfolder": image.get("subfolder", ""),
        "type": image.get("type", "output"),
    }

    async def _proxy_stream() -> Any:
        timeout = httpx.Timeout(120.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as http_client:
            async with http_client.stream("GET", view_url, params=params) as response:
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    raise HTTPException(
                        status_code=exc.response.status_code,
                        detail=exc.response.text,
                    ) from exc
                async for chunk in response.aiter_bytes():
                    yield chunk

    filename = _normalize_download_name(
        image.get("filename", "image"),
        "image/png",
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    return StreamingResponse(_proxy_stream(), media_type="image/png", headers=headers)


@router.get("/files")
async def proxy_file(
    filename: str,
    subfolder: str = "",
    file_type: str = Query("output", alias="type"),
) -> StreamingResponse:
    client = ComfyUIClient()
    view_url = client.build_view_url()
    params = {"filename": filename, "subfolder": subfolder, "type": file_type}

    async def _proxy_stream() -> Any:
        timeout = httpx.Timeout(120.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as http_client:
            async with http_client.stream("GET", view_url, params=params) as response:
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    raise HTTPException(
                        status_code=exc.response.status_code,
                        detail=exc.response.text,
                    ) from exc
                async for chunk in response.aiter_bytes():
                    yield chunk

    return StreamingResponse(_proxy_stream(), media_type="application/octet-stream")


@router.get("/images/{filename}")
async def proxy_image(
    filename: str,
    subfolder: str = "",
    file_type: str = Query("output", alias="type"),
) -> StreamingResponse:
    client = ComfyUIClient()

    async def _proxy_stream() -> Any:
        try:
            async for chunk in client.stream_image(
                filename=filename, subfolder=subfolder, file_type=file_type
            ):
                yield chunk
        except ComfyUIError as exc:
            raise HTTPException(
                status_code=502,
                detail=exc.response_text or str(exc),
            ) from exc

    headers = {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
    }
    return StreamingResponse(_proxy_stream(), headers=headers, media_type="image/png")
