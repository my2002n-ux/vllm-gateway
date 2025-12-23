const POSITION_RE = /position\s+(\d+)/i;

export function parseJsonWithDetails(text) {
  try {
    const data = JSON.parse(text);
    return { data, error: null };
  } catch (err) {
    const message = err && err.message ? String(err.message) : '解析失败';
    const match = message.match(POSITION_RE);
    let position = null;
    if (match) {
      position = Number(match[1]);
    }
    let line = null;
    let column = null;
    if (position !== null && Number.isFinite(position)) {
      const upTo = text.slice(0, position);
      const lines = upTo.split('\n');
      line = lines.length;
      column = lines[lines.length - 1].length + 1;
    }
    return {
      data: null,
      error: {
        message,
        position,
        line,
        column,
      },
    };
  }
}

export function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

export function minifyJson(value) {
  return JSON.stringify(value);
}

export function computeStats(value) {
  let keyCount = 0;
  let maxDepth = 0;

  function walk(node, depth) {
    if (node && typeof node === 'object') {
      maxDepth = Math.max(maxDepth, depth);
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
      } else {
        const keys = Object.keys(node);
        keyCount += keys.length;
        keys.forEach((key) => walk(node[key], depth + 1));
      }
    } else {
      maxDepth = Math.max(maxDepth, depth);
    }
  }

  walk(value, 1);
  return { keyCount, maxDepth };
}

export function deleteKeysFromJson(value, options) {
  const { keys, previewLimit = 20 } = options;
  const rules = keys.map((item) => item.trim()).filter(Boolean);
  const hitPaths = [];
  let hitCount = 0;

  function recordPath(path) {
    hitCount += 1;
    if (hitPaths.length < previewLimit) {
      hitPaths.push(path);
    }
  }

  function walk(node, path) {
    if (!node || typeof node !== 'object') {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((item, index) => walk(item, `${path}[${index}]`));
    }

    const next = {};
    Object.keys(node).forEach((key) => {
      const matched = rules.includes(key);
      if (matched) {
        recordPath(path ? `${path}.${key}` : key);
        return;
      }
      next[key] = walk(node[key], path ? `${path}.${key}` : key);
    });
    return next;
  }

  const cleaned = rules.length === 0 ? structuredClone(value) : walk(value, '');
  return { value: cleaned, hitCount, hitPaths };
}
