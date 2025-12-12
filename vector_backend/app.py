from typing import Any, Dict, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

VECTOR_BASE = "http://192.168.1.28:9001"
TIMEOUT = 60

app = FastAPI(title="Vector Backend API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_response(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return {"data": response.text}


async def _forward_request(
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Any] = None,
) -> Any:
    url = f"{VECTOR_BASE}{path}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.request(method, url, params=params, json=json_body)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Vector service unavailable: {exc}") from exc

    if response.is_error:
        detail: Any
        try:
            detail = response.json()
        except ValueError:
            detail = response.text or "Vector service error"
        raise HTTPException(status_code=response.status_code, detail=detail)

    return _parse_response(response)


@app.get("/api/vector/health")
async def vector_health() -> Any:
    return await _forward_request("GET", "/health")


@app.post("/api/vector/add")
async def vector_add(request: Request) -> Any:
    payload = await request.json()
    return await _forward_request("POST", "/v1/add", json_body=payload)


@app.post("/api/vector/search")
async def vector_search(request: Request) -> Any:
    payload = await request.json()
    return await _forward_request("POST", "/v1/search", json_body=payload)


@app.get("/api/vector/items")
async def vector_items(page: int = 1, page_size: int = 50) -> Any:
    params = {"page": page, "page_size": page_size}
    return await _forward_request("GET", "/v1/items", params=params)


@app.delete("/api/vector/items/{item_id}")
async def vector_delete_item(item_id: str) -> Any:
    return await _forward_request("DELETE", f"/v1/items/{item_id}")


@app.delete("/api/vector/clear")
async def vector_clear() -> Any:
    return await _forward_request("DELETE", "/v1/clear")
