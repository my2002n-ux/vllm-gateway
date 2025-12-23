const host = window.location.hostname || "127.0.0.1";
const API_BASE = `http://${host}:9002`;

// 拼接 API 地址，确保 path 前后斜杠正确
function api(path) {
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

const ui = {
  bulkInput: document.getElementById("bulk-input"),
  addBtn: document.getElementById("add-texts"),
  addError: document.getElementById("add-error"),
  queryInput: document.getElementById("query-input"),
  topkInput: document.getElementById("topk-input"),
  recallInput: document.getElementById("recall-input"),
  searchBtn: document.getElementById("search-btn"),
  searchError: document.getElementById("search-error"),
  searchResults: document.getElementById("search-results"),
  resultsSection: document.getElementById("results-section"),
  refreshBtn: document.getElementById("refresh-items"),
  clearBtn: document.getElementById("clear-library"),
  itemsBody: document.getElementById("items-table-body"),
  itemsError: document.getElementById("items-error"),
};

const state = {
  pageSize: 200,
  items: [],
};

// 解析条目 ID，兼容不同字段命名
function resolveItemId(item) {
  if (!item || typeof item !== "object") return "";
  const candidates = [
    item.id,
    item._id,
    item.text_id,
    item.uuid,
    item.vector_id,
    item.doc_id,
    item.record_id,
    item.metadata?.id,
    item.metadata?._id,
    item.metadata?.text_id,
    item.metadata?.uuid,
  ];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str.length) return str;
  }
  return "";
}

function escapeHtml(text) {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setItemsError(message) {
  if (!message) {
    ui.itemsError.classList.add("hidden");
    ui.itemsError.textContent = "";
    return;
  }
  ui.itemsError.textContent = message;
  ui.itemsError.classList.remove("hidden");
}

function toggleButtonLoading(button, loadingText, isLoading) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    const original = button.dataset.originalText;
    if (original) button.textContent = original;
    button.disabled = false;
    delete button.dataset.originalText;
  }
}

// 统一封装 fetch 请求，负责 URL 拼接 / Debug 输出 / 错误提示
async function apiRequest(path, { method = "GET", params, body } = {}) {
  const upperMethod = method.toUpperCase();
  const query = params ? new URLSearchParams(params).toString() : "";
  const url = `${api(path)}${query ? `?${query}` : ""}`;

  const headers = { Accept: "application/json" };
  const options = { method: upperMethod, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  console.log(`[API] ${upperMethod} ${url}`);

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `HTTP ${response.status}`);
    }
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (parseError) {
      return { raw: text };
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function normalizeItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

// 加载语句库（循环分页直到返回数量不足 pageSize）
async function loadItems() {
  ui.itemsError.classList.add("hidden");
  try {
    const allItems = [];
    let page = 1;
    while (true) {
      const result = await apiRequest("/api/vector/items", {
        params: { page: String(page), page_size: String(state.pageSize) },
      });
      const batch = normalizeItems(result);
      if (!batch.length) break;
      allItems.push(...batch);
      if (batch.length < state.pageSize) break;
      page += 1;
    }
    state.items = allItems;
    renderItems();
    setItemsError("");
  } catch (error) {
    console.error(error);
    setItemsError(`语句库加载失败：${error.message}`);
  }
}

function renderItems() {
  if (!state.items.length) {
    ui.itemsBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#6b7280">暂无数据</td></tr>`;
    return;
  }

  ui.itemsBody.innerHTML = state.items
    .map((item, index) => {
      const resolvedId = resolveItemId(item);
      const text = item.text || item.content || item.metadata?.text || "";
      const safeText = escapeHtml(text);
      const safeId = escapeHtml(resolvedId);
      const encodedId = resolvedId ? encodeURIComponent(resolvedId) : "";
      const buttonAttrs = encodedId ? `data-id="${encodedId}"` : `data-id="" disabled title="缺少 ID"`;
      const buttonLabel = encodedId ? "删除" : "无 ID";
      return `
        <tr>
          <td class="col-index">${index + 1}</td>
          <td class="col-id" title="${safeId}">${safeId || "-"}</td>
          <td class="col-text" title="${safeText}">${safeText}</td>
          <td class="col-actions">
            <button class="btn danger-btn action-btn" ${buttonAttrs}>${buttonLabel}</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function normalizeResults(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function extractScore(item) {
  if (typeof item.score === "number") return item.score;
  if (typeof item.similarity === "number") return item.similarity;
  if (typeof item.distance === "number") return item.distance;
  return null;
}

// 将原始 score 转为百分比显示
function formatScorePercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

// 批量新增文本
async function handleAddTexts() {
  const texts = ui.bulkInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!texts.length) {
    ui.addError.textContent = "请输入至少一条语句";
    ui.addError.classList.remove("hidden");
    return;
  }

  ui.addError.classList.add("hidden");
  toggleButtonLoading(ui.addBtn, "新增中…", true);
  try {
    await apiRequest("/api/vector/add", {
      method: "POST",
      body: { texts: Array.from(new Set(texts)) },
    });
    ui.bulkInput.value = "";
    await refreshLibrary();
    setItemsError("");
  } catch (error) {
    ui.addError.textContent = `新增失败：${error.message || "未知错误"}`;
    ui.addError.classList.remove("hidden");
  } finally {
    toggleButtonLoading(ui.addBtn, "", false);
  }
}

// 检索对比
async function handleSearch() {
  const query = ui.queryInput.value.trim();
  const top_k = Number(ui.topkInput.value) || 10;
  const recall_k = Number(ui.recallInput.value) || 50;

  if (!query) {
    ui.searchError.textContent = "请输入 Query";
    ui.searchError.classList.remove("hidden");
    return;
  }

  ui.searchError.classList.add("hidden");
  toggleButtonLoading(ui.searchBtn, "检索中…", true);
  try {
    const result = await apiRequest("/api/vector/search", {
      method: "POST",
      body: { query, top_k, recall_k },
    });
    const normalized = normalizeResults(result);
    renderSearchResults(normalized);
    if (!normalized.length) {
      ui.searchError.textContent = "无匹配结果";
      ui.searchError.classList.remove("hidden");
    } else {
      ui.searchError.classList.add("hidden");
    }
  } catch (error) {
    ui.searchError.textContent = `检索失败：${error.message || "请稍后重试"}`;
    ui.searchError.classList.remove("hidden");
    ui.searchResults.innerHTML = "";
    ui.resultsSection.classList.add("hidden");
  } finally {
    toggleButtonLoading(ui.searchBtn, "", false);
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    ui.resultsSection.classList.add("hidden");
    ui.searchResults.innerHTML = "";
    return;
  }

  ui.resultsSection.classList.remove("hidden");
  const rows = results
    .map((item, index) => {
      const text = item.text || item.content || item.metadata?.text || "";
      const score = extractScore(item);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            ${text}
          </td>
          <td>${formatScorePercent(score)}</td>
        </tr>
      `;
    })
    .join("");

  ui.searchResults.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>命中文本</th>
          <th>匹配度</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// 删除单条语句：使用表格按钮上的 data-id 拼接 DELETE 请求
async function handleDelete(itemId, button) {
  if (!itemId) {
    setItemsError("删除失败：缺少条目 ID");
    return;
  }

  toggleButtonLoading(button, "删除中…", true);
  try {
    await apiRequest(`/api/vector/items/${itemId}`, {
      method: "DELETE",
    });
    await refreshLibrary();
    setItemsError("");
  } catch (error) {
    setItemsError(`删除失败：${error.message}`);
  } finally {
    toggleButtonLoading(button, "", false);
  }
}

// 清空语句库（无确认弹窗，错误统一展示在列表区域）
async function handleClear() {
  toggleButtonLoading(ui.clearBtn, "清空中…", true);
  try {
    await apiRequest("/api/vector/clear", { method: "DELETE" });
    await refreshLibrary();
    setItemsError("");
  } catch (error) {
    setItemsError(`清空失败：${error.message}`);
  } finally {
    toggleButtonLoading(ui.clearBtn, "", false);
  }
}

async function refreshLibrary() {
  await loadItems();
}

function attachEvents() {
  ui.addBtn.addEventListener("click", handleAddTexts);
  ui.searchBtn.addEventListener("click", handleSearch);
  ui.refreshBtn.addEventListener("click", async () => {
    toggleButtonLoading(ui.refreshBtn, "刷新中…", true);
    await refreshLibrary();
    toggleButtonLoading(ui.refreshBtn, "", false);
  });
  ui.clearBtn.addEventListener("click", handleClear);
  // 从删除按钮 dataset 中读取条目 ID，随后发起删除请求
  ui.itemsBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const datasetId = button.getAttribute("data-id");
    handleDelete(datasetId, button);
  });
}

async function init() {
  attachEvents();
  await refreshLibrary();
}

init();
