from __future__ import annotations

import base64
import json
import os
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union, Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Ollama 服务地址，支持通过 OLLAMA_URL 环境变量进行 dev/prod 多环境切换
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://10.10.10.28:11434/api/chat")
# 支持多模态图片输入的模型白名单
VL_MODELS = {"qwen3-vl:32b", "gemma3:27b"}
IMAGE_DIR = "/home/chenshi/vllm-images"
IMAGE_BASE_URL = "http://192.168.1.61:8000/images"

try:
    os.makedirs(IMAGE_DIR, exist_ok=True)
    print(f"[DEBUG] ensured image directory exists: {IMAGE_DIR}")
except OSError as exc:
    print(f"[ERROR] failed to ensure image directory {IMAGE_DIR}: {exc}")

app = FastAPI(title="Ollama Chat Proxy", version="1.0.0")
app.mount("/images", StaticFiles(directory=IMAGE_DIR), name="images")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# content part 模型描述多模态分片（OpenAI 规范：text / image_url）
class ContentPart(BaseModel):
    type: Literal["text", "image_url"]
    text: Optional[str] = None
    image_url: Optional[Dict[str, Any]] = None


# Message 模型支持两种 content 形态：纯字符串或 ContentPart 列表
class Message(BaseModel):
    role: str
    content: Union[str, List[ContentPart], None] = None
    name: Optional[str] = None

    class Config:
        extra = "allow"

# 根路径重定向到 /docs
from fastapi.responses import RedirectResponse

@app.get("/")
def root():
    return RedirectResponse(url="/docs")

# ChatCompletionRequest 模型与 OpenAI Chat Completions 接口对齐：
# - model/messages 为必填
# - temperature/top_p/max_tokens/stream/penalty 等为可选推理参数
# - stop 可为字符串或字符串数组
class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[Message]
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    stream: bool = False  # 控制是否将结果以流式方式返回，默认保持一次性响应
    presence_penalty: Optional[float] = None
    frequency_penalty: Optional[float] = None
    stop: Optional[Union[str, List[str]]] = None

    class Config:
        extra = "allow"


_MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}


def _extension_from_mime(mime_type: str) -> str:
    return _MIME_EXTENSIONS.get(mime_type.lower(), ".png")


def _parse_data_url(data_url: str) -> Optional[Tuple[str, str]]:
    if not data_url.startswith("data:image"):
        return None
    try:
        header, b64_data = data_url.split(",", 1)
    except ValueError:
        print(f"[WARN] invalid data URL, missing comma separator: {data_url[:40]}")
        return None
    if not header.startswith("data:"):
        print(f"[WARN] invalid data URL header: {header}")
        return None
    meta = header[len("data:") :]
    mime_type = meta.split(";")[0] if ";" in meta else meta
    return mime_type, b64_data


def _extract_base64_from_data_url(data_url: str) -> Optional[str]:
    parsed = _parse_data_url(data_url)
    if not parsed:
        return None
    _, b64_data = parsed
    print(f"[DEBUG] extracted data URL base64 length: {len(b64_data)}")
    return b64_data


def _save_data_url_image(data_url: str) -> Optional[str]:
    parsed = _parse_data_url(data_url)
    if not parsed:
        return None
    mime_type, b64_data = parsed
    extension = _extension_from_mime(mime_type)

    try:
        image_bytes = base64.b64decode(b64_data, validate=True)
    except Exception as exc:
        print(f"[ERROR] failed to decode base64 image: {exc}")
        return None

    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    random_token = uuid.uuid4().hex[:8]
    filename = f"img-{timestamp}-{random_token}{extension}"
    file_path = os.path.join(IMAGE_DIR, filename)
    try:
        with open(file_path, "wb") as f:
            f.write(image_bytes)
    except OSError as exc:
        print(f"[ERROR] failed to write image file {file_path}: {exc}")
        return None

    file_url = f"{IMAGE_BASE_URL}/{filename}"
    print(f"[DEBUG] saved image: {file_path}")
    print(f"[DEBUG] saved image url={file_url}")
    return file_url


def _local_url_to_base64(url: str) -> Optional[str]:
    if not url.startswith(IMAGE_BASE_URL):
        print(f"[WARN] skip external image url: {url}")
        return None

    filename = os.path.basename(url)
    local_path = os.path.join(IMAGE_DIR, filename)
    if not os.path.exists(local_path):
        print(f"[ERROR] local image path not found: {local_path}")
        return None

    try:
        with open(local_path, "rb") as f:
            image_bytes = f.read()
    except OSError as exc:
        print(f"[ERROR] cannot read image file {local_path}: {exc}")
        return None

    try:
        encoded = base64.b64encode(image_bytes).decode("utf-8")
    except Exception as exc:
        print(f"[ERROR] failed to base64 encode {local_path}: {exc}")
        return None

    print(f"[DEBUG] encoded base64 length: {len(encoded)} for {local_path}")
    return encoded


# 将 OpenAI 风格的请求转换成 Ollama /api/chat 接口所需的字段
def _build_ollama_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Translate the OpenAI-style payload into an Ollama chat request."""
    ollama_payload: Dict[str, Any] = {
        "model": payload["model"],
        "messages": payload["messages"],
        "stream": payload.get("stream", False),
    }

    # options 中汇总温度、top_p 等推理参数，优先保留用户自定义 options
    options = {**payload.get("options", {})}
    option_fields = (
        "temperature",
        "top_p",
        "presence_penalty",
        "frequency_penalty",
    )
    for field in option_fields:
        value = payload.get(field)
        if value is not None and field not in options:
            options[field] = value

    max_tokens = payload.get("max_tokens")
    if max_tokens is not None and "num_predict" not in options:
        options["num_predict"] = max_tokens

    stop = payload.get("stop")
    if stop is not None and "stop" not in options:
        options["stop"] = stop

    if options:
        ollama_payload["options"] = options

    return ollama_payload


def _log_payload_debug(payload: Dict[str, Any]) -> None:
    try:
        serialized = json.dumps(payload, ensure_ascii=False)
        print(f"[DEBUG] final payload sent to Ollama: {serialized[:500]}")
    except Exception as exc:
        print(f"[DEBUG] payload summary error: {exc}")


def build_ollama_messages(messages: List[Message], model_name: str) -> List[Dict[str, Any]]:
    """
    将 OpenAI 风格 messages/content 数组转换为 Ollama 所需的纯文本 content，
    并在每条消息上附加 images(base64) 以匹配 Ollama 的多模态输入格式。
    """
    prepared: List[Dict[str, Any]] = []
    is_vl_model = model_name in VL_MODELS

    if not is_vl_model:
        print(f"[DEBUG] model {model_name} not in VL_MODELS, image parts will be ignored")

    for message in messages:
        content = message.content
        if isinstance(content, str) or content is None:
            payload = {"role": message.role, "content": content or ""}
            if message.name:
                payload["name"] = message.name
            prepared.append(payload)
            continue

        if not isinstance(content, list):
            payload = {"role": message.role, "content": ""}
            if message.name:
                payload["name"] = message.name
            prepared.append(payload)
            continue

        text_segments: List[str] = []
        images_b64: List[str] = []
        for part in content:
            if part.type == "text" and part.text:
                text_segments.append(part.text)
            elif part.type == "image_url" and part.image_url:
                if not is_vl_model:
                    print(
                        f"[WARN] ignore image for non-VL model {model_name}, role={message.role}"
                    )
                    continue
                image_field = part.image_url
                url: Optional[str] = None
                if isinstance(image_field, dict):
                    url = image_field.get("url") or image_field.get("data")
                elif isinstance(image_field, str):
                    url = image_field

                if not url:
                    print("[WARN] image_url part missing url field, skip")
                    continue

                b64_data: Optional[str] = None
                if url.startswith("data:image"):
                    b64_data = _extract_base64_from_data_url(url)
                    saved_url = _save_data_url_image(url)
                    if saved_url and isinstance(image_field, dict):
                        image_field["url"] = saved_url
                        image_field.pop("data", None)
                else:
                    b64_data = _local_url_to_base64(url)

                if not b64_data:
                    continue

                images_b64.append(b64_data)

        message_payload: Dict[str, Any] = {
            "role": message.role,
            "content": "\n\n".join(text_segments),
        }
        if message.name:
            message_payload["name"] = message.name
        if images_b64:
            message_payload["images"] = images_b64

        prepared.append(message_payload)

    print(f"[DEBUG] prepared textual messages for model={model_name}, count={len(prepared)}")
    return prepared


# 非流式调用：直接把请求转发到 Ollama 并返回完整响应
async def _forward_non_streaming(
    payload: Dict[str, Any], timeout: httpx.Timeout
) -> Response:
    async with httpx.AsyncClient(timeout=timeout) as client:
        _log_payload_debug(payload)
        debug_path = f"/tmp/ollama_payload_{int(time.time())}.json"
        try:
            with open(debug_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            print(f"[DEBUG] saved payload to {debug_path}")
        except Exception as e:
            print(f"[DEBUG] failed to save payload: {e}")

        # 使用 httpx POST 请求调用 Ollama，timeout 控制整体和连接超时
        response = await client.post(OLLAMA_URL, json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=exc.response.text,
            ) from exc
        return Response(
            content=response.content,
            status_code=response.status_code,
            media_type=response.headers.get("content-type", "application/json"),
        )


# 流式调用：保持流式连接，将 Ollama 的字节块原样转发给客户端
async def proxy_stream_chat_completions(request: ChatCompletionRequest):
    """通过 Ollama 的 stream 接口逐行产出 JSON，供 StreamingResponse 包装使用。"""
    prepared_messages = build_ollama_messages(request.messages, request.model)
    request_dict = request.dict(exclude_none=True)
    request_dict["messages"] = prepared_messages
    request_dict["stream"] = True
    ollama_payload = _build_ollama_payload(request_dict)
    timeout = httpx.Timeout(60.0, connect=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        _log_payload_debug(ollama_payload)
        debug_path = f"/tmp/ollama_payload_{int(time.time())}.json"
        try:
            with open(debug_path, "w", encoding="utf-8") as f:
                json.dump(ollama_payload, f, ensure_ascii=False)
            print(f"[DEBUG] saved payload to {debug_path}")
        except Exception as e:
            print(f"[DEBUG] failed to save payload: {e}")

        try:
            async with client.stream("POST", OLLAMA_URL, json=ollama_payload) as resp:
                resp.raise_for_status()
                async for chunk in resp.aiter_lines():
                    if not chunk.strip():
                        continue
                    yield f"{chunk}\n"
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=exc.response.text,
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to reach Ollama: {exc}",
            ) from exc


# 兼容 OpenAI 的 /v1/chat/completions 路由，内部只负责代理转发
@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    if request.stream:
        # StreamingResponse 让客户端可以边接收边渲染，体验与 OpenAI 的流式协议一致
        return StreamingResponse(
            proxy_stream_chat_completions(request), media_type="application/json"
        )

    # request.dict(exclude_none=True) 避免发送 None 字段给上游
    prepared_messages = build_ollama_messages(request.messages, request.model)
    request_dict = request.dict(exclude_none=True)
    request_dict["messages"] = prepared_messages
    # 将 OpenAI 风格请求转换成 Ollama 兼容格式
    ollama_payload = _build_ollama_payload(request_dict)
    # 定义客户端与 Ollama 交互的超时设置（60 秒响应、10 秒连接）
    timeout = httpx.Timeout(60.0, connect=10.0)

    try:
        return await _forward_non_streaming(ollama_payload, timeout)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
