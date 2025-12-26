import './zimage.css';

const API_BASE = 'http://10.10.10.61:8010';
const STORAGE_KEY = 'zimage_history_v1';
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 120;
const POLL_MAX_DELAY_MS = 5000;
const POLL_READY_DELAY_MS = 2000;
const POLL_INITIAL_DELAY_MS = 1500;
const POLL_TIMEOUT_MS = 120000;

const LORA_OPTIONS = [
  { label: '卡通形象', value: 'BeautifulPeaches_ZIT.safetensors' },
  { label: '漫画风格', value: 'MoonlightCAT_ZIT.safetensors' },
  { label: '真实场景风格', value: 'Z-Real-v1.0.safetensors' },
  { label: '优化过的真实风格', value: 'lenovo_z.safetensors' },
];

const UPSCALE_OPTIONS = [
  { label: '2倍放大', value: 'upscale/RealESRGAN_x2plus.pth', enable: true, desc: '2倍放大' },
  { label: '4倍放大', value: 'upscale/RealESRGAN_x4plus.pth', enable: true, desc: '4倍放大' },
  { label: '原始尺寸（不放大）', value: '', enable: false, desc: '原始尺寸' },
];

export function createZImageToolPage() {
  const container = document.createElement('div');
  container.className = 'zimage-page page';
  container.innerHTML = `
    <div class="workspace">
      <div class="layout zimage-layout">
        <section class="panel left-panel">
          <div class="panel-header">
            <a class="home-link" href="/">< 返回</a>
          </div>
          <div class="card zimage-card">
            <div class="card-body">
              <div class="zimage-title">调试区</div>

              <div class="zimage-section">
                <div class="zimage-label">图片工作流</div>
                <div class="zimage-radio-group">
                  <label class="zimage-radio">
                    <input type="radio" name="template" value="min" checked />
                    简单生成
                  </label>
                  <label class="zimage-radio">
                    <input type="radio" name="template" value="lora_upscale" />
                    指定风格
                  </label>
                </div>
              </div>

              <div id="zimage-style-panel" class="zimage-section hidden">
                <div class="zimage-subtitle">LoRA 配置</div>
                <label class="zimage-field zimage-inline">
                  <select id="zimage-lora-select" class="input"></select>
                </label>
                <div id="zimage-lora-name" class="zimage-note"></div>

                <div class="zimage-subtitle">Upscale配置</div>
                <label class="zimage-field zimage-inline">
                  <select id="zimage-upscale-select" class="input"></select>
                </label>
                <div id="zimage-upscale-desc" class="zimage-note"></div>
              </div>

              <div class="zimage-section">
                <div class="zimage-label">尺寸</div>
                <div class="zimage-row">
                  <label class="zimage-field zimage-inline">
                    <input id="zimage-width" class="input" type="number" min="64" value="512" />
                  </label>
                  <label class="zimage-field zimage-inline">
                    <input id="zimage-height" class="input" type="number" min="64" value="512" />
                  </label>
                </div>
                <div class="zimage-quick">
                  <button type="button" class="btn-secondary zimage-quick-btn" data-size="512">512×512</button>
                  <button type="button" class="btn-secondary zimage-quick-btn" data-width="1024" data-height="576">1024×576</button>
                  <button type="button" class="btn-secondary zimage-quick-btn" data-width="1024" data-height="768">1024×768</button>
                  <button type="button" class="btn-secondary zimage-quick-btn" data-width="576" data-height="1024">576×1024</button>
                  <button type="button" class="btn-secondary zimage-quick-btn" data-width="900" data-height="383">900×383</button>
                  <button type="button" class="btn-secondary zimage-quick-btn" data-width="1080" data-height="1350">1080×1350</button>
                </div>
              </div>

              <div class="zimage-section">
                <div class="zimage-label">随机种子</div>
                <div class="zimage-seed-row">
                  <label class="zimage-field zimage-inline">
                    <input id="zimage-seed" class="input" type="number" />
                  </label>
                  <button type="button" id="zimage-seed-random" class="btn-secondary">随机</button>
                </div>
              </div>

              <div class="zimage-section">
                <div class="zimage-label">Prompt</div>
                <label class="zimage-field">
                  <span class="zimage-field-label">固定指令</span>
                  <textarea id="zimage-prompt-fixed" class="input zimage-textarea" rows="4" placeholder="可填写固定风格或规则"></textarea>
                </label>
                <label class="zimage-field">
                  <span class="zimage-field-label">动态指令</span>
                  <textarea id="zimage-prompt-dynamic" class="input zimage-textarea" rows="4" placeholder="请输入需要生成的内容"></textarea>
                </label>
              </div>

              <div class="zimage-action">
                <button type="button" id="zimage-generate" class="btn-primary">生成图片</button>
                <div id="zimage-status" class="zimage-status">等待生成任务</div>
                <div id="zimage-error" class="zimage-error hidden"></div>
              </div>
            </div>
          </div>
        </section>

        <section class="panel right-panel">
          <div class="panel-header">
            <div class="home-link home-spacer" aria-hidden="true"></div>
          </div>
          <div class="card zimage-card full-height">
            <div class="card-body">
              <div class="zimage-title">生成结果</div>
              <div id="zimage-grid" class="zimage-grid"></div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div id="zimage-overlay" class="zimage-overlay hidden">
      <div class="zimage-overlay-content">
        <button type="button" id="zimage-overlay-close" class="zimage-overlay-close" aria-label="关闭">
          <span class="zimage-delete-icon" aria-hidden="true"></span>
        </button>
        <img id="zimage-overlay-img" alt="预览" />
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    initZImageTool();
  });

  return container;
}

function initZImageTool() {
  const ui = {
    width: document.getElementById('zimage-width'),
    height: document.getElementById('zimage-height'),
    seed: document.getElementById('zimage-seed'),
    seedRandom: document.getElementById('zimage-seed-random'),
    templateInputs: Array.from(document.querySelectorAll('input[name="template"]')),
    stylePanel: document.getElementById('zimage-style-panel'),
    loraSelect: document.getElementById('zimage-lora-select'),
    loraName: document.getElementById('zimage-lora-name'),
    upscaleSelect: document.getElementById('zimage-upscale-select'),
    upscaleDesc: document.getElementById('zimage-upscale-desc'),
    promptFixed: document.getElementById('zimage-prompt-fixed'),
    promptDynamic: document.getElementById('zimage-prompt-dynamic'),
    generateBtn: document.getElementById('zimage-generate'),
    status: document.getElementById('zimage-status'),
    error: document.getElementById('zimage-error'),
    grid: document.getElementById('zimage-grid'),
    overlay: document.getElementById('zimage-overlay'),
    overlayImg: document.getElementById('zimage-overlay-img'),
    overlayClose: document.getElementById('zimage-overlay-close'),
  };

  const pollers = new Map();
  const state = {
    templateId: 'min',
    history: [],
  };

  function setStatus(message) {
    ui.status.textContent = message || '';
  }

  function setError(message) {
    if (!ui.error) return;
    if (!message) {
      ui.error.textContent = '';
      ui.error.classList.add('hidden');
      return;
    }
    ui.error.textContent = message;
    ui.error.classList.remove('hidden');
  }

  async function readErrorBody(res) {
    try {
      const data = await res.clone().json();
      if (data?.detail !== undefined) {
        return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
      }
      return JSON.stringify(data);
    } catch (err) {
      try {
        return await res.text();
      } catch (innerErr) {
        return '';
      }
    }
  }

  function isPendingDetail(detail) {
    if (!detail) return false;
    const text = String(detail);
    return text.includes('No images available for this task');
  }

  function randomSeed() {
    const min = 10 ** 10;
    const max = 10 ** 11 - 1;
    return Math.floor(min + Math.random() * (max - min)).toString();
  }

  function getPromptText() {
    const fixed = ui.promptFixed.value.trim();
    const dynamic = ui.promptDynamic.value.trim();
    if (fixed && dynamic) return `${fixed}\n${dynamic}`;
    return fixed || dynamic || '';
  }

  function readNumber(input, fallback) {
    const value = Number(input.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.map((item) => ({
        ...item,
        images: Array.isArray(item.images) ? item.images : [],
        elapsedMs: item.elapsedMs ?? item.durationMs ?? null,
        displayWidth: item.displayWidth ?? item.display_width ?? null,
        displayHeight: item.displayHeight ?? item.display_height ?? null,
        enableUpscale: item.enableUpscale ?? item.enable_upscale ?? false,
        upscaleModelName: item.upscaleModelName ?? item.upscale_model_name ?? '',
        baseWidth: item.baseWidth ?? item.base_width ?? item.width ?? 0,
        baseHeight: item.baseHeight ?? item.base_height ?? item.height ?? 0,
      }));
    } catch (err) {
      console.warn('Failed to load history', err);
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history));
    } catch (err) {
      console.warn('Failed to save history', err);
    }
  }

  function setTemplate(templateId) {
    state.templateId = templateId;
    if (templateId === 'lora_upscale') {
      ui.stylePanel.classList.remove('hidden');
      const defaultLora = LORA_OPTIONS.find((opt) => opt.value === 'Z-Real-v1.0.safetensors');
      ui.loraSelect.value = defaultLora ? defaultLora.value : LORA_OPTIONS[0].value;
      updateLoraNote();
      if (ui.upscaleSelect && UPSCALE_OPTIONS.length) {
        ui.upscaleSelect.value = UPSCALE_OPTIONS[0].value;
        updateUpscaleNote();
      }
    } else {
      ui.stylePanel.classList.add('hidden');
      if (ui.loraSelect && LORA_OPTIONS.length) {
        ui.loraSelect.value = LORA_OPTIONS[0].value;
        updateLoraNote();
      }
      if (ui.upscaleSelect && UPSCALE_OPTIONS.length) {
        ui.upscaleSelect.value = UPSCALE_OPTIONS[0].value;
        updateUpscaleNote();
      }
    }
  }

  function setupSelectors() {
    LORA_OPTIONS.forEach((option) => {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      ui.loraSelect.appendChild(opt);
    });
    UPSCALE_OPTIONS.forEach((option) => {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      ui.upscaleSelect.appendChild(opt);
    });
    const defaultLora = LORA_OPTIONS.find((opt) => opt.value === 'Z-Real-v1.0.safetensors');
    ui.loraSelect.value = defaultLora ? defaultLora.value : LORA_OPTIONS[0].value;
    ui.upscaleSelect.value = UPSCALE_OPTIONS[0].value;
    updateLoraNote();
    updateUpscaleNote();
  }

  function updateLoraNote() {
    const selected = LORA_OPTIONS.find((opt) => opt.value === ui.loraSelect.value);
    ui.loraName.textContent = `LoRA模型名称：${selected ? selected.value : '-'}`;
  }

  function updateUpscaleNote() {
    const selected = UPSCALE_OPTIONS.find((opt) => opt.value === ui.upscaleSelect.value);
    if (!selected || !selected.enable) {
      ui.upscaleDesc.textContent = 'Upscale模型名称：不放大';
    } else {
      ui.upscaleDesc.textContent = `Upscale模型名称：${selected.value}`;
    }
  }

  function resolveUpscaleMultiplier(modelName, enabled) {
    if (!enabled || !modelName) return 1;
    const lower = modelName.toLowerCase();
    if (lower.includes('x4')) return 4;
    if (lower.includes('x2')) return 2;
    return 1;
  }

  function computeDisplaySize(record) {
    const baseWidth = record.baseWidth || record.width || 0;
    const baseHeight = record.baseHeight || record.height || 0;
    const multiplier = resolveUpscaleMultiplier(
      record.upscaleModelName,
      record.enableUpscale
    );
    return {
      displayWidth: baseWidth ? baseWidth * multiplier : baseWidth,
      displayHeight: baseHeight ? baseHeight * multiplier : baseHeight,
    };
  }

  function formatTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  function formatDuration(ms) {
    if (!ms && ms !== 0) return '-';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  function showOverlay(url) {
    ui.overlayImg.src = url;
    ui.overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    ui.overlay.classList.add('hidden');
    ui.overlayImg.src = '';
  }

  function copyText(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => setStatus('已复制图片 URL'),
      () => setStatus('复制失败')
    );
  }

  function buildCard(item) {
    const card = document.createElement('div');
    card.className = 'zimage-item';

    const preview = document.createElement('div');
    preview.className = 'zimage-preview';
    if (item.url) {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.filename || 'image';
      preview.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'zimage-placeholder';
      placeholder.textContent = item.status === 'failed' ? '生成失败' : '生成中';
      preview.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'zimage-info';
    info.innerHTML = `
      <div>生成时间：${formatTime(item.createdAt)}</div>
      <div>尺寸：${item.displayWidth || '-'}×${item.displayHeight || '-'}</div>
      <div class="zimage-filename">${item.filename || '未生成'}</div>
      <div class="zimage-task">task_id：${item.taskId || '-'}</div>
      <div>耗时：${formatDuration(item.elapsedMs)}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'zimage-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-secondary';
    copyBtn.textContent = '复制URL';
    copyBtn.disabled = !item.url;
    copyBtn.addEventListener('click', () => copyText(item.url));

    const copyTaskBtn = document.createElement('button');
    copyTaskBtn.type = 'button';
    copyTaskBtn.className = 'btn-secondary';
    copyTaskBtn.textContent = 'Task_ID';
    copyTaskBtn.disabled = !item.taskId;
    copyTaskBtn.addEventListener('click', () => copyText(item.taskId));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'zimage-delete';
    deleteBtn.setAttribute('aria-label', '删除图片');
    deleteBtn.innerHTML = '<span class="zimage-delete-icon" aria-hidden="true"></span>';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      removeRecord(item.recordId);
    });

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'btn-secondary';
    viewBtn.textContent = '打开图片';
    viewBtn.disabled = !item.url;
    viewBtn.addEventListener('click', () => showOverlay(item.url));

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn-secondary';
    retryBtn.textContent = '重新获取';
    retryBtn.disabled = !item.taskId;
    retryBtn.addEventListener('click', () => recoverImages(item.taskId));

    actions.appendChild(copyBtn);
    actions.appendChild(copyTaskBtn);
    actions.appendChild(viewBtn);
    actions.appendChild(retryBtn);

    card.appendChild(preview);
    card.appendChild(deleteBtn);
    card.appendChild(info);
    card.appendChild(actions);
    return card;
  }

  function renderHistory() {
    ui.grid.innerHTML = '';
    const items = [];
    state.history.forEach((record) => {
      if (record.images && record.images.length) {
        record.images.forEach((image) => {
        items.push({
          recordId: record.id,
          status: record.status,
          createdAt: record.createdAt,
          elapsedMs: record.elapsedMs,
          taskId: record.taskId,
          displayWidth: record.displayWidth || image.width || record.width,
          displayHeight: record.displayHeight || image.height || record.height,
          filename: image.filename,
          url: image.url,
        });
      });
    } else {
      const displayWidth = record.displayWidth || record.width;
      const displayHeight = record.displayHeight || record.height;
      items.push({
        recordId: record.id,
        status: record.status,
        createdAt: record.createdAt,
        elapsedMs: record.elapsedMs,
        taskId: record.taskId,
        displayWidth,
        displayHeight,
        filename: record.filename,
        url: record.url,
      });
    }
    });

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'zimage-empty';
      empty.textContent = '暂无生成记录';
      ui.grid.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      ui.grid.appendChild(buildCard(item));
    });
  }

  function updateRecord(recordId, updater) {
    const idx = state.history.findIndex((item) => item.id === recordId);
    if (idx === -1) return;
    const next = { ...state.history[idx], ...updater };
    if (next.displayWidth == null || next.displayHeight == null) {
      const computed = computeDisplaySize(next);
      next.displayWidth = computed.displayWidth;
      next.displayHeight = computed.displayHeight;
    }
    state.history[idx] = next;
    saveHistory();
    renderHistory();
  }

  function removeRecord(recordId) {
    state.history = state.history.filter((item) => item.id !== recordId);
    saveHistory();
    renderHistory();
  }

  async function pollImages(record) {
    const elapsed = record.startTs ? Date.now() - record.startTs : 0;
    if (elapsed > POLL_TIMEOUT_MS) {
      updateRecord(record.id, {
        status: 'failed',
        error: '超时未生成',
        doneTs: Date.now(),
        elapsedMs: record.startTs ? Date.now() - record.startTs : null,
      });
      setStatus('任务超时未完成');
      setError('任务超时未完成');
      pollers.delete(record.id);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${record.taskId}/images`);
      if (res.status === 404) {
        const state = pollers.get(record.id);
        const nextDelay = Math.min(
          POLL_MAX_DELAY_MS,
          (state?.delay || POLL_INITIAL_DELAY_MS) + 1000
        );
        scheduleNextPoll(record, nextDelay);
        return;
      } else if (!res.ok) {
        const detail = await readErrorBody(res);
        if (isPendingDetail(detail)) {
          scheduleNextPoll(record, POLL_READY_DELAY_MS);
          return;
        }
        throw new Error(`请求失败: ${res.status} ${detail}`.trim());
      } else {
        const data = await res.json();
        if (isPendingDetail(data?.detail)) {
          scheduleNextPoll(record, POLL_READY_DELAY_MS);
          return;
        }
        if (data.images && data.images.length) {
          const doneTs = record.doneTs || Date.now();
          updateRecord(record.id, {
            status: 'done',
            images: data.images,
            doneTs,
            elapsedMs: record.startTs ? doneTs - record.startTs : null,
            displayWidth: record.displayWidth ?? data.images[0]?.width ?? record.width,
            displayHeight: record.displayHeight ?? data.images[0]?.height ?? record.height,
          });
          pollers.delete(record.id);
          return;
        }
        scheduleNextPoll(record, POLL_READY_DELAY_MS);
        return;
      }
    } catch (err) {
      const nextErrorCount = (record.errorCount || 0) + 1;
      updateRecord(record.id, {
        errorCount: nextErrorCount,
      });
      if (nextErrorCount >= 5) {
        updateRecord(record.id, {
          status: 'failed',
          error: err?.message || '请求失败',
          doneTs: Date.now(),
          elapsedMs: record.startTs ? Date.now() - record.startTs : null,
        });
        setError(err?.message || '请求失败');
        setStatus('生成失败，请检查后端');
        pollers.delete(record.id);
        return;
      }
      const state = pollers.get(record.id);
      const nextDelay = Math.min(
        POLL_MAX_DELAY_MS,
        (state?.delay || POLL_READY_DELAY_MS) + 1000
      );
      scheduleNextPoll(record, nextDelay);
      return;
    }
  }

  function scheduleNextPoll(record, delay) {
    const state = pollers.get(record.id);
    if (state?.timer) {
      window.clearTimeout(state.timer);
    }
    const timer = window.setTimeout(() => {
      pollImages(record);
    }, delay);
    pollers.set(record.id, { timer, delay });
  }

  function startPolling(record) {
    if (pollers.has(record.id)) return;
    scheduleNextPoll(record, POLL_INITIAL_DELAY_MS);
  }

  async function handleGenerate() {
    if (ui.generateBtn.disabled) return;
    const width = readNumber(ui.width, 512);
    const height = readNumber(ui.height, 512);
    const seedValue = ui.seed.value.trim();
    const seed = seedValue ? Number(seedValue) : Number(randomSeed());
    if (!Number.isFinite(seed)) {
      setStatus('seed 必须是数字');
      return;
    }
    ui.seed.value = String(seed);

    const promptText = getPromptText();
    if (!promptText) {
      setError('请填写 Prompt');
      setStatus('提交失败');
      return;
    }

    const payload = {
      template_id: state.templateId,
      prompt_text: promptText,
      seed,
      width,
      height,
    };

    if (state.templateId === 'lora_upscale') {
      payload.enable_lora = true;
      payload.lora_name = ui.loraSelect.value;
      const upscaleOption = UPSCALE_OPTIONS.find(
        (opt) => opt.value === ui.upscaleSelect.value
      );
      if (upscaleOption && upscaleOption.enable) {
        payload.enable_upscale = true;
        payload.upscale_model_name = upscaleOption.value;
      } else {
        payload.enable_upscale = false;
      }
    }

    ui.generateBtn.disabled = true;
    setError('');
    setStatus('正在提交任务...');

    try {
      const res = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new Error(`请求失败: ${res.status} ${detail}`.trim());
      }
      const data = await res.json();
      const enableUpscale = payload.enable_upscale === true;
      const upscaleModelName = payload.upscale_model_name || '';
      const record = {
        id: `zimage_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        taskId: data.task_id,
        status: 'running',
        createdAt: Date.now(),
        startTs: Date.now(),
        doneTs: null,
        width,
        height,
        baseWidth: width,
        baseHeight: height,
        seed,
        templateId: state.templateId,
        promptSummary: promptText.slice(0, 80),
        loraName: payload.lora_name || '',
        enableUpscale,
        upscaleModelName,
        images: [],
        elapsedMs: null,
        errorCount: 0,
      };
      const computedSize = computeDisplaySize(record);
      record.displayWidth = computedSize.displayWidth;
      record.displayHeight = computedSize.displayHeight;
      state.history.unshift(record);
      saveHistory();
      renderHistory();
      setStatus('任务已提交，等待生成结果');
      startPolling(record);
    } catch (err) {
      setError(err?.message || '未知错误');
      setStatus('提交失败');
    } finally {
      ui.generateBtn.disabled = false;
    }
  }

  async function recoverImages(taskId) {
    if (!taskId) {
      setStatus('缺少 task_id');
      return;
    }
    setStatus('正在回捞图片...');
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/images`);
      if (res.status === 404) {
        setStatus('尚未生成完成/未找到图片');
        return;
      }
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new Error(`请求失败: ${res.status} ${detail}`.trim());
      }
      const data = await res.json();
      if (!data.images || !data.images.length) {
        setStatus('尚未生成完成/未找到图片');
        return;
      }
      const existing = state.history.find((item) => item.taskId === taskId);
      if (existing) {
        const doneTs = existing.doneTs || Date.now();
        updateRecord(existing.id, {
          status: 'done',
          images: data.images,
          doneTs,
          elapsedMs: existing.startTs ? doneTs - existing.startTs : existing.elapsedMs,
          baseWidth: existing.baseWidth || existing.width || data.images[0]?.width || 0,
          baseHeight: existing.baseHeight || existing.height || data.images[0]?.height || 0,
        });
      } else {
        const doneTs = Date.now();
        const baseWidth = data.images[0]?.width || 0;
        const baseHeight = data.images[0]?.height || 0;
        const newRecord = {
          id: `zimage_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
          taskId,
          status: 'done',
          createdAt: Date.now(),
          startTs: null,
          doneTs,
          width: baseWidth,
          height: baseHeight,
          baseWidth,
          baseHeight,
          seed: '',
          templateId: '',
          promptSummary: '',
          loraName: '',
          enableUpscale: false,
          upscaleModelName: '',
          images: data.images,
          elapsedMs: null,
          errorCount: 0,
        };
        const computedSize = computeDisplaySize(newRecord);
        newRecord.displayWidth = computedSize.displayWidth;
        newRecord.displayHeight = computedSize.displayHeight;
        state.history.unshift(newRecord);
        saveHistory();
        renderHistory();
      }
      setStatus('已回捞图片');
    } catch (err) {
      setError(err?.message || '未知错误');
      setStatus('查询失败');
    }
  }

  function hydrateHistory() {
    state.history = loadHistory();
    renderHistory();
    state.history.forEach((record) => {
      if (record.status === 'running' || record.status === 'pending') {
        startPolling(record);
      }
    });
  }

  function cleanupPollers() {
    pollers.forEach((state) => window.clearTimeout(state.timer));
    pollers.clear();
  }

  ui.templateInputs.forEach((input) => {
    input.addEventListener('change', () => {
      setTemplate(input.value);
    });
  });

  document.querySelectorAll('.zimage-quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const width = Number(btn.dataset.width);
      const height = Number(btn.dataset.height);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        ui.width.value = width;
        ui.height.value = height;
        return;
      }
      const size = Number(btn.dataset.size);
      if (!Number.isFinite(size)) return;
      ui.width.value = size;
      ui.height.value = size;
    });
  });

  ui.seedRandom.addEventListener('click', () => {
    ui.seed.value = randomSeed();
  });

  ui.loraSelect.addEventListener('change', updateLoraNote);
  ui.upscaleSelect.addEventListener('change', updateUpscaleNote);
  ui.generateBtn.addEventListener('click', () => {
    handleGenerate();
  });
  ui.overlayClose.addEventListener('click', hideOverlay);
  ui.overlay.addEventListener('click', (event) => {
    if (event.target === ui.overlay) {
      hideOverlay();
    }
  });

  ui.seed.value = randomSeed();
  setupSelectors();
  setTemplate('min');
  hydrateHistory();

  window.addEventListener('beforeunload', () => {
    cleanupPollers();
  });
}
