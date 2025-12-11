from __future__ import annotations

import base64
import os
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


def normalize_messages_for_vl(messages: List[Message]) -> List[Dict[str, Any]]:
    """将 Message 转成 OpenAI VL 标准的 content 数组格式。"""
    normalized: List[Dict[str, Any]] = []

    for msg in messages:
        content = msg.content
        parts: List[Dict[str, Any]] = []

        if isinstance(content, str):
            parts.append({"type": "text", "text": content})
        elif isinstance(content, list):
            for part in content:
                if part.type == "text":
                    parts.append({"type": "text", "text": part.text or ""})
                elif part.type == "image_url" and part.image_url:
                    url: Optional[str] = None
                    if isinstance(part.image_url, str):
                        url = part.image_url
                    elif isinstance(part.image_url, dict):
                        url = part.image_url.get("url") or part.image_url.get("data")
                    if url:
                        parts.append({"type": "image_url", "image_url": {"url": url}})
        else:
            parts.append({"type": "text", "text": ""})

        normalized.append({"role": msg.role, "content": parts})

    return normalized

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


def _save_data_url_image(data_url: str) -> Optional[str]:
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
    print(f"[DEBUG] saved image to {file_path}, url={file_url}")
    return file_url


def replace_dataurls_with_local_files(messages: List[Message]) -> int:
    saved = 0
    for message in messages:
        content = message.content
        if not isinstance(content, list):
            continue

        for part in content:
            if part.type != "image_url" or not part.image_url:
                continue

            url: Optional[str] = None
            image_field = part.image_url
            if isinstance(image_field, dict):
                url = image_field.get("url") or image_field.get("data")
            elif isinstance(image_field, str):
                url = image_field

            if not isinstance(url, str) or not url.startswith("data:image"):
                continue

            file_url = _save_data_url_image(url)
            if not file_url:
                continue

            saved += 1
            if isinstance(image_field, dict):
                image_field["url"] = file_url
                image_field.pop("data", None)
            else:
                part.image_url = {"url": file_url}
    return saved


def extract_text_and_images(message: Message) -> Tuple[str, List[str]]:
    """拆解一条 message，返回拼接后的文本和图片 URL 列表。"""
    text_segments: List[str] = []
    images: List[str] = []
    content = message.content

    if isinstance(content, str) and content:
        text_segments.append(content)
    elif isinstance(content, list):
        for part in content:
            if part.type == "text" and part.text:
                text_segments.append(part.text)
            elif part.type == "image_url" and part.image_url:
                url = None
                if isinstance(part.image_url, dict):
                    url = part.image_url.get("url") or part.image_url.get("data")
                if isinstance(url, str):
                    images.append(url)

    text = "\n\n".join(text_segments)

    # 调试日志：记录每条消息解析出来的文本长度和图片数量
    print(
        f"[DEBUG] extract_text_and_images role={message.role}, "
        f"text_len={len(text)}, images_count={len(images)}"
    )
    if images:
        print("[DEBUG] first_image_prefix=", images[0][:60])

    return text, images


def prepare_messages_for_backend(
    request: ChatCompletionRequest,
) -> Tuple[List[Dict[str, Any]], bool]:
    """根据是否携带图片决定调用纯文本路径还是 VL 路径。"""
    text_messages: List[Dict[str, Any]] = []
    has_image = False
    total_images = 0

    for message in request.messages:
        text, images = extract_text_and_images(message)
        if images:
            has_image = True
            total_images += len(images)

        message_dict = message.dict(exclude_none=True, exclude={"content"})
        message_dict["content"] = text
        if images:
            message_dict["images"] = images
        text_messages.append(message_dict)

    if not has_image:
        print(f"[DEBUG] has_image=False, use text-only path, model={request.model}")
        return text_messages, False

    if request.model not in VL_MODELS:
        print(
            f"[WARN] model {request.model} received {total_images} images but model is not VL"
        )
        return text_messages, True

    saved_images = replace_dataurls_with_local_files(request.messages)
    if saved_images:
        print(f"[DEBUG] data URLs persisted for {saved_images} image(s)")

    print(
        f"[DEBUG] VL request model={request.model}, msg_count={len(request.messages)}, "
        f"images={total_images}"
    )
    vl_messages = normalize_messages_for_vl(request.messages)
    print(
        f"[DEBUG] has_image=True, use VL path, model={request.model}, "
        f"msg_count={len(vl_messages)}, images={total_images}"
    )
    if vl_messages:
        print(f"[DEBUG] first vl message: {vl_messages[0]}")
    else:
        print("[DEBUG] first vl message: EMPTY")
    return vl_messages, True


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


# 非流式调用：直接把请求转发到 Ollama 并返回完整响应
async def _forward_non_streaming(
    payload: Dict[str, Any], timeout: httpx.Timeout
) -> Response:
    async with httpx.AsyncClient(timeout=timeout) as client:
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
    request_dict = request.dict(exclude_none=True)
    prepared_messages, _ = prepare_messages_for_backend(request)
    request_dict["messages"] = prepared_messages
    request_dict["stream"] = True
    ollama_payload = _build_ollama_payload(request_dict)
    timeout = httpx.Timeout(60.0, connect=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
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
    request_dict = request.dict(exclude_none=True)
    prepared_messages, _ = prepare_messages_for_backend(request)
    request_dict["messages"] = prepared_messages
    # 将 OpenAI 风格请求转换成 Ollama 兼容格式
    ollama_payload = _build_ollama_payload(request_dict)
    # 定义客户端与 Ollama 交互的超时设置（60 秒响应、10 秒连接）
    timeout = httpx.Timeout(60.0, connect=10.0)

    try:
        return await _forward_non_streaming(ollama_payload, timeout)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
