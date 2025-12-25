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

## Download

- `GET /api/tasks/{task_id}/image` returns the first image as a PNG download.
