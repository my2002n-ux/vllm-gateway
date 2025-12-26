# ComfyUI Backend

Standalone FastAPI service that submits parameterized workflows to ComfyUI.

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8010
```

## Configuration

- `COMFYUI_BASE_URL` (default: `http://192.168.1.28:8188`)
- `LORA_ALLOWLIST` (default: `*` to allow any LoRA; set a comma-separated list to enforce)

## Templates

Place workflow JSON files in `app/templates/`:

- `template_min.API_READY.json`
- `z_image_turbo_lora_upscale_api.final.prompt.json`

## CFG Testing

Use curl to compare different cfg values with the same prompt/seed:

```bash
curl -sS -X POST "http://127.0.0.1:8010/api/generate" \\
  -H "Content-Type: application/json" \\
  -d '{"template_id":"min","prompt_text":"一只猫","seed":123,"width":512,"height":512,"cfg":1}'
```

```bash
curl -sS -X POST "http://127.0.0.1:8010/api/generate" \\
  -H "Content-Type: application/json" \\
  -d '{"template_id":"min","prompt_text":"一只猫","seed":123,"width":512,"height":512,"cfg":7}'
```

## Download

- `GET /api/tasks/{task_id}/image` returns the first image as a PNG download.
