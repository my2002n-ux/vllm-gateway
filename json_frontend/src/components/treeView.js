const TYPE_CLASS = {
  string: 'type-string',
  number: 'type-number',
  boolean: 'type-boolean',
  null: 'type-null',
  object: 'type-object',
  array: 'type-array',
};

function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formatPrimitive(value) {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null) return 'null';
  return String(value);
}

function buildPath(base, key, isIndex) {
  if (!base) {
    return isIndex ? `[${key}]` : key;
  }
  return isIndex ? `${base}[${key}]` : `${base}.${key}`;
}

function createToggleButton(isExpanded) {
  const btn = document.createElement('button');
  btn.className = 'tree-toggle';
  btn.type = 'button';
  btn.textContent = isExpanded ? '▾' : '▸';
  return btn;
}

function buildNode({ keyLabel, value, path, depth, onSelect, defaultDepth }) {
  const type = getType(value);
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.path = path;
  li.dataset.key = keyLabel || '';
  let matchValue = '';
  if (type !== 'object' && type !== 'array') {
    matchValue = value === null ? 'null' : String(value);
  }
  li.dataset.value = matchValue;

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${depth * 14}px`;

  const isBranch = type === 'object' || type === 'array';
  if (isBranch) {
    row.classList.add('is-branch');
  }
  const toggle = createToggleButton(true);
  toggle.disabled = !isBranch;
  row.appendChild(toggle);

  const label = document.createElement('div');
  label.className = 'tree-label';
  label.dataset.path = path;
  label.innerHTML = '';

  const keySpan = document.createElement('span');
  keySpan.className = 'tree-key';
  if (!keyLabel) {
    keySpan.textContent = '(root)';
  } else if (String(keyLabel).startsWith('[')) {
    keySpan.textContent = `${keyLabel}:`;
  } else {
    keySpan.textContent = `"${keyLabel}":`;
  }

  const valueSpan = document.createElement('span');
  valueSpan.className = `tree-value ${TYPE_CLASS[type] || ''}`.trim();
  if (isBranch) {
    const size = type === 'array' ? value.length : Object.keys(value).length;
    valueSpan.textContent = type === 'array' ? `Array(${size})` : `Object(${size})`;
  } else {
    valueSpan.textContent = formatPrimitive(value);
  }

  label.appendChild(keySpan);
  label.appendChild(valueSpan);
  row.appendChild(label);
  li.appendChild(row);

  let childrenContainer = null;
  if (isBranch) {
    childrenContainer = document.createElement('ul');
    childrenContainer.className = 'tree-children';
    if (depth >= defaultDepth) {
      childrenContainer.classList.add('is-collapsed');
      toggle.textContent = '▸';
    }
    const entries = type === 'array'
      ? value.map((item, index) => [index, item, true])
      : Object.keys(value).map((childKey) => [childKey, value[childKey], false]);
    entries.forEach(([childKey, childValue, isIndex]) => {
      const childPath = buildPath(path, childKey, isIndex);
      const childNode = buildNode({
        keyLabel: isIndex ? `[${childKey}]` : childKey,
        value: childValue,
        path: childPath,
        depth: depth + 1,
        onSelect,
        defaultDepth,
      });
      childrenContainer.appendChild(childNode);
    });
    li.appendChild(childrenContainer);
  }

  function toggleBranch(event) {
    if (!childrenContainer) return;
    if (event) {
      const selection = window.getSelection();
      if (selection && selection.toString()) {
        return;
      }
    }
    const collapsed = childrenContainer.classList.toggle('is-collapsed');
    toggle.textContent = collapsed ? '▸' : '▾';
  }

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleBranch();
  });

  label.addEventListener('click', (event) => {
    if (!isBranch) return;
    if (event.target.closest('.tree-toggle')) return;
    toggleBranch(event);
  });

  return li;
}

export function createTreeView({ onSelect }) {
  const container = document.createElement('div');
  container.className = 'tree-view';

  const list = document.createElement('ul');
  list.className = 'tree-root';
  container.appendChild(list);

  let data = null;
  let defaultDepth = 3;

  function render(nextData) {
    data = nextData;
    list.innerHTML = '';
    if (data === undefined || data === null) {
      return;
    }
    const rootNode = buildNode({
      keyLabel: '',
      value: data,
      path: '',
      depth: 0,
      onSelect,
      defaultDepth,
    });
    list.appendChild(rootNode);
  }

  function setCollapse(collapsed) {
    const containers = list.querySelectorAll('.tree-children');
    containers.forEach((node) => {
      if (collapsed) {
        node.classList.add('is-collapsed');
      } else {
        node.classList.remove('is-collapsed');
      }
    });
    const toggles = list.querySelectorAll('.tree-toggle');
    toggles.forEach((toggle) => {
      if (toggle.disabled) return;
      toggle.textContent = collapsed ? '▸' : '▾';
    });
  }

  function clearHighlights() {
    list.querySelectorAll('.is-match').forEach((node) => node.classList.remove('is-match'));
    list.querySelectorAll('.is-active').forEach((node) => node.classList.remove('is-active'));
  }

  function applySearch(term) {
    clearHighlights();
    const matches = [];
    if (!term) return matches;
    list.querySelectorAll('.tree-node').forEach((node) => {
      const key = node.dataset.key || '';
      const value = node.dataset.value || '';
      if (key === term || value === term) {
        node.classList.add('is-match');
        matches.push(node);
      }
    });
    return matches;
  }

  function expandToNode(node) {
    let current = node;
    while (current) {
      const parentList = current.parentElement;
      if (parentList && parentList.classList.contains('tree-children')) {
        parentList.classList.remove('is-collapsed');
        const parentNode = parentList.closest('.tree-node');
        if (parentNode) {
          const toggle = parentNode.querySelector('.tree-toggle');
          if (toggle && !toggle.disabled) {
            toggle.textContent = '▾';
          }
        }
      }
      current = current.parentElement?.closest('.tree-node');
    }
  }

  function focusMatch(node) {
    if (!node) return;
    expandToNode(node);
    node.classList.add('is-active');
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  return {
    el: container,
    render,
    expandAll: () => setCollapse(false),
    collapseAll: () => setCollapse(true),
    applySearch,
    clearHighlights,
    focusMatch,
    resetToDefaultDepth: (depth) => {
      defaultDepth = depth;
      render(data);
    },
  };
}
