const invoke = window.__TAURI__.core.invoke;
const open = window.__TAURI__.dialog.open;
const confirmDialog = window.__TAURI__.dialog.confirm;

let models = [];
let currentView = 'list';
let currentEditingModel = null;
let prefs = {
  remember_model: true,
  last_alias: ''
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
const toast = document.getElementById('toast');
const container = document.querySelector('.container');

function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

async function loadPrefs() {
  try {
    prefs = await invoke('get_prefs');
  } catch (e) {
    console.error('加载偏好失败:', e);
    prefs = {
      remember_model: true,
      last_alias: ''
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

  if (filteredModels.length === 0) {
    configList.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  configList.innerHTML = filteredModels.map((m, index) => `
    <div class="config-row ${lastAlias && m.alias === lastAlias ? 'last-launched' : ''}" data-index="${index}" data-alias="${m.alias}">
      <div class="config-row-left">
        <div class="config-info">
          <div class="config-display-name">${m.display_name || m.alias}</div>
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
          <select class="mode-select" data-field="mode">
            <option value="normal" ${(m.mode || 'normal') === 'normal' ? 'selected' : ''}>普通启动</option>
            <option value="skip-permissions" ${m.mode === 'skip-permissions' ? 'selected' : ''}>跳过权限确认</option>
          </select>
        </div>
        <div class="config-buttons">
          <button type="button" class="btn-copy" data-action="copy" title="复制">复制</button>
          <button type="button" class="btn-edit" data-action="edit">修改</button>
          <button type="button" class="btn-launch" data-action="launch">启动</button>
        </div>
      </div>
    </div>
  `).join('');

  bindConfigRowEvents();

  if (lastAlias) {
    const activeRow = configList.querySelector(`.config-row[data-alias="${CSS.escape(lastAlias)}"]`);
    if (activeRow) {
      activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function bindConfigRowEvents() {
  document.querySelectorAll('[data-action="launch"]').forEach(btn => btn.addEventListener('click', handleLaunch));
  document.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', handleEdit));
  document.querySelectorAll('[data-action="copy"]').forEach(btn => btn.addEventListener('click', handleDuplicate));
  document.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', handleDelete));
  document.querySelectorAll('[data-action="browse"]').forEach(btn => btn.addEventListener('click', handleBrowse));
  document.querySelectorAll('.config-alias-input, .path-input, .mode-select').forEach(input => {
    input.addEventListener('change', handleFieldChange);
  });
}

function getRowData(row) {
  const index = parseInt(row.dataset.index);
  const model = models[index];
  const alias = row.querySelector('[data-field="alias"]').value;
  const mode = row.querySelector('[data-field="mode"]').value;
  const working_dir = row.querySelector('[data-field="working_dir"]').value;

  return {
    ...model,
    alias,
    mode,
    working_dir
  };
}

async function handleFieldChange(e) {
  const row = e.target.closest('.config-row');
  if (!row) return;

  const rowData = getRowData(row);
  const originalModel = models[parseInt(row.dataset.index)];
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
  const index = parseInt(row.dataset.index);
  const model = models[index];
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

  currentEditingModel = {
    ...model,
    api_key: apiKeyValue,
    _originalAlias: model.alias,
    _authMode: model.auth_mode || 'AUTH_TOKEN',
    _isNew: false,
    _originalJson: originalJson,
    haiku_model: model.haiku_model || '',
    opus_model: model.opus_model || '',
    sonnet_model: model.sonnet_model || ''
  };
  showDetailPage();
}

async function handleDuplicate(e) {
  const row = e.target.closest('.config-row');
  const index = parseInt(row.dataset.index);
  const model = models[index];
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
  const index = parseInt(row.dataset.index);
  const model = models[index];
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

function isConfigWrapEnabled() {
  const wrapToggle = document.getElementById('detail-config-wrap-toggle');
  return Boolean(wrapToggle?.checked);
}

function syncConfigWrapMode() {
  const shell = document.querySelector('.config-editor-shell');
  const editor = document.getElementById('detail-config-editor');
  if (!shell || !editor) return false;

  const wrapEnabled = isConfigWrapEnabled();
  shell.classList.toggle('wrap-enabled', wrapEnabled);
  editor.wrap = wrapEnabled ? 'soft' : 'off';
  return wrapEnabled;
}

function syncConfigEditorLayout() {
  const editor = document.getElementById('detail-config-editor');
  const lineNumbers = document.getElementById('detail-config-lines');
  const highlight = document.getElementById('detail-config-highlight');
  if (!editor || !lineNumbers || !highlight) return;

  const wrapEnabled = syncConfigWrapMode();
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

function setConfigEditorText(text) {
  const editor = document.getElementById('detail-config-editor');
  if (!editor) return;

  if (editor.value !== text) {
    editor.value = text;
  }

  requestAnimationFrame(() => {
    syncConfigEditorLayout();
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
        <label class="config-wrap-toggle"><input type="checkbox" id="detail-config-wrap-toggle"> 自动换行</label>
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
}

function showDetailPage() {
  currentView = 'detail';
  container.style.display = 'none';
  settingsPage.style.display = 'none';
  detailPage.style.display = 'block';
  renderDetailForm();
}

function renderSettingsPage() {
  settingsContent.innerHTML = `
    <div class="settings-card">
      <h3 class="settings-section-title">显示</h3>
      <label class="settings-checkbox"><input type="checkbox" id="remember-model" ${prefs.remember_model ? 'checked' : ''}> 高亮上次启动的配置</label>
    </div>

    <div class="settings-card">
      <h3 class="settings-section-title">快捷操作</h3>
      <div class="settings-actions">
        <button type="button" class="btn-edit" id="open-models-dir-btn">打开配置文件夹</button>
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
}

function bindSettingsEvents() {
  const rememberModel = document.getElementById('remember-model');
  const openModelsDirBtn = document.getElementById('open-models-dir-btn');

  rememberModel.addEventListener('change', async () => {
    const next = rememberModel.checked;
    await persistPrefs({ remember_model: next, last_alias: next ? prefs.last_alias : '' });
    renderConfigList(searchBox.value || '');
    showToast('设置已保存');
  });

  openModelsDirBtn.addEventListener('click', async () => {
    try {
      await invoke('open_models_dir');
    } catch (err) {
      showToast('打开配置文件夹失败: ' + err);
    }
  });
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

function showSettingsPage() {
  currentView = 'settings';
  container.style.display = 'none';
  detailPage.style.display = 'none';
  settingsPage.style.display = 'block';
  renderSettingsPage();
}

function showListPage() {
  currentView = 'list';
  currentEditingModel = null;
  detailPage.style.display = 'none';
  settingsPage.style.display = 'none';
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
  setOrDel('ANTHROPIC_MODEL', currentEditingModel.model_id);
  setOrDel('ANTHROPIC_DEFAULT_HAIKU_MODEL', currentEditingModel.haiku_model);
  setOrDel('ANTHROPIC_DEFAULT_OPUS_MODEL', currentEditingModel.opus_model);
  setOrDel('ANTHROPIC_DEFAULT_SONNET_MODEL', currentEditingModel.sonnet_model);

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
      JSON.parse(rawText);
      raw_json = rawText;
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

backBtn.addEventListener('click', hideDetailPage);
settingsBackBtn.addEventListener('click', showListPage);
settingsBtn.addEventListener('click', showSettingsPage);

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
    _originalJson: {}
  };
  showDetailPage();
});

window.addEventListener('DOMContentLoaded', async () => {
  await loadPrefs();
  await loadModels();
});
