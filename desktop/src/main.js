const invoke = window.__TAURI__.core.invoke;
const open = window.__TAURI__.dialog.open;
const confirmDialog = window.__TAURI__.dialog.confirm;

let models = [];
let currentView = 'list';
let currentEditingModel = null;
let initialScrollDone = false;
let prefs = {
  remember_model: true,
  last_alias: '',
  pinned_aliases: [],
  custom_order: [],
  backup_interval_hours: 24,
  last_backup_at: 0,
  backup_keep_count: 20
};

const configList = document.getElementById('config-list');
const emptyState = document.getElementById('empty-state');
const searchBox = document.getElementById('search-box');
const addConfigBtn = document.getElementById('add-config-btn');
const settingsBtn = document.getElementById('settings-btn');
const detailPage = document.getElementById('detail-page');
const detailForm = document.getElementById('detail-form');
const settingsPage = document.getElementById('settings-page');
const settingsContent = document.getElementById('settings-content');
const backBtn = document.getElementById('back-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');
const commonConfigPage = document.getElementById('common-config-page');
const commonConfigContent = document.getElementById('common-config-content');
const commonConfigBackBtn = document.getElementById('common-config-back-btn');
const toast = document.getElementById('toast');
const container = document.querySelector('.container');

// 通用配置临时状态：仅在当前会话内存在，不持久化到偏好文件
let currentCommonConfigText = '{}';
let returnToDetailAfterCommonEdit = false;

function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

async function loadPrefs() {
  try {
    prefs = await invoke('get_prefs');
    if (!Array.isArray(prefs.pinned_aliases)) {
      prefs.pinned_aliases = [];
    }
    if (!Array.isArray(prefs.custom_order)) {
      prefs.custom_order = [];
    }
  } catch (e) {
    console.error('加载偏好失败:', e);
    prefs = {
      remember_model: true,
      last_alias: '',
      pinned_aliases: [],
      custom_order: [],
      backup_interval_hours: 24,
      last_backup_at: 0,
      backup_keep_count: 20
    };
  }
}

async function persistPrefs(nextPrefs) {
  prefs = { ...prefs, ...nextPrefs };
  await invoke('save_prefs', { prefs });
}

function getLastLaunchedAlias() {
  return prefs.remember_model ? prefs.last_alias : '';
}

async function loadModels() {
  try {
    models = await invoke('list_models');
    renderConfigList(searchBox.value || '');
  } catch (e) {
    console.error('加载模型失败:', e);
    showToast('加载模型失败: ' + e);
  }
}

function renderConfigList(filter = '') {
  const lastAlias = getLastLaunchedAlias();
  const filteredModels = filter
    ? models.filter(m =>
        m.alias.toLowerCase().includes(filter.toLowerCase()) ||
        (m.model_id && m.model_id.toLowerCase().includes(filter.toLowerCase()))
      )
    : models;

  // 置顶项排到最前：按 prefs.pinned_aliases 中的顺序，未置顶项保持原文件系统顺序
  const pinnedSet = new Set(prefs.pinned_aliases || []);
  const pinnedItems = (prefs.pinned_aliases || [])
    .map(a => filteredModels.find(m => m.alias === a))
    .filter(Boolean);

  // 普通区：先按 custom_order 中的顺序展示在 custom_order 里的项，
  // 然后按文件系统顺序追加未在 custom_order 中的项（首次升级或新加未拖过的）
  const orderSet = new Set(prefs.custom_order || []);
  const normalAll = filteredModels.filter(m => !pinnedSet.has(m.alias));
  const normalAllSet = new Set(normalAll.map(m => m.alias));
  const orderedNormal = (prefs.custom_order || [])
    .map(a => normalAll.find(m => m.alias === a))
    .filter(Boolean);
  const trailingNormal = normalAll.filter(m => !orderSet.has(m.alias));
  const restItems = [...orderedNormal, ...trailingNormal];

  // sortedModels 仅用于判空和定位"上次启动行"，分区渲染由下方两个 map 完成
  const sortedModels = [...pinnedItems, ...restItems];

  if (sortedModels.length === 0) {
    configList.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  const renderRow = (m, section) => {
    const isPinned = section === 'pinned';
    return `
    <div class="config-row ${lastAlias && m.alias === lastAlias ? 'last-launched' : ''}"
      data-alias="${m.alias}" data-section="${section}">
      <button type="button" class="drag-handle" data-action="drag-handle"
        title="拖动调整顺序" aria-label="拖动调整顺序">⋮⋮</button>
      <div class="config-row-left">
        <div class="config-info">
          <div class="config-display-name">
            <button type="button" class="btn-pin ${isPinned ? 'pinned' : ''}" data-action="pin"
              title="${isPinned ? '取消置顶' : '置顶'}"
              aria-label="${isPinned ? '取消置顶' : '置顶'}">📌</button>
            <span class="config-display-name-text">${m.display_name || m.alias}</span>
          </div>
          <div class="config-alias">
            <input type="text" class="config-alias-input"
              value="${m.alias || ''}"
              data-field="alias"
              placeholder="运行简称" />
          </div>
        </div>
        <div class="path-row">
          <input type="text" class="path-input"
            value="${m.working_dir || ''}"
            data-field="working_dir"
            placeholder="启动路径" />
          <button type="button" class="browse-btn" data-action="browse">浏览</button>
        </div>
      </div>
      <div class="config-row-right">
        <div class="config-mode">
          <button type="button" class="btn-delete-row" data-action="delete" title="删除">🗑</button>
          <button type="button" class="btn-copy" data-action="copy" title="复制">复制</button>
          <select class="mode-select" data-field="mode">
            <option value="normal" ${(m.mode || 'normal') === 'normal' ? 'selected' : ''}>普通启动</option>
            <option value="skip-permissions" ${m.mode === 'skip-permissions' ? 'selected' : ''}>跳过权限确认</option>
          </select>
        </div>
        <div class="config-buttons">
          <button type="button" class="btn-edit" data-action="edit">修改</button>
          <button type="button" class="btn-launch" data-action="launch">启动</button>
        </div>
      </div>
    </div>
  `;
  };

  const pinnedHtml = pinnedItems.map(m => renderRow(m, 'pinned')).join('');
  const normalHtml = restItems.map(m => renderRow(m, 'normal')).join('');
  // 仅当两区都有项时插入分隔线，便于视觉区分
  const dividerHtml = (pinnedItems.length > 0 && restItems.length > 0)
    ? '<div class="section-divider" aria-hidden="true"></div>'
    : '';
  configList.innerHTML = pinnedHtml + dividerHtml + normalHtml;

  bindConfigRowEvents();

  if (!initialScrollDone && lastAlias) {
    const activeRow = configList.querySelector(`.config-row[data-alias="${CSS.escape(lastAlias)}"]`);
    if (activeRow) {
      activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    initialScrollDone = true;
  }
}

function bindConfigRowEvents() {
  document.querySelectorAll('[data-action="launch"]').forEach(btn => btn.addEventListener('click', handleLaunch));
  document.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', handleEdit));
  document.querySelectorAll('[data-action="copy"]').forEach(btn => btn.addEventListener('click', handleDuplicate));
  document.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', handleDelete));
  document.querySelectorAll('[data-action="browse"]').forEach(btn => btn.addEventListener('click', handleBrowse));
  document.querySelectorAll('[data-action="pin"]').forEach(btn => btn.addEventListener('click', handlePinToggle));
  document.querySelectorAll('.config-alias-input, .path-input, .mode-select').forEach(input => {
    input.addEventListener('change', handleFieldChange);
  });
  bindRowDragEvents();
}

function findModelByAlias(alias) {
  return models.find(m => m.alias === alias);
}

function getRowData(row) {
  const aliasFromDataset = row.dataset.alias;
  const model = findModelByAlias(aliasFromDataset);
  const alias = row.querySelector('[data-field="alias"]').value;
  const mode = row.querySelector('[data-field="mode"]').value;
  const working_dir = row.querySelector('[data-field="working_dir"]').value;

  return {
    ...(model || {}),
    alias,
    mode,
    working_dir
  };
}

async function handleFieldChange(e) {
  const row = e.target.closest('.config-row');
  if (!row) return;

  const rowData = getRowData(row);
  const originalModel = findModelByAlias(row.dataset.alias);
  if (!originalModel || !rowData.alias) return;

  if (e.target.dataset.field === 'alias' && /[㐀-鿿豈-﫿]/.test(rowData.alias)) {
    row.querySelector('[data-field="alias"]').value = originalModel.alias || '';
    showToast('运行简称不能包含中文');
    return;
  }

  try {
    await invoke('save_model_config', {
      params: {
        alias: rowData.alias,
        display_name: originalModel.display_name || '',
        model_id: originalModel.model_id || '',
        haiku_model: originalModel.haiku_model || '',
        opus_model: originalModel.opus_model || '',
        sonnet_model: originalModel.sonnet_model || '',
        auth_value: originalModel.auth_mode === 'API_KEY' ? (originalModel.api_key || '') : (originalModel.auth_token || originalModel.api_key || ''),
        auth_mode: originalModel.auth_mode || 'AUTH_TOKEN',
        base_url: originalModel.base_url || '',
        working_dir: rowData.working_dir || '',
        mode: rowData.mode || 'normal',
        raw_json: originalModel.raw_json || '',
        original_alias: originalModel.alias || null,
      }
    });

    await loadModels();
  } catch (err) {
    await loadModels();
    showToast('保存列表项失败: ' + err);
  }
}

async function handleLaunch(e) {
  const row = e.target.closest('.config-row');
  const rowData = getRowData(row);

  if (!rowData.alias) {
    showToast('请选择要启动的配置');
    return;
  }

  try {
    await invoke('launch_claude', {
      params: {
        alias: rowData.alias,
        working_dir: rowData.working_dir || await invoke('get_home_dir'),
        skip_permissions: rowData.mode === 'skip-permissions'
      }
    });

    if (prefs.remember_model) {
      await persistPrefs({ last_alias: rowData.alias });
      renderConfigList(searchBox.value || '');
    }

    showToast(`已启动 ${rowData.alias}`);
  } catch (err) {
    showToast(`启动失败: ${err}`);
  }
}

function handleEdit(e) {
  const row = e.target.closest('.config-row');
  const model = findModelByAlias(row.dataset.alias);
  openEditForModel(model);
}

function openEditForModel(model) {
  if (!model) return;

  const apiKeyValue = model.auth_mode === 'API_KEY' ? model.api_key : (model.auth_token || model.api_key);

  let originalJson = {};
  if (model.raw_json) {
    try {
      originalJson = JSON.parse(model.raw_json);
    } catch (e) {
      console.error('解析原始 JSON 失败:', e);
    }
  }

  // 读取 cc_start 元信息（仅本桌面端使用），然后从展示态 JSON 中剥离，
  // 避免编辑器把内部状态字段直接暴露给用户。保存时由 saveCurrentConfig 重新注入。
  let importCommonEnabled = false;
  if (originalJson && typeof originalJson === 'object' && !Array.isArray(originalJson)) {
    const meta = originalJson.cc_start;
    if (meta && typeof meta === 'object') {
      importCommonEnabled = !!meta.import_common_config;
    }
    if ('cc_start' in originalJson) {
      delete originalJson.cc_start;
    }
  }

  currentEditingModel = {
    ...model,
    api_key: apiKeyValue,
    _originalAlias: model.alias,
    _authMode: model.auth_mode || 'AUTH_TOKEN',
    _isNew: false,
    _originalJson: originalJson,
    _importCommonEnabled: importCommonEnabled,
    _preImportSnapshot: null,
    haiku_model: model.haiku_model || '',
    opus_model: model.opus_model || '',
    sonnet_model: model.sonnet_model || ''
  };
  showDetailPage();
}

async function handleDuplicate(e) {
  const row = e.target.closest('.config-row');
  const model = findModelByAlias(row.dataset.alias);
  if (!model || !model.alias) return;

  try {
    const newAlias = await invoke('copy_model_config', { alias: model.alias });
    showToast(`已复制为 ${newAlias}`);
    await loadModels();
    const newModel = models.find(m => m.alias === newAlias);
    if (newModel) {
      openEditForModel(newModel);
    }
  } catch (err) {
    showToast('复制失败: ' + err);
  }
}

async function handleDelete(e) {
  const row = e.target.closest('.config-row');
  const model = findModelByAlias(row.dataset.alias);
  if (!model || !model.alias) return;

  const lastAlias = getLastLaunchedAlias();
  if (lastAlias && model.alias === lastAlias) {
    showToast('当前使用的配置不能删除');
    return;
  }

  const label = model.display_name || model.alias;
  const confirmed = await confirmDialog(
    `删除「${label}」的配置？\n\n删除后可在 ~/.claude/models/.trash/ 中找回，回收站只保留最近 10 个。`,
    { title: '确认删除', kind: 'warning' }
  );
  if (!confirmed) return;

  try {
    await invoke('delete_model_config', { alias: model.alias });
    showToast(`已删除 ${label}`);
    await loadModels();
  } catch (err) {
    showToast('删除失败: ' + err);
  }
}

async function handleBrowse(e) {
  const row = e.target.closest('.config-row');
  const pathInput = row.querySelector('[data-field="working_dir"]');

  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择启动目录'
    });
    if (selected) {
      pathInput.value = selected;
      await handleFieldChange({ target: pathInput });
    }
  } catch (err) {
    console.error('选择目录失败:', err);
  }
}

async function handlePinToggle(e) {
  e.stopPropagation();
  const row = e.target.closest('.config-row');
  if (!row) return;
  const alias = row.dataset.alias;
  if (!alias) return;

  const current = Array.isArray(prefs.pinned_aliases) ? [...prefs.pinned_aliases] : [];
  const idx = current.indexOf(alias);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.unshift(alias); // 新置顶项排到最前
  }

  try {
    await persistPrefs({ pinned_aliases: current });
    renderConfigList(searchBox.value || '');
  } catch (err) {
    showToast('保存置顶失败: ' + err);
  }
}

// ===== 拖动排序（基于 mouse 事件，不用 HTML5 drag API）=====
// HTML5 drag 在 Tauri/WebView2 上拦截器经常打不到，这里用 mousedown/mousemove/mouseup 自己实现。
// dragState 仅在一次拖动期间使用，mousedown 设置，mouseup 清除。
let dragState = null;

function bindRowDragEvents() {
  document.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('mousedown', handleHandleMouseDown);
  });
}

function handleHandleMouseDown(e) {
  if (e.button !== 0) return; // 仅左键
  e.preventDefault();         // 阻止默认的文本选择/原生拖动行为
  e.stopPropagation();

  const handle = e.currentTarget;
  const row = handle.closest('.config-row');
  if (!row) return;
  const alias = row.dataset.alias;
  const section = row.dataset.section;
  if (!alias || !section) return;

  dragState = { alias, section, row };
  row.classList.add('dragging');
  document.body.classList.add('row-dragging');

  document.addEventListener('mousemove', handleDocMouseMove);
  document.addEventListener('mouseup', handleDocMouseUp);
}

function handleDocMouseMove(e) {
  if (!dragState) return;

  const targetRow = findRowAtY(e.clientY, dragState.section);
  if (!targetRow || targetRow === dragState.row) return;

  const rect = targetRow.getBoundingClientRect();
  const insertBefore = (e.clientY - rect.top) < (rect.height / 2);

  // 直接重排 DOM 显示实时反馈，不落盘
  if (insertBefore) {
    if (targetRow.previousElementSibling !== dragState.row) {
      targetRow.parentNode.insertBefore(dragState.row, targetRow);
    }
  } else {
    if (targetRow.nextElementSibling !== dragState.row) {
      targetRow.parentNode.insertBefore(dragState.row, targetRow.nextElementSibling);
    }
  }
}

function findRowAtY(y, section) {
  const rows = document.querySelectorAll(`.config-row[data-section="${section}"]`);
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom) {
      return row;
    }
  }
  return null;
}

async function handleDocMouseUp() {
  if (!dragState) return;
  document.removeEventListener('mousemove', handleDocMouseMove);
  document.removeEventListener('mouseup', handleDocMouseUp);

  const { row, section } = dragState;
  row.classList.remove('dragging');
  document.body.classList.remove('row-dragging');

  // 提交：从当前 DOM 读取该区域当前顺序
  const visibleAliases = Array.from(
    document.querySelectorAll(`.config-row[data-section="${section}"]`)
  ).map(r => r.dataset.alias);

  dragState = null;

  const key = section === 'pinned' ? 'pinned_aliases' : 'custom_order';
  try {
    await persistPrefs({ [key]: visibleAliases });
    renderConfigList(searchBox.value || '');
  } catch (err) {
    showToast('保存排序失败: ' + err);
    renderConfigList(searchBox.value || '');
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightJsonText(text) {
  const escaped = escapeHtml(text || '');
  return escaped.replace(
    /(\"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\\"])*\"\s*:?)|(\btrue\b|\bfalse\b|\bnull\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g,
    (match, stringToken, keywordToken, numberToken) => {
      if (stringToken) {
        const className = stringToken.endsWith(':') ? 'json-key' : 'json-string';
        return `<span class="${className}">${stringToken}</span>`;
      }
      if (keywordToken) {
        return `<span class="json-keyword">${keywordToken}</span>`;
      }
      if (numberToken) {
        return `<span class="json-number">${numberToken}</span>`;
      }
      return match;
    }
  );
}

function buildLineNumbers(text) {
  const lineCount = Math.max(1, text.split('\n').length);
  return Array.from({ length: lineCount }, (_, index) => index + 1).join('\n');
}

function getWrapMeasureElement(editor) {
  let measure = document.getElementById('detail-config-line-measure');
  if (!measure) {
    measure = document.createElement('div');
    measure.id = 'detail-config-line-measure';
    measure.setAttribute('aria-hidden', 'true');
    document.body.appendChild(measure);
  }

  const computedStyle = window.getComputedStyle(editor);
  measure.style.position = 'absolute';
  measure.style.visibility = 'hidden';
  measure.style.pointerEvents = 'none';
  measure.style.left = '-99999px';
  measure.style.top = '0';
  measure.style.whiteSpace = 'pre-wrap';
  measure.style.wordBreak = 'break-word';
  measure.style.overflowWrap = 'anywhere';
  measure.style.boxSizing = 'border-box';
  measure.style.paddingTop = computedStyle.paddingTop;
  measure.style.paddingRight = computedStyle.paddingRight;
  measure.style.paddingBottom = computedStyle.paddingBottom;
  measure.style.paddingLeft = computedStyle.paddingLeft;
  measure.style.font = computedStyle.font;
  measure.style.lineHeight = computedStyle.lineHeight;
  measure.style.letterSpacing = computedStyle.letterSpacing;
  measure.style.tabSize = computedStyle.tabSize;
  measure.style.width = `${editor.clientWidth}px`;

  return measure;
}

function buildWrappedLineNumbers(text, editor) {
  const lines = (text || '').split('\n');
  if (!editor) {
    return buildLineNumbers(text);
  }

  const computedStyle = window.getComputedStyle(editor);
  const lineHeight = parseFloat(computedStyle.lineHeight) || 19.5;
  const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
  const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
  const measure = getWrapMeasureElement(editor);

  const visualRows = [];
  lines.forEach((line, index) => {
    visualRows.push(String(index + 1));

    if (!line) {
      return;
    }

    measure.textContent = line;
    const wrappedRows = Math.max(
      1,
      Math.round((measure.scrollHeight - paddingTop - paddingBottom) / lineHeight)
    );

    for (let i = 1; i < wrappedRows; i += 1) {
      visualRows.push('');
    }
  });

  return visualRows.join('\n');
}

function isConfigWrapEnabled(prefix = 'detail-config') {
  const wrapToggle = document.getElementById(`${prefix}-wrap-toggle`);
  return Boolean(wrapToggle?.checked);
}

function syncConfigWrapMode(prefix = 'detail-config') {
  const editor = document.getElementById(`${prefix}-editor`);
  const shell = editor?.closest('.config-editor-shell');
  if (!shell || !editor) return false;

  const wrapEnabled = isConfigWrapEnabled(prefix);
  shell.classList.toggle('wrap-enabled', wrapEnabled);
  editor.wrap = wrapEnabled ? 'soft' : 'off';
  return wrapEnabled;
}

function syncConfigEditorLayout(prefix = 'detail-config') {
  const editor = document.getElementById(`${prefix}-editor`);
  const lineNumbers = document.getElementById(`${prefix}-lines`);
  const highlight = document.getElementById(`${prefix}-highlight`);
  if (!editor || !lineNumbers || !highlight) return;

  const wrapEnabled = syncConfigWrapMode(prefix);
  const text = editor.value || '';
  const lineCount = Math.max(1, text.split('\n').length);
  lineNumbers.textContent = wrapEnabled
    ? buildWrappedLineNumbers(text, editor)
    : buildLineNumbers(text);

  highlight.innerHTML = `${highlightJsonText(text)}\n`;
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;

  editor.style.height = 'auto';
  highlight.style.height = 'auto';
  lineNumbers.style.height = 'auto';

  const computedStyle = window.getComputedStyle(editor);
  const lineHeight = parseFloat(computedStyle.lineHeight) || 19.5;
  const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
  const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
  const contentHeight = lineCount * lineHeight + paddingTop + paddingBottom;
  const measuredHeight = Math.max(editor.scrollHeight, contentHeight, 240);
  const height = `${Math.ceil(measuredHeight)}px`;

  editor.style.height = height;
  highlight.style.height = height;
  lineNumbers.style.height = height;
  lineNumbers.scrollTop = editor.scrollTop;
}

function setConfigEditorText(text, prefix = 'detail-config') {
  const editor = document.getElementById(`${prefix}-editor`);
  if (!editor) return;

  if (editor.value !== text) {
    editor.value = text;
  }

  requestAnimationFrame(() => {
    syncConfigEditorLayout(prefix);
  });
}


function renderDetailForm() {
  if (!currentEditingModel) return;

  detailForm.innerHTML = `
    <div class="form-group">
      <label class="form-label">显示名称</label>
      <input type="text" class="form-input" id="detail-display-name"
        value="${currentEditingModel.display_name || ''}" />
    </div>
    <div class="form-group">
      <label class="form-label">运行简称</label>
      <input type="text" class="form-input" id="detail-alias"
        value="${currentEditingModel.alias || ''}" />
    </div>
    <div class="form-group">
      <label class="form-label">认证方式</label>
      <select class="form-select" id="detail-auth-mode">
        <option value="AUTH_TOKEN" ${(currentEditingModel._authMode || 'AUTH_TOKEN') === 'AUTH_TOKEN' ? 'selected' : ''}>AUTH_TOKEN</option>
        <option value="API_KEY" ${currentEditingModel._authMode === 'API_KEY' ? 'selected' : ''}>API_KEY</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Key / Token</label>
      <div class="input-with-icon">
        <input type="password" class="form-input" id="detail-api-key"
          value="${currentEditingModel.api_key || ''}"
          placeholder="输入 Key 或 Token" />
        <button type="button" class="btn-toggle-view" id="toggle-api-key" title="显示/隐藏">👁</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Base URL</label>
      <input type="text" class="form-input" id="detail-base-url"
        value="${currentEditingModel.base_url || ''}"
        placeholder="https://api.anthropic.com" />
    </div>
    <div class="form-group">
      <label class="form-label">模型（至少填一个）</label>
      <div class="model-grid">
        <input type="text" class="form-input" id="detail-model-id"
          value="${currentEditingModel.model_id || ''}"
          placeholder="主模型 ID" />
        <input type="text" class="form-input" id="detail-haiku-model"
          value="${currentEditingModel.haiku_model || ''}"
          placeholder="HAIKU 模型" />
        <input type="text" class="form-input" id="detail-sonnet-model"
          value="${currentEditingModel.sonnet_model || ''}"
          placeholder="SONNET 模型" />
        <input type="text" class="form-input" id="detail-opus-model"
          value="${currentEditingModel.opus_model || ''}"
          placeholder="OPUS 模型" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">启动模式</label>
      <select class="form-select" id="detail-mode">
        <option value="normal" ${currentEditingModel.mode === 'normal' ? 'selected' : ''}>普通启动</option>
        <option value="skip-permissions" ${currentEditingModel.mode === 'skip-permissions' ? 'selected' : ''}>跳过权限确认</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">启动路径</label>
      <div class="form-row">
        <input type="text" class="form-input" id="detail-working-dir"
          value="${currentEditingModel.working_dir || ''}"
          placeholder="选择或输入启动目录" />
        <button type="button" class="browse-btn" id="detail-browse-btn">浏览</button>
      </div>
    </div>
    <div class="form-group">
      <div class="config-header-row">
        <label class="form-label">原始配置</label>
        <div class="config-header-actions">
          <button type="button" class="config-header-link" id="detail-edit-common-btn">编辑通用配置</button>
          <label class="config-wrap-toggle"><input type="checkbox" id="detail-import-common-toggle"> 导入通用配置</label>
          <label class="config-wrap-toggle"><input type="checkbox" id="detail-config-wrap-toggle"> 自动换行</label>
        </div>
      </div>
      <div class="config-editor-shell">
        <div class="config-line-numbers" id="detail-config-lines">1</div>
        <div class="config-editor-stack">
          <pre class="config-editor-highlight" id="detail-config-highlight" aria-hidden="true"></pre>
          <textarea class="config-editor-input" id="detail-config-editor" spellcheck="false"></textarea>
        </div>
      </div>
      <div class="config-error" id="config-parse-error"></div>
      <div class="sync-status" id="sync-status"></div>
    </div>
  `;

  detailForm.innerHTML += `
    <div class="detail-footer">
      <div class="detail-footer-main">
        <div class="detail-footer-actions">
          <button type="button" class="btn-test" id="test-connectivity-btn">测试连通性</button>
          <div class="test-hint">发送最小请求测试，可能消耗少量 token。</div>
          <button type="button" class="btn-save btn-save-compact" id="save-btn">保存</button>
        </div>
        <div class="test-result" id="test-result" style="display:none;"></div>
      </div>
    </div>
  `;

  updateConfigText();
  bindDetailEvents();
  requestAnimationFrame(() => {
    syncConfigEditorLayout();
  });

  // 切回详情页时，若该模型上次保存为"已导入通用配置"，自动用最新通用配置合并预览。
  // 不写入 _preImportSnapshot：取消勾选时走"无快照"路径，按当前通用配置字段精确删除，
  // 既能去掉本次导入带进来的字段，又能保留用户在编辑器里手写的非通用字段。
  if (currentEditingModel._importCommonEnabled) {
    applyImportOnOpenIfNeeded();
  }
}

function showDetailPage() {
  currentView = 'detail';
  container.style.display = 'none';
  settingsPage.style.display = 'none';
  commonConfigPage.style.display = 'none';
  detailPage.style.display = 'block';
  renderDetailForm();
}

function renderSettingsPage() {
  const interval = Number.isFinite(prefs.backup_interval_hours) ? prefs.backup_interval_hours : 24;
  const keepCount = Number.isFinite(prefs.backup_keep_count) && prefs.backup_keep_count > 0
    ? prefs.backup_keep_count
    : 20;
  const lastBackupAt = prefs.last_backup_at || 0;
  const lastBackupText = lastBackupAt > 0
    ? new Date(lastBackupAt * 1000).toLocaleString()
    : '尚未备份';

  settingsContent.innerHTML = `
    <div class="settings-card">
      <h3 class="settings-section-title">显示</h3>
      <label class="settings-checkbox"><input type="checkbox" id="remember-model" ${prefs.remember_model ? 'checked' : ''}> 高亮上次启动的配置</label>
    </div>

    <div class="settings-card">
      <h3 class="settings-section-title">自动备份</h3>
      <label class="settings-form-row">
        <span>备份频率</span>
        <select id="backup-interval">
          <option value="0" ${interval === 0 ? 'selected' : ''}>关闭</option>
          <option value="1" ${interval === 1 ? 'selected' : ''}>每 1 小时</option>
          <option value="6" ${interval === 6 ? 'selected' : ''}>每 6 小时</option>
          <option value="24" ${interval === 24 ? 'selected' : ''}>每 24 小时</option>
          <option value="168" ${interval === 168 ? 'selected' : ''}>每 7 天</option>
        </select>
      </label>
      <label class="settings-form-row">
        <span>保留份数</span>
        <select id="backup-keep-count">
          <option value="20" ${keepCount === 20 ? 'selected' : ''}>最近 20 份</option>
          <option value="50" ${keepCount === 50 ? 'selected' : ''}>最近 50 份</option>
          <option value="100" ${keepCount === 100 ? 'selected' : ''}>最近 100 份</option>
        </select>
      </label>
      <div class="settings-about-item">备份目录：~/.claude/cc_start_backups/，恢复前快照（.pre-restore-）不计入保留份数</div>
      <div class="settings-about-item">上次备份时间：${lastBackupText}</div>
      <div class="settings-form-row settings-form-row-actions">
        <button type="button" class="btn-edit" id="run-backup-now-btn">立即备份一次</button>
        <button type="button" class="btn-edit" id="open-backups-dir-btn">打开备份目录</button>
        <button type="button" class="btn-edit" id="refresh-backups-btn">刷新列表</button>
      </div>
      <div class="backup-list" id="backup-list">
        <div class="backup-list-loading">加载中...</div>
      </div>
    </div>

    <div class="settings-card">
      <h3 class="settings-section-title">关于</h3>
      <div class="settings-about-item">CC Start GUI 版本：<span id="app-version">读取中...</span></div>
      <div class="settings-about-item">Claude Code 版本：<span id="claude-version">读取中...</span></div>
    </div>
  `;

  bindSettingsEvents();
  loadSettingsMeta();
  loadBackupList();
}

function bindSettingsEvents() {
  const rememberModel = document.getElementById('remember-model');

  rememberModel.addEventListener('change', async () => {
    const next = rememberModel.checked;
    await persistPrefs({ remember_model: next, last_alias: next ? prefs.last_alias : '' });
    renderConfigList(searchBox.value || '');
    showToast('设置已保存');
  });

  const backupInterval = document.getElementById('backup-interval');
  if (backupInterval) {
    backupInterval.addEventListener('change', async () => {
      const value = parseInt(backupInterval.value, 10) || 0;
      try {
        await persistPrefs({ backup_interval_hours: value });
        showToast(value === 0 ? '已关闭自动备份' : `已设置为每 ${value} 小时备份一次`);
      } catch (err) {
        showToast('保存失败: ' + err);
      }
    });
  }

  const runBackupNowBtn = document.getElementById('run-backup-now-btn');
  if (runBackupNowBtn) {
    runBackupNowBtn.addEventListener('click', async () => {
      runBackupNowBtn.disabled = true;
      const originalText = runBackupNowBtn.textContent;
      runBackupNowBtn.textContent = '备份中...';
      try {
        const path = await invoke('run_backup_now');
        showToast('已备份到：' + path);
        // 刷新偏好与设置页（last_backup_at 由后端写回）
        await loadPrefs();
        renderSettingsPage();
      } catch (err) {
        showToast('备份失败: ' + err);
      } finally {
        runBackupNowBtn.disabled = false;
        runBackupNowBtn.textContent = originalText;
      }
    });
  }

  const openBackupsDirBtn = document.getElementById('open-backups-dir-btn');
  if (openBackupsDirBtn) {
    openBackupsDirBtn.addEventListener('click', async () => {
      try {
        await invoke('open_backups_dir');
      } catch (err) {
        showToast('打开备份目录失败: ' + err);
      }
    });
  }

  const backupKeepCount = document.getElementById('backup-keep-count');
  if (backupKeepCount) {
    backupKeepCount.addEventListener('change', async () => {
      const value = parseInt(backupKeepCount.value, 10) || 20;
      try {
        await persistPrefs({ backup_keep_count: value });
        showToast(`保留份数已改为最近 ${value} 份`);
      } catch (err) {
        showToast('保存失败: ' + err);
      }
    });
  }

  const refreshBackupsBtn = document.getElementById('refresh-backups-btn');
  if (refreshBackupsBtn) {
    refreshBackupsBtn.addEventListener('click', () => loadBackupList());
  }
}

async function loadSettingsMeta() {
  const appVersionEl = document.getElementById('app-version');
  const claudeVersionEl = document.getElementById('claude-version');

  try {
    const appVersion = await invoke('get_app_version');
    appVersionEl.textContent = appVersion;
  } catch (err) {
    appVersionEl.textContent = '读取失败';
  }

  try {
    const claudeVersion = await invoke('get_claude_version');
    claudeVersionEl.textContent = claudeVersion;
  } catch (err) {
    claudeVersionEl.textContent = '读取失败';
  }
}

function formatBackupSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeAttr(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadBackupList() {
  const listEl = document.getElementById('backup-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="backup-list-loading">加载中...</div>';

  let infos;
  try {
    infos = await invoke('list_backups');
  } catch (err) {
    listEl.innerHTML = `<div class="backup-list-empty">读取备份列表失败：${escapeAttr(err)}</div>`;
    return;
  }

  if (!infos || infos.length === 0) {
    listEl.innerHTML = '<div class="backup-list-empty">尚无备份记录</div>';
    return;
  }

  const rows = infos.map(info => {
    const created = info.created_at > 0
      ? new Date(info.created_at * 1000).toLocaleString()
      : '-';
    const tag = info.is_pre_restore
      ? '<span class="backup-tag tag-pre-restore">恢复前快照</span>'
      : '<span class="backup-tag tag-regular">备份</span>';
    return `
      <div class="backup-row" data-name="${escapeAttr(info.name)}">
        <div class="backup-row-main">
          <div class="backup-row-title">
            ${tag}
            <span class="backup-row-name">${escapeAttr(info.name)}</span>
          </div>
          <div class="backup-row-meta">
            ${created} · ${info.model_count} 个模型 · ${formatBackupSize(info.size_bytes)}
          </div>
        </div>
        <button type="button" class="btn-edit btn-restore" data-action="restore">恢复此备份</button>
      </div>
    `;
  }).join('');

  listEl.innerHTML = rows;

  listEl.querySelectorAll('[data-action="restore"]').forEach(btn => {
    btn.addEventListener('click', handleRestoreBackup);
  });
}

async function handleRestoreBackup(e) {
  const row = e.target.closest('.backup-row');
  if (!row) return;
  const name = row.dataset.name;
  if (!name) return;

  const confirmed = await confirmDialog(
    `确认恢复备份「${name}」？\n\n` +
    `镜像式恢复：当前 ~/.claude/models/ 下的模型配置会被备份内容完全替换，` +
    `当前多出而备份中没有的模型会被删除。\n\n` +
    `恢复前会先把当前状态自动备份到 .pre-restore-* 目录，万一出问题可以从那里找回。`,
    { title: '确认恢复', kind: 'warning' }
  );
  if (!confirmed) return;

  const restoreBtn = e.target;
  const originalText = restoreBtn.textContent;
  restoreBtn.disabled = true;
  restoreBtn.textContent = '恢复中...';

  try {
    const preRestorePath = await invoke('restore_backup', { name });
    showToast(`恢复完成。原状态已保存到：${preRestorePath}`);
    // 重新加载偏好（备份里的 prefs 已覆盖当前），刷新列表与设置页
    await loadPrefs();
    await loadModels();
    renderSettingsPage();
  } catch (err) {
    showToast('恢复失败: ' + err);
    restoreBtn.disabled = false;
    restoreBtn.textContent = originalText;
  }
}

function showSettingsPage() {
  currentView = 'settings';
  container.style.display = 'none';
  detailPage.style.display = 'none';
  commonConfigPage.style.display = 'none';
  settingsPage.style.display = 'block';
  renderSettingsPage();
}

function showListPage() {
  currentView = 'list';
  currentEditingModel = null;
  detailPage.style.display = 'none';
  settingsPage.style.display = 'none';
  commonConfigPage.style.display = 'none';
  container.style.display = 'block';
}

function bindDetailEvents() {
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-connectivity-btn');
  const browseBtn = document.getElementById('detail-browse-btn');
  const configEditor = document.getElementById('detail-config-editor');
  const toggleBtn = document.getElementById('toggle-api-key');
  const apiKeyInput = document.getElementById('detail-api-key');

  saveBtn.addEventListener('click', handleSave);
  if (testBtn) testBtn.addEventListener('click', handleTestConnectivity);
  browseBtn.addEventListener('click', handleDetailBrowse);

  if (toggleBtn && apiKeyInput) {
    toggleBtn.addEventListener('click', () => {
      if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleBtn.textContent = '🔒';
      } else {
        apiKeyInput.type = 'password';
        toggleBtn.textContent = '👁';
      }
    });
  }

  if (configEditor) {
    configEditor.addEventListener('input', handleConfigTextChange);
    configEditor.addEventListener('scroll', syncConfigEditorLayout);
    configEditor.addEventListener('click', syncConfigEditorLayout);
    configEditor.addEventListener('keyup', syncConfigEditorLayout);
    setConfigEditorText(configEditor.value || '');
  }

  const wrapToggle = document.getElementById('detail-config-wrap-toggle');
  if (wrapToggle) {
    wrapToggle.addEventListener('change', () => {
      syncConfigEditorLayout();
    });
  }

  ['detail-display-name', 'detail-alias', 'detail-model-id', 'detail-api-key',
   'detail-base-url', 'detail-mode', 'detail-working-dir',
   'detail-haiku-model', 'detail-opus-model', 'detail-sonnet-model'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        currentEditingModel.display_name = document.getElementById('detail-display-name').value;
        currentEditingModel.alias = document.getElementById('detail-alias').value;
        currentEditingModel.api_key = document.getElementById('detail-api-key').value;
        currentEditingModel.base_url = document.getElementById('detail-base-url').value;
        currentEditingModel.model_id = document.getElementById('detail-model-id').value;
        currentEditingModel.mode = document.getElementById('detail-mode').value;
        currentEditingModel.working_dir = document.getElementById('detail-working-dir').value;
        currentEditingModel.haiku_model = document.getElementById('detail-haiku-model').value;
        currentEditingModel.opus_model = document.getElementById('detail-opus-model').value;
        currentEditingModel.sonnet_model = document.getElementById('detail-sonnet-model').value;
        const activeConfigEditor = document.getElementById('detail-config-editor');
        if (activeConfigEditor && document.activeElement !== activeConfigEditor) {
          updateConfigText();
        }
        markUnsynced();
        clearTestResult();
      });
    }
  });

  const authSelect = document.getElementById('detail-auth-mode');
  if (authSelect) {
    authSelect.addEventListener('change', () => {
      currentEditingModel._authMode = authSelect.value;
      const activeConfigEditor = document.getElementById('detail-config-editor');
      if (activeConfigEditor && document.activeElement !== activeConfigEditor) {
        updateConfigText();
      }
      markUnsynced();
      clearTestResult();
    });
  }

  const importToggle = document.getElementById('detail-import-common-toggle');
  if (importToggle) {
    importToggle.addEventListener('change', handleImportCommonToggle);
  }
  const editCommonBtn = document.getElementById('detail-edit-common-btn');
  if (editCommonBtn) {
    editCommonBtn.addEventListener('click', handleEditCommonClick);
  }
}

function clearTestResult() {
  const testResult = document.getElementById('test-result');
  if (!testResult) return;
  testResult.style.display = 'none';
  testResult.textContent = '';
  testResult.className = 'test-result';
}

function renderTestResult(success, message) {
  const testResult = document.getElementById('test-result');
  if (!testResult) return;
  testResult.style.display = 'block';
  testResult.textContent = `${success ? '✓' : '✗'} ${message}`;
  testResult.className = `test-result ${success ? 'success' : 'error'}`;
}

function mapConnectivityMessage(result) {
  if (result.success) {
    return `连接成功（${result.elapsed_ms} ms）`;
  }

  switch (result.error_kind) {
    case 'auth_failed':
      return '认证失败，请检查 Key 或 Token';
    case 'not_found':
      return 'URL 或模型 ID 错误（404）';
    case 'timeout':
      return '请求超时（3 秒），网络或 URL 不通';
    case 'network':
      return '无法连接到服务器';
    default:
      return `未知错误：${result.message || '请检查配置'}`;
  }
}

async function handleTestConnectivity() {
  if (!currentEditingModel) return;

  const testBtn = document.getElementById('test-connectivity-btn');
  const base_url = document.getElementById('detail-base-url').value.trim();
  const auth_value = document.getElementById('detail-api-key').value.trim();
  const auth_mode = document.getElementById('detail-auth-mode').value;
  const model_id = document.getElementById('detail-model-id').value.trim()
    || document.getElementById('detail-haiku-model').value.trim()
    || document.getElementById('detail-opus-model').value.trim()
    || document.getElementById('detail-sonnet-model').value.trim();

  if (!base_url) {
    showToast('Base URL 不能为空');
    return;
  }
  if (!auth_value) {
    showToast('Key / Token 不能为空');
    return;
  }
  if (!model_id) {
    showToast('至少需要填写一个模型 ID');
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = '测试中...';
  clearTestResult();

  try {
    const result = await invoke('test_connectivity', {
      params: { base_url, auth_value, auth_mode, model_id }
    });
    renderTestResult(result.success, mapConnectivityMessage(result));

    if (result.success) {
      const saveOk = await saveCurrentConfig(false);
      if (saveOk) {
        showToast('已自动保存');
      }
    }
  } catch (err) {
    renderTestResult(false, `未知错误：${err}`);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '测试连通性';
  }
}

function markUnsynced() {
  const status = document.getElementById('sync-status');
  if (status) {
    status.textContent = '未同步';
    status.className = 'sync-status unsynced';
  }
}

function buildConfigJson() {
  const hasOriginal = currentEditingModel._originalJson
    && Object.keys(currentEditingModel._originalJson).length > 0;

  const json = hasOriginal
    ? JSON.parse(JSON.stringify(currentEditingModel._originalJson))
    : {};

  if (currentEditingModel.display_name) json.display_name = currentEditingModel.display_name;
  else delete json.display_name;

  if (currentEditingModel.working_dir) json.working_dir = currentEditingModel.working_dir;
  else delete json.working_dir;

  if (currentEditingModel.mode === 'skip-permissions') json.mode = currentEditingModel.mode;
  else delete json.mode;

  if (!json.env) json.env = {};

  const setOrDel = (key, val) => {
    if (val) json.env[key] = val;
    else delete json.env[key];
  };
  // 强制按规范顺序 HAIKU → SONNET → OPUS 重写：先 delete 再 set，
  // 让 JS 对象的"插入顺序"决定最终 JSON 输出顺序
  delete json.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  delete json.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete json.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  setOrDel('ANTHROPIC_MODEL', currentEditingModel.model_id);
  setOrDel('ANTHROPIC_DEFAULT_HAIKU_MODEL', currentEditingModel.haiku_model);
  setOrDel('ANTHROPIC_DEFAULT_SONNET_MODEL', currentEditingModel.sonnet_model);
  setOrDel('ANTHROPIC_DEFAULT_OPUS_MODEL', currentEditingModel.opus_model);

  const authMode = currentEditingModel._authMode || 'AUTH_TOKEN';
  if (currentEditingModel.api_key) {
    if (authMode === 'API_KEY') {
      json.env.ANTHROPIC_API_KEY = currentEditingModel.api_key;
      delete json.env.ANTHROPIC_AUTH_TOKEN;
    } else {
      json.env.ANTHROPIC_AUTH_TOKEN = currentEditingModel.api_key;
      delete json.env.ANTHROPIC_API_KEY;
    }
  } else {
    delete json.env.ANTHROPIC_API_KEY;
    delete json.env.ANTHROPIC_AUTH_TOKEN;
  }

  setOrDel('ANTHROPIC_BASE_URL', currentEditingModel.base_url);
  return json;
}

function updateConfigText() {
  const editor = document.getElementById('detail-config-editor');
  if (!editor || !currentEditingModel) return;

  const json = buildConfigJson();
  const jsonStr = JSON.stringify(json, null, 2);
  setConfigEditorText(jsonStr);

  const status = document.getElementById('sync-status');
  if (status) {
    status.textContent = '已同步';
    status.className = 'sync-status synced';
  }
}


function handleConfigTextChange() {
  const editor = document.getElementById('detail-config-editor');
  const errorEl = document.getElementById('config-parse-error');
  if (!editor || !errorEl) return;

  const rawText = editor.value;
  syncConfigEditorLayout();
  markUnsynced();
  clearTestResult();

  try {
    const parsed = JSON.parse(rawText);
    currentEditingModel._originalJson = parsed;

    if (parsed.display_name !== undefined) {
      currentEditingModel.display_name = parsed.display_name || '';
      const el = document.getElementById('detail-display-name');
      if (el) el.value = currentEditingModel.display_name;
    }

    currentEditingModel.model_id = parsed.env?.ANTHROPIC_MODEL || '';
    currentEditingModel.haiku_model = parsed.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL || '';
    currentEditingModel.opus_model = parsed.env?.ANTHROPIC_DEFAULT_OPUS_MODEL || '';
    currentEditingModel.sonnet_model = parsed.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
    currentEditingModel.api_key = parsed.env?.ANTHROPIC_AUTH_TOKEN || parsed.env?.ANTHROPIC_API_KEY || '';
    currentEditingModel._authMode = parsed.env?.ANTHROPIC_AUTH_TOKEN ? 'AUTH_TOKEN' : 'API_KEY';
    currentEditingModel.base_url = parsed.env?.ANTHROPIC_BASE_URL || '';

    const modelId = document.getElementById('detail-model-id');
    const haikuModel = document.getElementById('detail-haiku-model');
    const opusModel = document.getElementById('detail-opus-model');
    const sonnetModel = document.getElementById('detail-sonnet-model');
    const apiKey = document.getElementById('detail-api-key');
    const baseUrl = document.getElementById('detail-base-url');
    const authSelect = document.getElementById('detail-auth-mode');

    if (modelId) modelId.value = currentEditingModel.model_id;
    if (haikuModel) haikuModel.value = currentEditingModel.haiku_model;
    if (opusModel) opusModel.value = currentEditingModel.opus_model;
    if (sonnetModel) sonnetModel.value = currentEditingModel.sonnet_model;
    if (apiKey) apiKey.value = currentEditingModel.api_key;
    if (baseUrl) baseUrl.value = currentEditingModel.base_url;
    if (authSelect) authSelect.value = currentEditingModel._authMode;

    if (parsed.working_dir !== undefined) {
      currentEditingModel.working_dir = parsed.working_dir || '';
      const el = document.getElementById('detail-working-dir');
      if (el) el.value = currentEditingModel.working_dir;
    }

    if (parsed.mode !== undefined) {
      currentEditingModel.mode = parsed.mode || 'normal';
      const el = document.getElementById('detail-mode');
      if (el) el.value = currentEditingModel.mode;
    }

    errorEl.textContent = '';
  } catch (e) {
    errorEl.textContent = 'JSON 格式错误: ' + e.message;
  }
}

function markSynced() {
  const status = document.getElementById('sync-status');
  if (status) {
    status.textContent = '已同步';
    status.className = 'sync-status synced';
  }
}

async function handleDetailBrowse() {
  const workingDirInput = document.getElementById('detail-working-dir');

  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择启动目录'
    });
    if (selected) {
      workingDirInput.value = selected;
      markUnsynced();
    }
  } catch (err) {
    console.error('选择目录失败:', err);
  }
}

async function handleSave() {
  await saveCurrentConfig(true);
}

async function saveCurrentConfig(closeAfter = true) {
  if (!currentEditingModel) return false;

  const display_name = document.getElementById('detail-display-name').value.trim();
  const alias = document.getElementById('detail-alias').value.trim();
  if (!alias) {
    showToast('请输入运行简称');
    return false;
  }
  if (/[㐀-鿿豈-﫿]/.test(alias)) {
    showToast('运行简称不能包含中文');
    return false;
  }

  const model_id = document.getElementById('detail-model-id').value;
  const haiku_model = document.getElementById('detail-haiku-model').value;
  const opus_model = document.getElementById('detail-opus-model').value;
  const sonnet_model = document.getElementById('detail-sonnet-model').value;
  const api_key = document.getElementById('detail-api-key').value.trim();
  const base_url = document.getElementById('detail-base-url').value.trim();
  const mode = document.getElementById('detail-mode').value;
  const working_dir = document.getElementById('detail-working-dir').value;
  const finalDisplayName = display_name || alias;

  if (!api_key) {
    showToast('Key / Token 不能为空');
    return false;
  }
  if (!base_url) {
    showToast('Base URL 不能为空');
    return false;
  }
  if (!model_id && !haiku_model && !opus_model && !sonnet_model) {
    showToast('至少需要填写一个模型 ID');
    return false;
  }

  const configEditor = document.getElementById('detail-config-editor');
  const errorEl = document.getElementById('config-parse-error');
  const rawText = configEditor ? configEditor.value : '';
  let raw_json = '';
  if (rawText.trim()) {
    try {
      const parsed = JSON.parse(rawText);
      // 根据当前"导入通用配置"勾选状态，注入或清理 cc_start.import_common_config 元信息。
      // 这里以 _importCommonEnabled 为准（受 toggle change 事件维护），保存时再写到 JSON。
      // _originalJson 已在 openEditForModel 中剥离了 cc_start，所以编辑器里看不到这个字段，
      // 但保存时仍然会把它写回模型配置文件，让下次打开时恢复"已导入"状态。
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const importEnabled = !!currentEditingModel._importCommonEnabled;
        if (importEnabled) {
          if (!parsed.cc_start || typeof parsed.cc_start !== 'object' || Array.isArray(parsed.cc_start)) {
            parsed.cc_start = {};
          }
          parsed.cc_start.import_common_config = true;
        } else if (parsed.cc_start && typeof parsed.cc_start === 'object' && !Array.isArray(parsed.cc_start)) {
          delete parsed.cc_start.import_common_config;
          if (Object.keys(parsed.cc_start).length === 0) {
            delete parsed.cc_start;
          }
        }
        raw_json = JSON.stringify(parsed, null, 2);
      } else {
        raw_json = rawText;
      }
      if (errorEl) errorEl.textContent = '';
    } catch (e) {
      if (errorEl) errorEl.textContent = 'JSON 格式错误: ' + e.message;
      showToast('原始配置 JSON 格式错误，请先修正');
      return false;
    }
  }

  try {
    await invoke('save_model_config', {
      params: {
        alias,
        display_name: finalDisplayName,
        model_id,
        haiku_model,
        opus_model,
        sonnet_model,
        auth_value: api_key,
        auth_mode: currentEditingModel._authMode || 'AUTH_TOKEN',
        base_url,
        working_dir,
        mode,
        raw_json,
        original_alias: currentEditingModel._originalAlias,
      }
    });

    const previousAlias = currentEditingModel._originalAlias;
    currentEditingModel.display_name = finalDisplayName;
    currentEditingModel.alias = alias;
    currentEditingModel.model_id = model_id;
    currentEditingModel.haiku_model = haiku_model;
    currentEditingModel.opus_model = opus_model;
    currentEditingModel.sonnet_model = sonnet_model;
    currentEditingModel.api_key = api_key;
    currentEditingModel._isNew = false;
    currentEditingModel._originalAlias = alias;

    if (previousAlias === null) {
      models.push({ ...currentEditingModel });
      // 新增配置：unshift 到 custom_order，让它出现在普通区顶部
      const nextOrder = Array.isArray(prefs.custom_order) ? [...prefs.custom_order] : [];
      const existingIdx = nextOrder.indexOf(alias);
      if (existingIdx >= 0) nextOrder.splice(existingIdx, 1);
      nextOrder.unshift(alias);
      try {
        await persistPrefs({ custom_order: nextOrder });
      } catch (err) {
        console.error('更新 custom_order 失败:', err);
      }
    } else {
      const index = models.findIndex(m => m.alias === previousAlias);
      if (index !== -1) {
        models[index] = { ...currentEditingModel };
      }
    }

    const displayNameInput = document.getElementById('detail-display-name');
    if (displayNameInput) {
      displayNameInput.value = finalDisplayName;
    }

    await loadModels();
    if (closeAfter) {
      showToast('保存成功');
      showListPage();
    }
    return true;
  } catch (err) {
    showToast('保存失败: ' + err);
    return false;
  }
}

function hideDetailPage() {
  showListPage();
}

// ====== 通用配置：合并辅助 ======

// 深度合并，冲突时 overlay（通用配置）优先；普通值/数组由 overlay 覆盖。
function deepMergeCommonPriority(base, overlay) {
  if (overlay === null || overlay === undefined) return base;
  if (typeof overlay !== 'object' || Array.isArray(overlay)) return overlay;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return overlay;

  const result = { ...base };
  for (const key of Object.keys(overlay)) {
    if (key in result) {
      result[key] = deepMergeCommonPriority(result[key], overlay[key]);
    } else {
      result[key] = overlay[key];
    }
  }
  return result;
}

// 反向合并：base（已有通用配置）优先，candidate 只补充 base 中缺失的键。
function deepMergeKeepExisting(base, candidate) {
  if (candidate === null || candidate === undefined) return base;
  if (typeof candidate !== 'object' || Array.isArray(candidate)) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return base;

  const result = { ...base };
  for (const key of Object.keys(candidate)) {
    if (key in result) {
      result[key] = deepMergeKeepExisting(result[key], candidate[key]);
    } else {
      result[key] = candidate[key];
    }
  }
  return result;
}

// 兜底：找不到快照时，按通用配置字段从合并预览里删除（best-effort）。
function stripOverlayFields(target, overlay) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return target;
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) return target;

  const result = { ...target };
  for (const key of Object.keys(overlay)) {
    const bothObj = overlay[key] && typeof overlay[key] === 'object' && !Array.isArray(overlay[key])
      && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]);
    if (bothObj) {
      result[key] = stripOverlayFields(result[key], overlay[key]);
      if (Object.keys(result[key]).length === 0) {
        delete result[key];
      }
    } else {
      delete result[key];
    }
  }
  return result;
}

// ====== 详情页：导入通用配置开关 ======

async function handleImportCommonToggle(e) {
  const toggle = e.target;
  const checked = toggle.checked;
  const editor = document.getElementById('detail-config-editor');
  const errorEl = document.getElementById('config-parse-error');
  if (!editor || !currentEditingModel) return;

  const rawText = editor.value;
  let baseJson;
  try {
    baseJson = JSON.parse(rawText || '{}');
  } catch (err) {
    toggle.checked = !checked; // 撤销切换
    if (errorEl) errorEl.textContent = 'JSON 格式错误: ' + err.message;
    showToast('请先修正原始配置 JSON 格式');
    return;
  }

  if (checked) {
    // 打开：保存快照，读取最新通用配置，合并写回编辑器
    currentEditingModel._preImportSnapshot = rawText;
    let commonJson;
    try {
      const commonText = await invoke('get_common_config');
      commonJson = JSON.parse(commonText || '{}');
    } catch (err) {
      toggle.checked = false;
      currentEditingModel._preImportSnapshot = null;
      showToast('读取通用配置失败: ' + err);
      return;
    }
    const merged = deepMergeCommonPriority(baseJson, commonJson);
    const mergedText = JSON.stringify(merged, null, 2);
    currentEditingModel._importCommonEnabled = true;
    setConfigEditorText(mergedText);
    handleConfigTextChange();
    markUnsynced();
  } else {
    // 关闭：优先恢复快照
    const snapshot = currentEditingModel._preImportSnapshot;
    if (snapshot !== null && snapshot !== undefined) {
      setConfigEditorText(snapshot);
      currentEditingModel._preImportSnapshot = null;
      currentEditingModel._importCommonEnabled = false;
      handleConfigTextChange();
      markUnsynced();
    } else {
      // 兜底：按通用配置字段从预览里删除
      try {
        const commonText = await invoke('get_common_config');
        const commonJson = JSON.parse(commonText || '{}');
        const stripped = stripOverlayFields(baseJson, commonJson);
        setConfigEditorText(JSON.stringify(stripped, null, 2));
        currentEditingModel._importCommonEnabled = false;
        handleConfigTextChange();
        markUnsynced();
      } catch (err) {
        currentEditingModel._importCommonEnabled = false;
        showToast('恢复失败: ' + err);
      }
    }
  }
}

async function regenerateImportPreview() {
  if (!currentEditingModel) return;
  const snapshot = currentEditingModel._preImportSnapshot;
  if (snapshot === null || snapshot === undefined) return;
  try {
    const baseJson = JSON.parse(snapshot);
    const commonText = await invoke('get_common_config');
    const commonJson = JSON.parse(commonText || '{}');
    const merged = deepMergeCommonPriority(baseJson, commonJson);
    setConfigEditorText(JSON.stringify(merged, null, 2));
    handleConfigTextChange();
    markUnsynced();
  } catch (err) {
    showToast('刷新预览失败: ' + err);
  }
}

// 打开详情页时，若上次保存为"已导入通用配置"，自动把最新通用配置合并到预览中。
// 不设置 _preImportSnapshot：用户取消勾选时走 stripOverlayFields 路径，按当前
// 通用配置键精确删除，与用户"勾选时通用赢、取消时通用键直接删除"的语义一致。
async function applyImportOnOpenIfNeeded() {
  if (!currentEditingModel || !currentEditingModel._importCommonEnabled) return;
  const editor = document.getElementById('detail-config-editor');
  if (!editor) return;

  const importToggle = document.getElementById('detail-import-common-toggle');
  if (importToggle) importToggle.checked = true;

  let baseJson;
  try {
    baseJson = JSON.parse(editor.value || '{}');
  } catch (err) {
    return;
  }

  let commonJson;
  try {
    const commonText = await invoke('get_common_config');
    commonJson = JSON.parse(commonText || '{}');
  } catch (err) {
    showToast('读取通用配置失败: ' + err);
    return;
  }

  currentEditingModel._preImportSnapshot = null;
  const merged = deepMergeCommonPriority(baseJson, commonJson);
  setConfigEditorText(JSON.stringify(merged, null, 2));
  handleConfigTextChange();
  markUnsynced();
}

async function handleEditCommonClick() {
  returnToDetailAfterCommonEdit = true;
  await openCommonConfigPage();
}

// ====== 通用配置编辑页 ======

async function openCommonConfigPage() {
  try {
    const text = await invoke('get_common_config');
    currentCommonConfigText = (text && text.trim()) ? text : '{}';
  } catch (err) {
    showToast('读取通用配置失败: ' + err);
    currentCommonConfigText = '{}';
  }
  showCommonConfigPage();
}

function showCommonConfigPage() {
  currentView = 'common-config';
  container.style.display = 'none';
  detailPage.style.display = 'none';
  settingsPage.style.display = 'none';
  commonConfigPage.style.display = 'block';
  renderCommonConfigPage();
}

function renderCommonConfigPage() {
  commonConfigContent.innerHTML = `
    <div class="detail-form common-config-form">
      <div class="form-group">
        <div class="config-header-row">
          <label class="form-label">通用 JSON 配置</label>
          <div class="config-header-actions">
            <button type="button" class="config-header-link" id="extract-from-settings-btn">从 settings.json 提取</button>
            <button type="button" class="config-header-link" id="extract-from-current-btn">从当前配置提取</button>
            <label class="config-wrap-toggle"><input type="checkbox" id="common-config-wrap-toggle"> 自动换行</label>
          </div>
        </div>
        <div class="config-editor-shell" id="common-config-shell">
          <div class="config-line-numbers" id="common-config-lines">1</div>
          <div class="config-editor-stack">
            <pre class="config-editor-highlight" id="common-config-highlight" aria-hidden="true"></pre>
            <textarea class="config-editor-input" id="common-config-editor" spellcheck="false"></textarea>
          </div>
        </div>
        <div class="config-error" id="common-config-error"></div>
        <div class="common-config-hint">通用配置文件位置：~/.claude/cc_start_common_config.json</div>
      </div>
      <div class="common-config-footer">
        <button type="button" class="btn-save btn-save-compact" id="save-common-config-btn">保存通用配置</button>
      </div>
    </div>
  `;

  setCommonConfigEditorText(currentCommonConfigText);
  bindCommonConfigEvents();
}

function setCommonConfigEditorText(text) {
  setConfigEditorText(text, 'common-config');
}

function validateCommonConfigJson(text) {
  const errEl = document.getElementById('common-config-error');
  try {
    JSON.parse(text || '{}');
    if (errEl) errEl.textContent = '';
    return true;
  } catch (e) {
    if (errEl) errEl.textContent = 'JSON 格式错误: ' + e.message;
    return false;
  }
}

function bindCommonConfigEvents() {
  const editor = document.getElementById('common-config-editor');
  const saveBtn = document.getElementById('save-common-config-btn');
  const extractBtn = document.getElementById('extract-from-current-btn');
  const wrapToggle = document.getElementById('common-config-wrap-toggle');

  if (editor) {
    editor.addEventListener('input', () => {
      syncConfigEditorLayout('common-config');
      validateCommonConfigJson(editor.value);
    });
    editor.addEventListener('scroll', () => syncConfigEditorLayout('common-config'));
    editor.addEventListener('click', () => syncConfigEditorLayout('common-config'));
    editor.addEventListener('keyup', () => syncConfigEditorLayout('common-config'));
  }
  if (wrapToggle) {
    wrapToggle.addEventListener('change', () => syncConfigEditorLayout('common-config'));
  }
  if (saveBtn) saveBtn.addEventListener('click', handleSaveCommonConfig);
  if (extractBtn) extractBtn.addEventListener('click', handleExtractFromCurrent);

  const extractFromSettingsBtn = document.getElementById('extract-from-settings-btn');
  if (extractFromSettingsBtn) extractFromSettingsBtn.addEventListener('click', handleExtractFromSettings);
}

async function handleSaveCommonConfig() {
  const editor = document.getElementById('common-config-editor');
  if (!editor) return;
  const text = editor.value || '{}';
  if (!validateCommonConfigJson(text)) {
    showToast('JSON 格式错误，请先修正');
    return;
  }
  try {
    await invoke('save_common_config', { content: text });
    currentCommonConfigText = text;
    showToast('通用配置已保存');
  } catch (err) {
    showToast('保存失败: ' + err);
  }
}

async function handleExtractFromCurrent() {
  const detailEditor = document.getElementById('detail-config-editor');
  const rawJson = detailEditor ? (detailEditor.value || '') : '';
  if (!rawJson.trim()) {
    showToast('当前没有可提取的原始配置');
    return;
  }
  let candidate;
  try {
    const candidateText = await invoke('extract_common_config_from_raw', { rawJson });
    candidate = JSON.parse(candidateText || '{}');
  } catch (err) {
    showToast('提取失败: ' + err);
    return;
  }

  const commonEditor = document.getElementById('common-config-editor');
  if (!commonEditor) return;
  let existingJson;
  try {
    existingJson = JSON.parse(commonEditor.value || '{}');
  } catch (e) {
    showToast('当前通用配置 JSON 格式错误，请先修正');
    return;
  }

  const merged = deepMergeKeepExisting(existingJson, candidate);
  const mergedText = JSON.stringify(merged, null, 2);
  setCommonConfigEditorText(mergedText);
  validateCommonConfigJson(mergedText);
  showToast('已合并候选字段到编辑器（未保存）');
}

// 从 ~/.claude/settings.json 提取候选通用配置，并以"已有键不覆盖"的方式
// 合并到当前编辑器内容；保存仍需用户点击保存按钮，与"从当前配置提取"语义一致。
async function handleExtractFromSettings() {
  let candidate;
  try {
    const candidateText = await invoke('extract_common_config_from_settings');
    candidate = JSON.parse(candidateText || '{}');
  } catch (err) {
    showToast('提取失败: ' + err);
    return;
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || Object.keys(candidate).length === 0) {
    showToast('未发现可复用通用配置');
    return;
  }

  const commonEditor = document.getElementById('common-config-editor');
  if (!commonEditor) return;
  let existingJson;
  try {
    existingJson = JSON.parse(commonEditor.value || '{}');
  } catch (e) {
    showToast('当前通用配置 JSON 格式错误，请先修正');
    return;
  }

  const merged = deepMergeKeepExisting(existingJson, candidate);
  const mergedText = JSON.stringify(merged, null, 2);
  setCommonConfigEditorText(mergedText);
  validateCommonConfigJson(mergedText);
  showToast('已从 settings.json 合并候选字段（未保存）');
}

async function handleCommonConfigBack() {
  if (returnToDetailAfterCommonEdit && currentEditingModel) {
    returnToDetailAfterCommonEdit = false;
    showDetailPage();
  } else {
    showListPage();
  }
}

backBtn.addEventListener('click', hideDetailPage);
settingsBackBtn.addEventListener('click', showListPage);
settingsBtn.addEventListener('click', showSettingsPage);
if (commonConfigBackBtn) {
  commonConfigBackBtn.addEventListener('click', handleCommonConfigBack);
}

document.getElementById('open-models-dir-btn').addEventListener('click', async () => {
  try {
    await invoke('open_models_dir');
  } catch (err) {
    showToast('打开配置文件夹失败: ' + err);
  }
});

searchBox.addEventListener('input', (e) => {
  renderConfigList(e.target.value);
});

addConfigBtn.addEventListener('click', () => {
  currentEditingModel = {
    alias: '',
    model_id: '',
    haiku_model: '',
    opus_model: '',
    sonnet_model: '',
    api_key: '',
    auth_token: '',
    base_url: '',
    mode: 'normal',
    working_dir: '',
    _originalAlias: null,
    _isNew: true,
    _authMode: 'AUTH_TOKEN',
    _originalJson: {},
    _importCommonEnabled: false,
    _preImportSnapshot: null
  };
  showDetailPage();
});

window.addEventListener('DOMContentLoaded', async () => {
  await loadPrefs();
  await loadModels();
});
