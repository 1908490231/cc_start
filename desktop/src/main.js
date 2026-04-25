const invoke = window.__TAURI__.core.invoke;
const open = window.__TAURI__.dialog.open;
const confirmDialog = window.__TAURI__.dialog.confirm;

// 状态
let models = [];
let currentView = 'list'; // 'list' | 'detail'
let currentEditingModel = null;

// DOM 元素
const configList = document.getElementById('config-list');
const emptyState = document.getElementById('empty-state');
const searchBox = document.getElementById('search-box');
const addConfigBtn = document.getElementById('add-config-btn');
const detailPage = document.getElementById('detail-page');
const detailForm = document.getElementById('detail-form');
const backBtn = document.getElementById('back-btn');
const toast = document.getElementById('toast');

// 显示 toast
function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// 加载模型列表
async function loadModels() {
  try {
    models = await invoke('list_models');
    renderConfigList();
  } catch (e) {
    console.error('加载模型失败:', e);
    showToast('加载模型失败: ' + e);
  }
}

// 渲染配置列表
function renderConfigList(filter = '') {
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
    <div class="config-row" data-index="${index}">
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
          <button type="button" class="btn-edit" data-action="edit">修改</button>
          <button type="button" class="btn-launch" data-action="launch">启动</button>
        </div>
      </div>
    </div>
  `).join('');

  // 绑定事件
  bindConfigRowEvents();
}

// 绑定配置行事件
function bindConfigRowEvents() {
  // 启动按钮
  document.querySelectorAll('[data-action="launch"]').forEach(btn => {
    btn.addEventListener('click', handleLaunch);
  });

  // 修改按钮
  document.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', handleEdit);
  });

  // 删除按钮
  document.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', handleDelete);
  });

  // 浏览按钮
  document.querySelectorAll('[data-action="browse"]').forEach(btn => {
    btn.addEventListener('click', handleBrowse);
  });

  // 字段变更（简称、路径、模式）
  document.querySelectorAll('.config-alias-input, .path-input, .mode-select').forEach(input => {
    input.addEventListener('change', handleFieldChange);
  });
}

// 获取配置行数据
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

// 字段变更处理
function handleFieldChange(e) {
  // 目前只记录变更，暂不自动保存
  console.log('字段变更:', e.target.dataset.field, '=', e.target.value);
}

// 启动处理
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
    showToast(`已启动 ${rowData.alias}`);
  } catch (err) {
    showToast(`启动失败: ${err}`);
  }
}

// 修改按钮处理
function handleEdit(e) {
  const row = e.target.closest('.config-row');
  const index = parseInt(row.dataset.index);
  const model = models[index];

  // 根据 auth_mode 设置 api_key 的实际值
  const apiKeyValue = model.auth_mode === 'API_KEY' ? model.api_key : (model.auth_token || model.api_key);

  // 解析原始 JSON 以便后续只更新修改的字段
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
    _isNew: false, // 已有配置
    _originalJson: originalJson, // 原始 JSON 对象
    haiku_model: model.haiku_model || '',
    opus_model: model.opus_model || '',
    sonnet_model: model.sonnet_model || ''
  };
  showDetailPage();
}

// 删除按钮处理（软删除到 ~/.claude/models/.trash/）
async function handleDelete(e) {
  const row = e.target.closest('.config-row');
  const index = parseInt(row.dataset.index);
  const model = models[index];
  if (!model || !model.alias) return;

  const label = model.display_name || model.alias;
  // 二次确认（用 Tauri plugin-dialog 的 confirm，原生 window.confirm 在 webview 中被禁用）
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

// 浏览按钮处理
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
    }
  } catch (err) {
    console.error('选择目录失败:', err);
  }
}

// 显示详情页
function showDetailPage() {
  currentView = 'detail';
  document.querySelector('.container').style.display = 'none';
  detailPage.style.display = 'block';
  renderDetailForm();
}

// 渲染详情页表单
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
      <input type="text" class="form-input" id="detail-model-id"
        value="${currentEditingModel.model_id || ''}"
        placeholder="主模型 ID" />
      <input type="text" class="form-input" id="detail-haiku-model"
        value="${currentEditingModel.haiku_model || ''}"
        placeholder="HAIKU 模型" style="margin-top:8px;" />
      <input type="text" class="form-input" id="detail-opus-model"
        value="${currentEditingModel.opus_model || ''}"
        placeholder="OPUS 模型" style="margin-top:8px;" />
      <input type="text" class="form-input" id="detail-sonnet-model"
        value="${currentEditingModel.sonnet_model || ''}"
        placeholder="SONNET 模型" style="margin-top:8px;" />
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
      <label class="form-label">原始配置</label>
      <pre class="config-editable" id="detail-config-display"
        contenteditable="true" spellcheck="false"></pre>
      <textarea class="config-raw" id="detail-config-raw"
        style="display:none;"></textarea>
      <div class="config-error" id="config-parse-error"></div>
      <div class="sync-status" id="sync-status"></div>
    </div>
  `;

  // 保存按钮放在 footer 区域
  detailForm.innerHTML += `
    <div class="detail-footer">
      <button type="button" class="btn-save" id="save-btn">保存</button>
    </div>
  `;

  // 初始化配置文本
  updateConfigText();
  bindDetailEvents();
}

// 绑定详情页事件
function bindDetailEvents() {
  const saveBtn = document.getElementById('save-btn');
  const browseBtn = document.getElementById('detail-browse-btn');
  const configDisplay = document.getElementById('detail-config-display');
  const toggleBtn = document.getElementById('toggle-api-key');
  const apiKeyInput = document.getElementById('detail-api-key');

  saveBtn.addEventListener('click', handleSave);
  browseBtn.addEventListener('click', handleDetailBrowse);

  // API Key 显示/隐藏切换
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

  // 配置文本变更检测（监听 contenteditable pre 的输入）
  configDisplay.addEventListener('input', debounce(handleConfigTextChange, 500));
  configDisplay.addEventListener('blur', debounce(handleConfigTextChange, 200));
  // 初始调整高度
  autoResizePre(configDisplay);

  // 基础字段变更时标记未同步并更新 JSON 显示
  ['detail-display-name', 'detail-alias', 'detail-model-id', 'detail-api-key',
   'detail-base-url', 'detail-mode', 'detail-working-dir',
   'detail-haiku-model', 'detail-opus-model', 'detail-sonnet-model'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        // 更新内存数据
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
        // 更新 JSON 显示
        updateConfigText();
        markUnsynced();
      });
    }
  });

  // AUTH_TOKEN / API_KEY 下拉框变更
  const authSelect = document.getElementById('detail-auth-mode');
  if (authSelect) {
    authSelect.addEventListener('change', () => {
      currentEditingModel._authMode = authSelect.value;
      updateConfigText();
      markUnsynced();
    });
  }
}

// 防抖
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 标记未同步
function markUnsynced() {
  const status = document.getElementById('sync-status');
  if (status) {
    status.textContent = '未同步';
    status.className = 'sync-status unsynced';
  }
}

// 基于当前内存态构建配置 JSON 对象
// 以 _originalJson 为底深拷贝（保留所有未知字段），再覆盖已知字段
function buildConfigJson() {
  const hasOriginal = currentEditingModel._originalJson
    && Object.keys(currentEditingModel._originalJson).length > 0;

  // 深拷贝，避免修改 _originalJson 引发的同步问题
  const json = hasOriginal
    ? JSON.parse(JSON.stringify(currentEditingModel._originalJson))
    : {};

  // 顶层非 env 字段
  if (currentEditingModel.display_name) {
    json.display_name = currentEditingModel.display_name;
  } else {
    delete json.display_name;
  }

  if (currentEditingModel.working_dir) {
    json.working_dir = currentEditingModel.working_dir;
  } else {
    delete json.working_dir;
  }

  // mode：仅 skip-permissions 写入
  if (currentEditingModel.mode === 'skip-permissions') {
    json.mode = currentEditingModel.mode;
  } else {
    delete json.mode;
  }

  // env 对象
  if (!json.env) json.env = {};

  // 4 个模型字段：有值写入，空则删除
  const setOrDel = (key, val) => {
    if (val) json.env[key] = val;
    else delete json.env[key];
  };
  setOrDel('ANTHROPIC_MODEL', currentEditingModel.model_id);
  setOrDel('ANTHROPIC_DEFAULT_HAIKU_MODEL', currentEditingModel.haiku_model);
  setOrDel('ANTHROPIC_DEFAULT_OPUS_MODEL', currentEditingModel.opus_model);
  setOrDel('ANTHROPIC_DEFAULT_SONNET_MODEL', currentEditingModel.sonnet_model);

  // AUTH：只写入用户选择的那个，另一个清掉
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

  // BASE_URL
  setOrDel('ANTHROPIC_BASE_URL', currentEditingModel.base_url);

  return json;
}

// 更新配置文本框
function updateConfigText() {
  const configDisplay = document.getElementById('detail-config-display');
  if (!configDisplay || !currentEditingModel) return;

  const json = buildConfigJson();
  const jsonStr = JSON.stringify(json, null, 2);

  // 显示高亮
  configDisplay.innerHTML = syntaxHighlight(jsonStr);
  autoResizePre(configDisplay);

  const status = document.getElementById('sync-status');
  if (status) {
    status.textContent = '已同步';
    status.className = 'sync-status synced';
  }
}

// JSON 语法高亮
function syntaxHighlight(json) {
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

// 自动调整 pre 高度
function autoResizePre(pre) {
  if (!pre) return;
  pre.style.height = 'auto';
  pre.style.height = pre.scrollHeight + 'px';
}

// 自动调整 textarea 高度
function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
  textarea.style.overflow = 'hidden';
}

// 配置文本变更处理
function handleConfigTextChange() {
  const configDisplay = document.getElementById('detail-config-display');
  const configRaw = document.getElementById('detail-config-raw');
  const errorEl = document.getElementById('config-parse-error');

  // 从 contenteditable pre 获取纯文本内容
  const rawText = configDisplay.innerText || configDisplay.textContent || '';

  try {
    const parsed = JSON.parse(rawText);

    // 存储原始 JSON 文本
    configRaw.value = rawText;

    // 把 parsed 作为新的 _originalJson 基础，保留用户粘贴的所有未知字段
    currentEditingModel._originalJson = parsed;

    // 同步已知字段到 currentEditingModel（保证 buildConfigJson 使用最新值）
    if (parsed.display_name !== undefined) {
      currentEditingModel.display_name = parsed.display_name || '';
      const el = document.getElementById('detail-display-name');
      if (el) el.value = currentEditingModel.display_name;
    }
    if (parsed.env) {
      currentEditingModel.model_id = parsed.env.ANTHROPIC_MODEL || '';
      currentEditingModel.haiku_model = parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '';
      currentEditingModel.opus_model = parsed.env.ANTHROPIC_DEFAULT_OPUS_MODEL || '';
      currentEditingModel.sonnet_model = parsed.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
      currentEditingModel.api_key = parsed.env.ANTHROPIC_AUTH_TOKEN || parsed.env.ANTHROPIC_API_KEY || '';
      currentEditingModel._authMode = parsed.env.ANTHROPIC_AUTH_TOKEN ? 'AUTH_TOKEN' : 'API_KEY';
      currentEditingModel.base_url = parsed.env.ANTHROPIC_BASE_URL || '';

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
    }
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
    markSynced();

    // 更新显示的高亮 JSON
    configDisplay.innerHTML = syntaxHighlight(rawText);
  } catch (e) {
    errorEl.textContent = 'JSON 格式错误: ' + e.message;
  }
}

// 标记已同步
function markSynced() {
  const status = document.getElementById('sync-status');
  if (status) {
    status.textContent = '已同步';
    status.className = 'sync-status synced';
  }
}

// 详情页浏览按钮
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

// 保存处理
async function handleSave() {
  if (!currentEditingModel) return;

  // 收集字段值
  const display_name = document.getElementById('detail-display-name').value.trim();
  const alias = document.getElementById('detail-alias').value.trim();
  if (!alias) {
    showToast('请输入运行简称');
    return;
  }

  const model_id = document.getElementById('detail-model-id').value;
  const haiku_model = document.getElementById('detail-haiku-model').value;
  const opus_model = document.getElementById('detail-opus-model').value;
  const sonnet_model = document.getElementById('detail-sonnet-model').value;
  const api_key = document.getElementById('detail-api-key').value;
  const base_url = document.getElementById('detail-base-url').value.trim();
  const mode = document.getElementById('detail-mode').value;
  const working_dir = document.getElementById('detail-working-dir').value;

  // 校验
  if (!base_url) {
    showToast('Base URL 不能为空');
    return;
  }
  if (!model_id && !haiku_model && !opus_model && !sonnet_model) {
    showToast('至少需要填写一个模型 ID');
    return;
  }

  // 取文本框当前内容作为 raw_json，让后端保留所有未知字段
  // 仅当解析合法时才传，非法时退回让后端用现有文件作基础
  const configDisplay = document.getElementById('detail-config-display');
  const errorEl = document.getElementById('config-parse-error');
  const rawText = configDisplay ? (configDisplay.innerText || configDisplay.textContent || '') : '';
  let raw_json = '';
  if (rawText.trim()) {
    try {
      JSON.parse(rawText);
      raw_json = rawText;
      if (errorEl) errorEl.textContent = '';
    } catch (e) {
      if (errorEl) errorEl.textContent = 'JSON 格式错误: ' + e.message;
      showToast('原始配置 JSON 格式错误，请先修正');
      return;
    }
  }

  // 调用 Rust 保存
  try {
    await invoke('save_model_config', {
      params: {
        alias,
        display_name,
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
      }
    });

    // 更新本地数据
    currentEditingModel.display_name = display_name;
    currentEditingModel.alias = alias;
    currentEditingModel.model_id = model_id;
    currentEditingModel.haiku_model = haiku_model;
    currentEditingModel.opus_model = opus_model;
    currentEditingModel.sonnet_model = sonnet_model;
    currentEditingModel.api_key = api_key;
    currentEditingModel._isNew = false; // 保存后变成已有配置

    if (currentEditingModel._originalAlias === null) {
      models.push({ ...currentEditingModel });
    } else {
      const index = models.findIndex(m => m.alias === currentEditingModel._originalAlias);
      if (index !== -1) {
        models[index] = { ...currentEditingModel };
      }
    }

    // 重新加载以获取正确的 raw_json
    await loadModels();
    showToast('保存成功');
    hideDetailPage();
  } catch (err) {
    showToast('保存失败: ' + err);
  }
}

// 返回列表
function hideDetailPage() {
  currentView = 'list';
  currentEditingModel = null;
  detailPage.style.display = 'none';
  document.querySelector('.container').style.display = 'block';
}

// 返回按钮
backBtn.addEventListener('click', hideDetailPage);

// 搜索
searchBox.addEventListener('input', (e) => {
  renderConfigList(e.target.value);
});

// 新增配置
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
    _isNew: true, // 新配置
    _authMode: 'AUTH_TOKEN',
    _originalJson: {}
  };
  showDetailPage();
});

// 初始化
window.addEventListener('DOMContentLoaded', () => {
  loadModels();
});
