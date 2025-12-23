# JSON 工具前端

统一前端站点，包含 JSON 工具、原 frontend 页面、vector_frontend 页面，统一构建产出一个 dist。

## 启动方式

```bash
npm install
npm run dev
```

默认地址：`http://localhost:5173/`

入口：
- `/` 主页导航
- `/json/` JSON 工具
- `/llm/` 模型测试页面
- `/vector/` 原 vector_frontend 页面

## 功能清单（JSON 工具）

- 原始 JSON 输入与解析（手动解析/刷新）
- 解析失败提示（包含行列号）
- 树状结构视图（展开/收起，类型高亮，点击显示路径）
- 路径复制
- 搜索 key/值，高亮并支持上一个/下一个跳转
- 删除 key（精确 / 包含 / 通配 *），提供命中数量预览
- 删除空值字段（null / "" / 空数组 / 空对象）
- 结果 JSON 文本视图（只读）
- 复制结果 / 下载 result.json
- 结果覆盖原始、一键重置

## 验收用例

1. 粘贴合法 JSON -> 点击“解析/刷新”，右侧树 + 文本正常显示。
2. JSON 语法错误 -> 提示错误并显示行列号，右侧保持上一次正确结果。
3. 搜索 key/值 -> 命中高亮，点击“上一个/下一个”能跳转。
4. 删除 key（精确/包含/通配各测一次）-> 结果更新，命中数量正确。
5. 点击树节点 -> 显示路径，点击“复制路径”可复制。
6. 点击“复制结果”/“下载 result.json” -> 成功复制/下载。

## 目录结构

```
json_frontend/
  index.html
  json/
    index.html
  public/
    frontend/
    vector/
  package.json
  vite.config.js
  README.md
  src/
    home.js
    main.js
    style.css
    pages/JsonTool.js
    components/treeView.js
    utils/jsonOps.js
```
