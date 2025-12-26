from __future__ import annotations

import json
import os
from copy import deepcopy
from typing import Any, Dict, Optional


class TemplateError(ValueError):
    pass


_TEMPLATE_MAP = {
    "min": "template_min.API_READY.json",
    "lora_upscale": "z_image_turbo_lora_upscale_api.final.prompt.json",
}

_ALLOWED_UPSCALE_MODELS = {
    "upscale/RealESRGAN_x2plus.pth",
    "upscale/RealESRGAN_x4plus.pth",
}


def _template_path(template_id: str) -> str:
    filename = _TEMPLATE_MAP.get(template_id)
    if not filename:
        raise TemplateError(f"Unknown template_id: {template_id}")
    base_dir = os.path.join(os.path.dirname(__file__), "..", "templates")
    return os.path.abspath(os.path.join(base_dir, filename))


def _load_template(template_id: str) -> Dict[str, Any]:
    path = _template_path(template_id)
    if not os.path.exists(path):
        raise TemplateError(f"Template file not found: {path}")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise TemplateError(f"Failed to load template: {path}: {exc}") from exc


def _extract_prompt(template: Dict[str, Any]) -> Dict[str, Any]:
    prompt = template.get("prompt") if isinstance(template, dict) else None
    if not isinstance(prompt, dict):
        prompt = template
    if not isinstance(prompt, dict):
        raise TemplateError("Template prompt must be an object map of nodes")

    filtered: Dict[str, Any] = {
        key: value
        for key, value in prompt.items()
        if isinstance(value, dict)
        and "class_type" in value
        and "inputs" in value
    }
    if not filtered:
        raise TemplateError("Template prompt is missing ComfyUI node definitions")
    return filtered


def _ensure_node(prompt: Dict[str, Any], node_id: str) -> Dict[str, Any]:
    node = prompt.get(node_id)
    if not isinstance(node, dict) or "inputs" not in node:
        raise TemplateError(f"Node {node_id} not found in template")
    return node


def _ensure_inputs(prompt: Dict[str, Any], node_id: str) -> Dict[str, Any]:
    node = _ensure_node(prompt, node_id)
    inputs = node.get("inputs")
    if not isinstance(inputs, dict):
        raise TemplateError(f"Node {node_id} inputs missing or invalid")
    return inputs


def build_prompt(
    template_id: str,
    prompt_text: str,
    seed: int,
    width: int,
    height: int,
    cfg: float = 7.0,
    batch_size: int = 1,
    enable_lora: bool = False,
    lora_name: Optional[str] = None,
    enable_upscale: bool = False,
    upscale_model_name: Optional[str] = None,
) -> Dict[str, Any]:
    raw_template = _load_template(template_id)
    prompt = _extract_prompt(raw_template)
    prompt = deepcopy(prompt)

    _ensure_inputs(prompt, "45")["text"] = prompt_text
    _ensure_inputs(prompt, "44")["seed"] = seed
    size_inputs = _ensure_inputs(prompt, "41")
    size_inputs["width"] = width
    size_inputs["height"] = height
    size_inputs["batch_size"] = batch_size

    if template_id != "lora_upscale" and (enable_lora or enable_upscale or lora_name or upscale_model_name):
        raise TemplateError("LoRA/upscale options are only valid for lora_upscale template")

    if template_id == "lora_upscale":
        if enable_lora:
            if not lora_name:
                raise TemplateError("enable_lora is true but lora_name is empty")
            _ensure_inputs(prompt, "48")["lora_name"] = lora_name
        else:
            _ensure_inputs(prompt, "47")["model"] = ["46", 0]
            _ensure_inputs(prompt, "45")["clip"] = ["39", 0]

        if enable_upscale:
            if not upscale_model_name:
                raise TemplateError("enable_upscale is true but upscale_model_name is empty")
            if upscale_model_name not in _ALLOWED_UPSCALE_MODELS:
                raise TemplateError(f"upscale_model_name not allowed: {upscale_model_name}")
            _ensure_inputs(prompt, "49")["model_name"] = upscale_model_name
            _ensure_inputs(prompt, "9")["images"] = ["50", 0]
        else:
            _ensure_inputs(prompt, "9")["images"] = ["43", 0]

    sampler_ids = []
    for node_id, node in prompt.items():
        class_type = node.get("class_type")
        if isinstance(class_type, str) and class_type.startswith("KSampler"):
            inputs = node.get("inputs")
            if isinstance(inputs, dict):
                inputs["cfg"] = cfg
                sampler_ids.append(node_id)

    if sampler_ids:
        print(f"[INFO] applied cfg={cfg} to sampler nodes: {sampler_ids}")
    else:
        print("[WARN] CFG not applied: sampler node not found")

    return prompt
