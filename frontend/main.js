// 预定义模型列表，后续可以替换为后端接口返回
const DEFAULT_MODELS = [
  'qwen3:30b',
  'qwen-vl',
  'qwen2:7b',
  'llama3.1',
  'glm-4',
];

// 获取调试区和内容区的各类元素
const backendInput = document.getElementById('backend-input');
const modelSelect = document.getElementById('model-select');
const systemInput = document.getElementById('system-input');
const temperatureInput = document.getElementById('temperature-input');
const maxTokensInput = document.getElementById('max-tokens-input');
const thinkingToggle = document.getElementById('thinking-toggle');
const promptInput = document.getElementById('prompt-input');
const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const sendBtn = document.getElementById('send-btn');
const chatArea = document.getElementById('chat-area');
const statusTime = document.getElementById('status-time');
const statusResult = document.getElementById('status-result');

initModelSelect();

// 注册文件选择预览逻辑，方便查看缩略图
imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) {
    imagePreview.style.display = 'none';
    imagePreview.src = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    imagePreview.src = event.target.result;
    imagePreview.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

// 点击发送后处理一次完整的多模态请求
sendBtn.addEventListener('click', () => {
  handleSend().catch((err) => console.error('发送失败', err));
});

// 初始化模型下拉框，后续可改为 fetch 后端接口
function initModelSelect() {
  modelSelect.innerHTML = '';
  DEFAULT_MODELS.forEach((model) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  });
  modelSelect.value = DEFAULT_MODELS[0];
}

// 处理发送逻辑：读取输入、构造 payload、流式解析响应
async function handleSend() {
  const text = promptInput.value.trim();
  const imageFile = imageInput.files[0];
  if (!text && !imageFile) {
    alert('请输入提示词或选择一张图片。');
    return;
  }

  sendBtn.disabled = true;
  setStatusResult('请求进行中...', null);
  const startTime = performance.now();

  try {
    const imageDataUrl = imageFile ? await readFileAsDataURL(imageFile) : null;
    const messages = buildMessages(systemInput.value.trim(), text, imageDataUrl);
    const payload = buildPayload(messages);

    const userMsg = appendUserMessage(text || (imageDataUrl ? '（仅发送图片）' : ''), imageDataUrl);
    const assistantMsg = appendAssistantMessage();

    const response = await fetch(buildRequestUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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
        processStreamLine(line, assistantMsg);
      }
    }

    if (buffer.trim()) {
      processStreamLine(buffer, assistantMsg);
    }

    const duration = Math.round(performance.now() - startTime);
    statusTime.textContent = `耗时：${duration} ms`;
    setStatusResult('请求成功', true);
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    statusTime.textContent = `耗时：${duration} ms`;
    setStatusResult('请求失败', false);
    appendSystemMessage(error.message || '未知错误');
    console.error(error);
  } finally {
    sendBtn.disabled = false;
  }
}

// 构造完整 payload，包含基础参数及实验性的思考开关
function buildPayload(messages) {
  const payload = {
    model: modelSelect.value,
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

  payload.thinking_enabled = thinkingToggle.checked;
  return payload;
}

// 根据 system / 文本 / 图片组合构建 messages 数组
function buildMessages(systemText, text, imageDataUrl) {
  const messages = [];
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  if (imageDataUrl) {
    const contentParts = [];
    if (text) {
      contentParts.push({ type: 'text', text });
    }
    contentParts.push({ type: 'image_url', image_url: imageDataUrl });
    messages.push({ role: 'user', content: contentParts });
  } else {
    messages.push({ role: 'user', content: text });
  }

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
    base = 'http://10.10.10.61:8000';
  }
  if (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  return `${base}/v1/chat/completions`;
}

// 在聊天区域添加一条用户消息气泡
function appendUserMessage(text, imageDataUrl) {
  const row = document.createElement('div');
  row.className = 'message-row';

  const bubble = document.createElement('div');
  bubble.className = 'bubble user';
  bubble.textContent = text;

  if (imageDataUrl) {
    const img = document.createElement('img');
    img.src = imageDataUrl;
    img.style.maxWidth = '160px';
    img.style.display = 'block';
    img.style.marginTop = '8px';
    bubble.appendChild(img);
  }

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
function appendAssistantMessage() {
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

  container.appendChild(thoughtBlock);
  container.appendChild(answerBubble);
  row.appendChild(container);
  chatArea.appendChild(row);
  autoScroll();

  return { thoughtBlock, thoughtContent, answerContent: answerBubble };
}

// 逐行处理流式分片，区分思考和正式回答
function processStreamLine(line, assistantNodes) {
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
