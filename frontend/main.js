// 获取页面元素引用
const backendInput = document.getElementById('backend-input');
const modelInput = document.getElementById('model-input');
const promptInput = document.getElementById('prompt-input');
const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const sendBtn = document.getElementById('send-btn');
const chatArea = document.getElementById('chat-area');
const statusTime = document.getElementById('status-time');
const statusResult = document.getElementById('status-result');

// 预览图片，用户可确认是否选对
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

// 监听发送按钮
sendBtn.addEventListener('click', () => {
  handleSend().catch((err) => console.error('发送失败', err));
});

// 构造并发送请求
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
    const messages = buildMessages(text, imageDataUrl);
    const payload = {
      model: modelInput.value.trim() || 'qwen3:30b',
      messages,
      stream: true,
    };

    // 先把用户消息渲染出来
    const userMsg = appendMessage('user', text || (imageDataUrl ? '（仅发送图片）' : ''));
    if (imageDataUrl) {
      const img = document.createElement('img');
      img.src = imageDataUrl;
      img.style.maxWidth = '120px';
      img.style.display = 'block';
      img.style.marginTop = '6px';
      userMsg.content.appendChild(img);
    }

    // 预先插入一条空的 assistant 消息，后续 chunk 会写入
    const assistantMsg = appendMessage('assistant', '');

    const url = buildRequestUrl();
    const response = await fetch(url, {
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
        processStreamLine(line, assistantMsg.content);
      }
    }

    if (buffer.trim()) {
      processStreamLine(buffer, assistantMsg.content);
    }

    const duration = Math.round(performance.now() - startTime);
    statusTime.textContent = `耗时：${duration} ms`;
    setStatusResult('请求成功', true);
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    statusTime.textContent = `耗时：${duration} ms`;
    setStatusResult('请求失败', false);
    appendMessage('system', error.message || '未知错误');
    console.error(error);
  } finally {
    sendBtn.disabled = false;
  }
}

// 根据用户输入构建 messages
function buildMessages(text, imageDataUrl) {
  if (imageDataUrl) {
    const contentParts = [];
    if (text) {
      contentParts.push({ type: 'text', text });
    }
    contentParts.push({ type: 'image_url', image_url: imageDataUrl });
    return [
      {
        role: 'user',
        content: contentParts,
      },
    ];
  }

  return [
    {
      role: 'user',
      content: text,
    },
  ];
}

// 读取文件并转成 data url，供 image_url 使用
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

// 统一拼装请求地址
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

// 在对话区域追加一条消息，返回内容节点方便后续追加
function appendMessage(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const roleTag = document.createElement('strong');
  roleTag.textContent = role;
  roleTag.style.display = 'block';
  roleTag.style.marginBottom = '4px';

  const content = document.createElement('div');
  content.className = 'message-content';
  if (text) {
    content.textContent = text;
  }

  wrapper.appendChild(roleTag);
  wrapper.appendChild(content);
  chatArea.appendChild(wrapper);
  chatArea.scrollTop = chatArea.scrollHeight;

  return { wrapper, content };
}

// 处理单行流式分片
function processStreamLine(line, contentEl) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    console.warn('忽略无法解析的分片', trimmed);
    return;
  }

  const text = extractMessageText(parsed);
  if (text) {
    contentEl.textContent += text;
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}

// 根据不同返回格式提取文本
function extractMessageText(chunk) {
  if (!chunk) return '';

  if (chunk.message && chunk.message.content !== undefined) {
    return normalizeContent(chunk.message.content);
  }

  if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
    const choice = chunk.choices[0];
    if (choice?.delta?.content !== undefined) {
      return normalizeContent(choice.delta.content);
    }
    if (choice?.message?.content !== undefined) {
      return normalizeContent(choice.message.content);
    }
  }

  return '';
}

// 把 content 兼容数组/字符串两种情况
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

  if (typeof content === 'string') {
    return content;
  }

  return '';
}

// 更新状态栏文字颜色
function setStatusResult(text, successFlag) {
  statusResult.textContent = text;
  if (successFlag === null) {
    statusResult.style.color = '#333';
  } else if (successFlag) {
    statusResult.style.color = '#0a7d32';
  } else {
    statusResult.style.color = '#c0392b';
  }
}
