// 预定义模型列表（前端写死，后续可根据需求调整顺序/内容）
const MODEL_OPTIONS = [
  'qwen3:32b',
  'gemma3:27b',
  'qwen3-vl:32b',
  'gpt-oss:120b',
  'qwen3:30b',
];

// IMAGE_MODELS：显式支持图片的模型名单，新增多模态模型时可扩展
const IMAGE_MODELS = ['qwen3-vl:32b', 'gemma3:27b'];

// 获取调试区和内容区的各类元素
const backendInput = document.getElementById('backend-input');
const modelSelect = document.getElementById('model-select');
const systemInput = document.getElementById('system-input');
const temperatureInput = document.getElementById('temperature-input');
const maxTokensInput = document.getElementById('max-tokens-input');
const promptInput = document.getElementById('prompt-input');
const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const imageSection = document.getElementById('image-section');
const sendBtn = document.getElementById('send-btn');
const chatArea = document.getElementById('chat-area');
const statusTime = document.getElementById('status-time');
const statusResult = document.getElementById('status-result');
const imgViewerOverlay = document.getElementById('img-viewer-overlay');
const imgViewerImg = document.getElementById('img-viewer-img');
const imgViewerClose = document.getElementById('img-viewer-close');
const MAX_IMAGES = 5;
// selectedImages：记录当前选中的图片（含 dataURL），用于预览和构造请求
let selectedImages = [];
let currentController = null; // currentController：防止并发请求

initModelSelect();
updateImageSectionVisibility();
modelSelect.addEventListener('change', () => {
  updateImageSectionVisibility();
});

// 注册文件选择预览逻辑，支持多张图片预览（最多 5 张）
imageInput.addEventListener('change', async () => {
  const files = Array.from(imageInput.files || []);
  if (!files.length) return;
  const availableSlots = MAX_IMAGES - selectedImages.length;
  if (availableSlots <= 0) {
    appendSystemMessage('已经有 5 张图片，如需继续请先删除部分图片。');
    imageInput.value = '';
    return;
  }
  if (files.length > availableSlots) {
    console.log(`[INFO] 仅保留前 ${availableSlots} 张图片，其余已忽略`);
  }

  for (const file of files.slice(0, availableSlots)) {
    try {
      const dataUrl = await readFileAsDataURL(file);
      selectedImages.push({ file, dataUrl });
    } catch (err) {
      console.error('读取图片失败', err);
      appendSystemMessage(`读取图片失败：${err.message || '未知错误'}`);
    }
  }
  renderImagePreview();
  imageInput.value = '';
});

// 点击发送后处理一次完整的多模态请求
sendBtn.addEventListener('click', () => {
  handleSend().catch((err) => console.error('发送失败', err));
});

// 初始化模型下拉框，后续可改为 fetch 后端接口
function initModelSelect() {
  modelSelect.innerHTML = '';
  MODEL_OPTIONS.forEach((model) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  });
  modelSelect.value = MODEL_OPTIONS[0];
}

// 判断模型是否支持图片：白名单优先（当前含 qwen3-vl:32b、gemma3:27b），其次看模型名是否含 vl/vision
function supportsImage(modelName) {
  if (!modelName) return false;
  if (IMAGE_MODELS.includes(modelName)) {
    return true;
  }
  const lower = modelName.toLowerCase();
  if (lower.includes('vl') || lower.includes('vision')) {
    return true;
  }
  return false;
}

// 根据当前模型决定是否展示图片上传区域，并在隐藏时清空数据
function updateImageSectionVisibility() {
  const supports = supportsImage(modelSelect.value);
  if (supports) {
    imageSection.style.display = 'flex';
  } else {
    imageSection.style.display = 'none';
    selectedImages = [];
    imageInput.value = '';
    renderImagePreview();
  }
}

// 处理发送逻辑：读取输入、构造 payload、流式解析响应
async function handleSend() {
  // 如果还有未结束的请求，先终止上一轮
  if (currentController) {
    currentController.abort();
    currentController = null;
  }

  const text = promptInput.value.trim();
  const modelSupportsImage = supportsImage(modelSelect.value);
  // imageUrls：基于 imageList 数组生成的最终 URL 列表，稍后会注入 messages content 中
  const imageUrls = modelSupportsImage ? selectedImages.map((item) => item.dataUrl) : [];
  if (!text && imageUrls.length === 0) {
    alert('请输入提示词或选择一张图片。');
    return;
  }

  const requestTime = new Date();
  const requestTimeText = formatTimestamp(requestTime);
  const selectedModel = modelSelect.value;

  setStatusResult('请求进行中...', null);
  const startTime = performance.now();
  updateButtonsDuringRequest(true);
  const controller = new AbortController(); // 控制单次请求的中断，防止并发
  currentController = controller;
  let assistantMsg = null;
  const usageHolder = { data: null };

  try {
    if (!modelSupportsImage && !text) {
      throw new Error('当前模型不支持图片，且没有可发送的文本。');
    }

    const messages = buildMessages(systemInput.value.trim(), text, imageUrls);
    const payload = buildPayload(messages, selectedModel);
    console.log('payload', payload); // 方便在浏览器中检查最终请求体结构

    appendUserMessage(
      text || (imageUrls.length ? '（仅发送图片）' : ''),
      imageUrls,
      requestTimeText,
    );
    assistantMsg = appendAssistantMessage(requestTimeText, selectedModel);

    const response = await fetch(buildRequestUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }
    if (!response.body) {
      throw new Error('后端未返回可读的流。');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        processStreamLine(line, assistantMsg, usageHolder);
      }
    }

    if (buffer.trim()) {
      processStreamLine(buffer, assistantMsg, usageHolder);
    }

    const duration = Math.round(performance.now() - startTime);
    statusTime.textContent = `耗时：${duration} ms`;
    setStatusResult('请求成功', true);
    updateAssistantMetadata(
      assistantMsg?.metaLine,
      requestTimeText,
      duration,
      usageHolder.data,
      selectedModel,
      '完成',
    );
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    statusTime.textContent = `耗时：${duration} ms`;
    if (error.name === 'AbortError') {
      setStatusResult('已停止', null);
      updateAssistantMetadata(
        assistantMsg?.metaLine,
        requestTimeText,
        duration,
        usageHolder.data,
        selectedModel,
        '已停止',
      );
    } else {
      setStatusResult('请求失败', false);
      updateAssistantMetadata(
        assistantMsg?.metaLine,
        requestTimeText,
        duration,
        usageHolder.data,
        selectedModel,
        '错误',
      );
      appendSystemMessage(error.message || '未知错误');
      console.error(error);
    }
  } finally {
    if (currentController === controller) {
      currentController = null;
      updateButtonsDuringRequest(false);
    }
  }
}

// 构造完整 payload，包含基础参数及实验性的思考开关
function buildPayload(messages, modelName) {
  const payload = {
    model: modelName,
    messages,
    stream: true,
  };

  const temperature = parseFloat(temperatureInput.value);
  if (!Number.isNaN(temperature)) {
    payload.temperature = temperature;
  }

  const maxTokens = parseInt(maxTokensInput.value, 10);
  if (!Number.isNaN(maxTokens)) {
    payload.max_tokens = maxTokens;
  }

  return payload;
}

// 按 OpenAI 多模态标准构建 messages：图片 content 段在前，文本在后
function buildMessages(systemText, text, imageUrls) {
  const messages = [];
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  const contents = [];
  // 将 imageList 中的 URL 转成 image_url 片段，保持顺序
  imageUrls.forEach((url) => {
    contents.push({
      type: 'image_url',
      image_url: { url },
    });
  });

  if (text) {
    contents.push({ type: 'text', text });
  }

  if (!contents.length) {
    throw new Error('缺少可发送的文本或图片内容');
  }

  messages.push({ role: 'user', content: contents });
  return messages;
}

// 读取文件并转为 data URL
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

// 请求地址统一处理一下，避免重复斜杠
function buildRequestUrl() {
  let base = backendInput.value.trim();
  if (!base) {
    base = 'http://192.168.1.61:8000';
  }
  if (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  return `${base}/v1/chat/completions`;
}

// 渲染左侧调试区的图片预览，配合 imageList 数组展示和删除
function renderImagePreview() {
  imagePreview.innerHTML = '';
  if (!selectedImages.length) {
    imagePreview.style.display = 'none';
    return;
  }
  imagePreview.style.display = 'grid';
  selectedImages.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    const img = document.createElement('img');
    img.src = item.dataUrl;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeImageAt(index));
    card.appendChild(img);
    card.appendChild(removeBtn);
    imagePreview.appendChild(card);
  });
}

// 删除缩略图时同步 imageList，并刷新 UI
function removeImageAt(index) {
  selectedImages.splice(index, 1);
  renderImagePreview();
}

// 在聊天区域添加一条用户消息气泡
function appendUserMessage(text, imageDataUrls, timeText) {
  const row = document.createElement('div');
  row.className = 'message-row';

  const bubble = document.createElement('div');
  bubble.className = 'bubble user';
  bubble.textContent = text;

  if (Array.isArray(imageDataUrls) && imageDataUrls.length) {
    const grid = document.createElement('div');
    grid.className = 'preview-grid';
    grid.style.display = 'grid';
    imageDataUrls.forEach((url) => {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'chat-img';
      grid.appendChild(img);
    });
    bubble.appendChild(grid);
  }

  const meta = document.createElement('div');
  meta.className = 'meta-info meta-user';
  meta.textContent = `时间：${timeText}`;
  bubble.appendChild(meta);

  row.appendChild(bubble);
  chatArea.appendChild(row);
  autoScroll();
  return bubble;
}

// 添加系统提示或错误信息
function appendSystemMessage(text) {
  const row = document.createElement('div');
  row.className = 'message-row';

  const bubble = document.createElement('div');
  bubble.className = 'bubble system';
  bubble.textContent = text;

  row.appendChild(bubble);
  chatArea.appendChild(row);
  autoScroll();
  return bubble;
}

// 为 assistant 创建一个容器，用于放置思考区和正式回答区
function appendAssistantMessage(timeText, modelName) {
  const row = document.createElement('div');
  row.className = 'message-row';

  const container = document.createElement('div');
  container.className = 'assistant-container';

  const thoughtBlock = document.createElement('div');
  thoughtBlock.className = 'thought-block';
  thoughtBlock.style.display = 'none';

  const thoughtTag = document.createElement('div');
  thoughtTag.className = 'tag';
  thoughtTag.textContent = '思考中';

  const thoughtContent = document.createElement('div');
  thoughtBlock.appendChild(thoughtTag);
  thoughtBlock.appendChild(thoughtContent);

  const answerBubble = document.createElement('div');
  answerBubble.className = 'bubble assistant';

  const metaLine = document.createElement('div');
  metaLine.className = 'meta-info meta-assistant';
  metaLine.textContent = `时间：${timeText} ｜ 模型：${modelName}`;

  container.appendChild(thoughtBlock);
  container.appendChild(answerBubble);
  container.appendChild(metaLine);
  row.appendChild(container);
  chatArea.appendChild(row);
  autoScroll();

  return { thoughtBlock, thoughtContent, answerContent: answerBubble, metaLine };
}

// 逐行处理流式分片，区分思考和正式回答
function processStreamLine(line, assistantNodes, usageHolder) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    console.warn('忽略无法解析的分片', trimmed);
    return;
  }

  const { thoughtText, answerText } = extractMessageParts(parsed);
  if (thoughtText) {
    assistantNodes.thoughtContent.textContent += thoughtText;
    assistantNodes.thoughtBlock.style.display = 'block';
  }
  if (answerText) {
    assistantNodes.answerContent.textContent += answerText;
  }
  if (parsed.usage) {
    usageHolder.data = parsed.usage;
  } else if (Array.isArray(parsed.choices)) {
    parsed.choices.forEach((choice) => {
      if (choice?.usage) {
        usageHolder.data = choice.usage;
      }
    });
  }
  autoScroll();
}

// 从 JSON 分片中提取思考/回答文字
function extractMessageParts(chunk) {
  let thoughtText = '';
  let answerText = '';

  const collectThought = (obj) => {
    if (!obj) return;
    ['thinking', 'thought', 'reasoning'].forEach((field) => {
      if (obj[field] !== undefined) {
        thoughtText += normalizeContent(obj[field]);
      }
    });
  };

  const collectAnswer = (content) => {
    if (content !== undefined) {
      answerText += normalizeContent(content);
    }
  };

  if (chunk.message) {
    collectThought(chunk.message);
    collectAnswer(chunk.message.content);
  }

  if (Array.isArray(chunk.choices)) {
    chunk.choices.forEach((choice) => {
      if (choice.delta) {
        collectThought(choice.delta);
        collectAnswer(choice.delta.content);
      }
      if (choice.message) {
        collectThought(choice.message);
        collectAnswer(choice.message.content);
      }
    });
  }

  collectThought(chunk);
  collectAnswer(chunk.content);

  return { thoughtText, answerText };
}

// 将 content 兼容字符串 / 数组 / 对象格式
function normalizeContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.text) return item.text;
        return '';
      })
      .join('');
  }

  if (typeof content === 'object' && content !== null) {
    if (content.text) {
      return content.text;
    }
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  return '';
}

// 更新 assistant 元信息（时间 / 耗时 / 模型 / token / 状态）
function updateAssistantMetadata(metaEl, timeText, durationMs, usage, modelName, statusText) {
  if (!metaEl) return;
  let text = `时间：${timeText}`;
  text += ` ｜ 用时：${formatDuration(durationMs)}`;
  if (modelName) {
    text += ` ｜ 模型：${modelName}`;
  }
  const usageText = formatUsage(usage);
  if (usageText) {
    text += ` ｜ ${usageText}`;
  }
  if (statusText) {
    text += ` ｜ 状态：${statusText}`;
  }
  metaEl.textContent = text;
}

// 格式化时间戳，显示 YYYY-MM-DD HH:mm:ss
function formatTimestamp(dateObj) {
  const pad = (num) => String(num).padStart(2, '0');
  const year = dateObj.getFullYear();
  const month = pad(dateObj.getMonth() + 1);
  const day = pad(dateObj.getDate());
  const hour = pad(dateObj.getHours());
  const minute = pad(dateObj.getMinutes());
  const second = pad(dateObj.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// 将耗时转换为 s/ms 文本
function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return '-';
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(2)} s`;
  }
  return `${durationMs} ms`;
}

// 根据 usage 数据生成 token 描述
function formatUsage(usage) {
  if (!usage) return '';
  const total = usage.total_tokens;
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  if (total === undefined && prompt === undefined && completion === undefined) {
    return '';
  }

  let text = 'Tokens：';
  if (total !== undefined) {
    text += `total ${total}`;
  }
  const details = [];
  if (prompt !== undefined) {
    details.push(`prompt ${prompt}`);
  }
  if (completion !== undefined) {
    details.push(`completion ${completion}`);
  }
  if (details.length) {
    text += `（${details.join(' / ')}）`;
  }
  return text;
}

// 状态栏提示颜色切换
function setStatusResult(text, successFlag) {
  statusResult.textContent = text;
  if (successFlag === null) {
    statusResult.style.color = '#1f2937';
  } else if (successFlag) {
    statusResult.style.color = '#0a7d32';
  } else {
    statusResult.style.color = '#c0392b';
  }
}

// 保持聊天区域滚动到底部，方便查看最新流式内容
function autoScroll() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

// 控制发送按钮的启用状态，避免重复提交
function updateButtonsDuringRequest(inProgress) {
  sendBtn.disabled = inProgress;
}

// 聊天内容图片点击查看大图
document.addEventListener('click', (event) => {
  const target = event.target;
  if (target.tagName === 'IMG' && target.classList.contains('chat-img')) {
    if (!imgViewerOverlay || !imgViewerImg) return;
    imgViewerImg.src = target.src;
    imgViewerOverlay.style.display = 'flex';
  }
});

if (imgViewerClose) {
  imgViewerClose.addEventListener('click', () => {
    imgViewerOverlay.style.display = 'none';
    imgViewerImg.src = '';
  });
}
