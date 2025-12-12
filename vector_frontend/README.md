# 本地向量检索测试页面

纯 HTML/JS 静态站点，通过 `http://${window.location.hostname}:9002/api/vector/*` 与向量业务后端交互，用于在本地网络上快速测试语句管理与检索效果。

## 目录结构
- `index.html` 页面入口
- `main.js` 功能逻辑，所有请求自动指向同机 9002 端口的向量后端
- `style.css` 简单样式

## 启动方式
在 192.168.1.61 服务器上进入仓库根目录，执行：

```bash
python3 -m http.server 8081 --directory vector_frontend
```

服务启动后，通过浏览器访问：

```
http://192.168.1.61:8081
```

即可打开 “本地向量检索测试” 页面。

## 功能概览
1. **语句库录入（左侧）**：批量输入文本，一键新增到语句库，自动清空输入并刷新列表。
2. **检索对比（左侧）**：输入 Query、top_k、recall_k，调用 `/api/vector/search` 获取 rank/ID/文本/score。
3. **语句库总览（右侧）**：页面加载即循环分页拉取全部 items，显示序号/ID/语句/操作，支持单条删除与清空，两侧按钮均带 Loading 状态提示。
