# Vector Backend API

FastAPI 服务，监听 9002 端口，将前端 -> GB10 向量服务的所有请求做透明转发，不包含任何额外业务逻辑、鉴权或存储。

## 目录结构
- `app.py`：FastAPI 应用定义
- `requirements.txt`：运行依赖

## 运行方式
```bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 9002 --reload
```

## API 说明
所有接口前缀为 `/api/vector`，内部固定转发到 `http://192.168.1.28:9001` 对应的 API。

| Method | Path | 下游接口 |
| --- | --- | --- |
| GET | /api/vector/health | GET /health |
| POST | /api/vector/add | POST /v1/add |
| POST | /api/vector/search | POST /v1/search |
| GET | /api/vector/items | GET /v1/items |
| DELETE | /api/vector/items/{id} | DELETE /v1/items/{id} |
| DELETE | /api/vector/clear | DELETE /v1/clear |

## 测试
在 192.168.1.61 启动服务后，可使用以下命令进行健康检查：
```bash
curl http://127.0.0.1:9002/api/vector/health
```
