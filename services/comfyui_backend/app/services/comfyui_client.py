from __future__ import annotations

import os
from typing import Any, Dict

import httpx


class ComfyUIError(RuntimeError):
    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        response_text: str | None = None,
        response_json: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_text = response_text
        self.response_json = response_json


class ComfyUIClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.getenv("COMFYUI_BASE_URL", "http://192.168.1.28:8188")

    async def submit_prompt(self, client_id: str, prompt: Dict[str, Any]) -> str:
        payload = {"client_id": client_id, "prompt": prompt}
        response = await self._request("POST", "/prompt", json=payload)
        data = response.json()
        node_errors = data.get("node_errors")
        has_node_errors = isinstance(node_errors, dict) and bool(node_errors)
        if has_node_errors or "error" in data or "errors" in data:
            raise ComfyUIError(
                "ComfyUI returned error in response body",
                status_code=response.status_code,
                response_json=data,
            )
        prompt_id = data.get("prompt_id")
        if not prompt_id:
            raise ComfyUIError(
                "ComfyUI response missing prompt_id",
                status_code=response.status_code,
                response_json=data,
            )
        return prompt_id

    async def get_history(self, prompt_id: str) -> Dict[str, Any]:
        response = await self._request("GET", f"/history/{prompt_id}")
        return response.json()

    def build_view_url(self) -> str:
        return f"{self.base_url}/view"

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        url = f"{self.base_url}{path}"
        timeout = kwargs.pop("timeout", httpx.Timeout(60.0, connect=10.0))
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.request(method, url, **kwargs)
                response.raise_for_status()
                return response
            except httpx.HTTPStatusError as exc:
                response_text = exc.response.text
                response_json = None
                try:
                    response_json = exc.response.json()
                except ValueError:
                    response_json = None
                raise ComfyUIError(
                    "ComfyUI returned non-2xx response",
                    status_code=exc.response.status_code,
                    response_text=response_text,
                    response_json=response_json,
                ) from exc
            except httpx.HTTPError as exc:
                raise ComfyUIError(f"Failed to reach ComfyUI: {exc}") from exc
