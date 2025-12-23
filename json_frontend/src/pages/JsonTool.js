import { createTreeView } from '../components/treeView.js';
import {
  parseJsonWithDetails,
  formatJson,
  minifyJson,
  computeStats,
  deleteKeysFromJson,
} from '../utils/jsonOps.js';

function createSectionTitle(text) {
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = text;
  return title;
}

function createButton(text, className = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  if (className) btn.className = className;
  return btn;
}

function createInput(placeholder = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  return input;
}

function createLabel(text) {
  const label = document.createElement('div');
  label.className = 'field-label';
  label.textContent = text;
  return label;
}

function copyText(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => {});
}

export function createJsonToolPage() {
  const container = document.createElement('div');
  container.className = 'page';

  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  container.appendChild(workspace);

  const layout = document.createElement('div');
  layout.className = 'layout';
  workspace.appendChild(layout);

  const leftPanel = document.createElement('section');
  leftPanel.className = 'panel left-panel';
  layout.appendChild(leftPanel);

  const rightPanel = document.createElement('section');
  rightPanel.className = 'panel right-panel';
  layout.appendChild(rightPanel);

  // Left: combined card
  const leftHeader = document.createElement('div');
  leftHeader.className = 'panel-header';
  leftPanel.appendChild(leftHeader);
  const homeLink = document.createElement('a');
  homeLink.className = 'home-link';
  homeLink.href = '/';
  homeLink.textContent = '< 返回';
  leftHeader.appendChild(homeLink);

  const rightHeader = document.createElement('div');
  rightHeader.className = 'panel-header';
  const rightSpacer = document.createElement('div');
  rightSpacer.className = 'home-link home-spacer';
  rightSpacer.setAttribute('aria-hidden', 'true');
  rightHeader.appendChild(rightSpacer);
  rightPanel.appendChild(rightHeader);

  const leftCard = document.createElement('div');
  leftCard.className = 'card left-card';
  leftPanel.appendChild(leftCard);

  const leftBody = document.createElement('div');
  leftBody.className = 'card-body';
  leftCard.appendChild(leftBody);

  const inputActions = document.createElement('div');
  inputActions.className = 'row input-actions';
  const inputActionsLeft = document.createElement('div');
  inputActionsLeft.className = 'row';
  const inputActionsRight = document.createElement('div');
  inputActionsRight.className = 'row';
  const formatButton = createButton('格式化');
  const minifyButton = createButton('单行');
  const clearButton = createButton('清空');
  formatButton.classList.add('btn-secondary');
  minifyButton.classList.add('btn-secondary');
  clearButton.classList.add('btn-secondary');
  inputActionsLeft.appendChild(formatButton);
  inputActionsRight.appendChild(minifyButton);
  inputActionsRight.appendChild(clearButton);
  inputActions.appendChild(inputActionsLeft);
  inputActions.appendChild(inputActionsRight);
  leftBody.appendChild(inputActions);

  const rawTextarea = document.createElement('textarea');
  rawTextarea.className = 'textarea';
  rawTextarea.placeholder = '{ "hello": "world" }';
  leftBody.appendChild(rawTextarea);

  const parseStatus = document.createElement('div');
  parseStatus.className = 'status';
  parseStatus.textContent = '待解析';
  leftBody.appendChild(parseStatus);

  const errorMessage = document.createElement('div');
  errorMessage.className = 'error-message';
  leftBody.appendChild(errorMessage);

  const deleteGroup = document.createElement('div');
  deleteGroup.className = 'group';
  const deleteHeader = document.createElement('div');
  deleteHeader.className = 'field-head';
  const deleteLabel = createLabel('删除 Key');
  const deleteMeta = document.createElement('div');
  deleteMeta.className = 'meta';
  deleteMeta.textContent = '命中：0';
  deleteHeader.appendChild(deleteLabel);
  deleteHeader.appendChild(deleteMeta);
  deleteGroup.appendChild(deleteHeader);

  const deleteRow = document.createElement('div');
  deleteRow.className = 'row field-row';
  const deleteInput = createInput('输入要删除的 key（逗号分隔）');
  deleteInput.className = 'text-input tall';
  deleteRow.appendChild(deleteInput);
  deleteGroup.appendChild(deleteRow);

  const parseButton = createButton('JSON解析', 'primary');
  const parseRow = document.createElement('div');
  parseRow.className = 'row parse-row';
  parseRow.appendChild(parseButton);
  deleteGroup.appendChild(parseRow);

  leftBody.appendChild(deleteGroup);

  // Right: result
  const resultCard = document.createElement('div');
  resultCard.className = 'card result-card';
  rightPanel.appendChild(resultCard);

  const resultBody = document.createElement('div');
  resultBody.className = 'card-body';
  resultCard.appendChild(resultBody);

  const resultHeader = document.createElement('div');
  resultHeader.className = 'row result-header';
  const treeActions = document.createElement('div');
  treeActions.className = 'row';
  const defaultButton = createButton('默认');
  const expandButton = createButton('全展');
  const collapseButton = createButton('全收');
  defaultButton.classList.add('btn-secondary');
  expandButton.classList.add('btn-secondary');
  collapseButton.classList.add('btn-secondary');
  treeActions.appendChild(defaultButton);
  treeActions.appendChild(expandButton);
  treeActions.appendChild(collapseButton);
  const searchGroup = document.createElement('div');
  searchGroup.className = 'row search-group';
  const searchField = document.createElement('div');
  searchField.className = 'search-field';
  const searchInput = createInput('搜索 key / 值');
  searchInput.className = 'text-input search-input';
  const searchClearButton = document.createElement('button');
  searchClearButton.type = 'button';
  searchClearButton.className = 'search-clear';
  searchClearButton.textContent = '×';
  searchClearButton.disabled = true;
  const prevButton = createButton('上一个');
  const nextButton = createButton('下一个');
  prevButton.classList.add('btn-secondary');
  nextButton.classList.add('btn-secondary');
  const searchMeta = document.createElement('div');
  searchMeta.className = 'meta';
  searchMeta.textContent = '0/0';
  searchField.appendChild(searchInput);
  searchField.appendChild(searchClearButton);
  searchGroup.appendChild(searchField);
  searchGroup.appendChild(prevButton);
  searchGroup.appendChild(nextButton);
  searchGroup.appendChild(searchMeta);
  resultHeader.appendChild(treeActions);
  resultHeader.appendChild(searchGroup);
  resultBody.appendChild(resultHeader);

  const treeContainer = document.createElement('div');
  treeContainer.className = 'tree-container';
  resultBody.appendChild(treeContainer);

  const treeView = createTreeView({
    onSelect: null,
  });
  treeContainer.appendChild(treeView.el);

  const resultFooter = document.createElement('div');
  resultFooter.className = 'row result-footer';
  const statsLabel = document.createElement('div');
  statsLabel.className = 'meta';
  statsLabel.textContent = 'key 数：0 · 最大层级：0';
  const textActions = document.createElement('div');
  textActions.className = 'row';
  const copyResultButton = createButton('复制结果');
  const downloadButton = createButton('下载 result.json');
  copyResultButton.classList.add('btn-secondary');
  downloadButton.classList.add('btn-secondary');
  textActions.appendChild(copyResultButton);
  textActions.appendChild(downloadButton);
  resultFooter.appendChild(statsLabel);
  resultFooter.appendChild(textActions);
  resultBody.appendChild(resultFooter);

  const state = {
    parsed: null,
    result: null,
    lastValid: null,
    matches: [],
    activeMatchIndex: -1,
  };

  function setStatus(message, ok) {
    parseStatus.textContent = message;
    parseStatus.classList.toggle('ok', ok === true);
    parseStatus.classList.toggle('fail', ok === false);
  }

  function showError(error) {
    if (!error) {
      errorMessage.textContent = '';
      return;
    }
    if (error.line && error.column) {
      errorMessage.textContent = `位置：行 ${error.line}, 列 ${error.column}`;
    } else {
      errorMessage.textContent = '';
    }
  }

  function updateStats(data) {
    if (!data) {
      statsLabel.textContent = 'key 数：0 · 最大层级：0';
      return;
    }
    const stats = computeStats(data);
    statsLabel.textContent = `key 数：${stats.keyCount} · 最大层级：${stats.maxDepth}`;
  }

  function updateResultView(data) {
    if (!data) {
      treeView.render(null);
      updateStats(null);
      return;
    }
    treeView.render(data);
    updateStats(data);
    if (searchInput.value.trim()) {
      applySearch();
    } else {
      treeView.clearHighlights();
      state.matches = [];
      state.activeMatchIndex = -1;
      updateSearchMeta();
      searchClearButton.disabled = true;
    }
  }

  function updateSearchMeta() {
    const total = state.matches.length;
    const current = state.activeMatchIndex >= 0 ? state.activeMatchIndex + 1 : 0;
    searchMeta.textContent = `${current}/${total}`;
  }

  function applySearch() {
    const term = searchInput.value.trim();
    searchClearButton.disabled = !term;
    state.matches = treeView.applySearch(term);
    state.activeMatchIndex = -1;
    updateSearchMeta();
  }

  function focusActiveMatch() {
    treeView.el.querySelectorAll('.is-active').forEach((node) => node.classList.remove('is-active'));
    if (state.activeMatchIndex < 0 || state.matches.length === 0) {
      updateSearchMeta();
      return;
    }
    const target = state.matches[state.activeMatchIndex];
    treeView.focusMatch(target);
    updateSearchMeta();
  }

  function processJson(parsed) {
    let working = structuredClone(parsed);
    const deleteKeys = deleteInput.value.split(',');

    const deletion = deleteKeysFromJson(working, {
      keys: deleteKeys,
      previewLimit: 8,
    });
    working = deletion.value;
    deleteMeta.textContent = `命中：${deletion.hitCount}`;

    return working;
  }

  function parseAndRefresh() {
    const raw = rawTextarea.value.trim();
    if (!raw) {
      state.parsed = null;
      state.result = null;
      state.lastValid = null;
      setStatus('待解析', null);
      showError(null);
      updateResultView(null);
      deleteMeta.textContent = '命中：0';
      return;
    }

    const { data, error } = parseJsonWithDetails(raw);
    if (error) {
      setStatus(`解析失败：${error.message}`, false);
      showError(error);
      if (state.lastValid) {
        updateResultView(state.lastValid);
      } else {
        updateResultView(null);
      }
      return;
    }

    setStatus('解析成功', true);
    showError(null);
    state.parsed = data;
    const processed = processJson(data);
    state.result = processed;
    state.lastValid = processed;
    updateResultView(processed);
  }

  parseButton.addEventListener('click', parseAndRefresh);

  formatButton.addEventListener('click', () => {
    const { data, error } = parseJsonWithDetails(rawTextarea.value.trim());
    if (error) {
      setStatus(`解析失败：${error.message}`, false);
      showError(error);
      return;
    }
    rawTextarea.value = formatJson(data);
    setStatus('格式化完成', true);
    showError(null);
  });

  minifyButton.addEventListener('click', () => {
    const { data, error } = parseJsonWithDetails(rawTextarea.value.trim());
    if (error) {
      setStatus(`解析失败：${error.message}`, false);
      showError(error);
      return;
    }
    rawTextarea.value = minifyJson(data);
    setStatus('单行完成', true);
    showError(null);
  });

  clearButton.addEventListener('click', () => {
    rawTextarea.value = '';
    setStatus('已清空', null);
    showError(null);
    updateResultView(null);
  });

  searchInput.addEventListener('input', () => {
    if (!searchInput.value.trim()) {
      state.matches = [];
      state.activeMatchIndex = -1;
      treeView.clearHighlights();
      updateSearchMeta();
      searchClearButton.disabled = true;
      return;
    }
    searchClearButton.disabled = false;
    applySearch();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!state.matches.length) {
      applySearch();
      if (!state.matches.length) return;
    }
    if (state.activeMatchIndex < 0) {
      state.activeMatchIndex = 0;
    } else {
      state.activeMatchIndex = (state.activeMatchIndex + 1) % state.matches.length;
    }
    focusActiveMatch();
  });

  prevButton.addEventListener('click', () => {
    if (!state.matches.length) {
      applySearch();
      if (!state.matches.length) return;
    }
    if (state.activeMatchIndex < 0) {
      state.activeMatchIndex = state.matches.length - 1;
    } else {
      state.activeMatchIndex =
        (state.activeMatchIndex - 1 + state.matches.length) % state.matches.length;
    }
    focusActiveMatch();
  });

  nextButton.addEventListener('click', () => {
    if (!state.matches.length) {
      applySearch();
      if (!state.matches.length) return;
    }
    if (state.activeMatchIndex < 0) {
      state.activeMatchIndex = 0;
    } else {
      state.activeMatchIndex = (state.activeMatchIndex + 1) % state.matches.length;
    }
    focusActiveMatch();
  });

  searchClearButton.addEventListener('click', () => {
    searchInput.value = '';
    state.matches = [];
    state.activeMatchIndex = -1;
    treeView.clearHighlights();
    updateSearchMeta();
    searchClearButton.disabled = true;
    searchInput.focus();
  });

  defaultButton.addEventListener('click', () => {
    treeView.resetToDefaultDepth(3);
    if (searchInput.value.trim()) {
      applySearch();
    }
  });

  expandButton.addEventListener('click', () => {
    treeView.expandAll();
  });
  collapseButton.addEventListener('click', () => {
    treeView.collapseAll();
  });

  copyResultButton.addEventListener('click', () => {
    if (!state.result) return;
    copyText(formatJson(state.result));
  });

  downloadButton.addEventListener('click', () => {
    if (!state.result) return;
    const blob = new Blob([formatJson(state.result)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'result.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });
  requestAnimationFrame(() => {
    console.log('leftCol height', leftPanel.offsetHeight);
    console.log('rightCol height', rightPanel.offsetHeight);
  });
  return container;
}
