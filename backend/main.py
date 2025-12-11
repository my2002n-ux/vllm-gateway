from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple, Union, Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

# Ollama 服务地址，支持通过 OLLAMA_URL 环境变量进行 dev/prod 多环境切换
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://10.10.10.28:11434/api/chat")

app = FastAPI(title="Ollama Chat Proxy", version="1.0.0")

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
    return text, images


def normalize_messages_for_backend(messages: List[Message]) -> List[Dict[str, Any]]:
    """将 Message 转成底层模型可消费的结构，统一 content 字段，并按需附带 images。"""
    normalized: List[Dict[str, Any]] = []
    for message in messages:
        text, images = extract_text_and_images(message)
        message_dict = message.dict(exclude_none=True, exclude={"content"})
        message_dict["content"] = text
        if images:
            message_dict["images"] = images  # 底层模型可根据 images 判断是否需要多模态输入
        normalized.append(message_dict)
    return normalized


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
    request_dict["messages"] = normalize_messages_for_backend(request.messages)
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
    request_dict["messages"] = normalize_messages_for_backend(request.messages)
    # 将 OpenAI 风格请求转换成 Ollama 兼容格式
    ollama_payload = _build_ollama_payload(request_dict)
    # 定义客户端与 Ollama 交互的超时设置（60 秒响应、10 秒连接）
    timeout = httpx.Timeout(60.0, connect=10.0)

    try:
        return await _forward_non_streaming(ollama_payload, timeout)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
