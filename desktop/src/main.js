const invoke = window.__TAURI__.core.invoke;
const open = window.__TAURI__.dialog.open;

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
          <div class="config-display-name">${m.alias}</div>
          <div class="config-alias">
            <input type="text" class="config-alias-input"
              value="${m.alias}"
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
          <select class="mode-select" data-field="mode">
            <option value="normal">普通启动</option>
            <option value="skip-permissions">跳过权限确认</option>
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
  currentEditingModel = { ...models[index], _originalAlias: models[index].alias };
  showDetailPage();
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
        value="${currentEditingModel.alias}" />
    </div>
    <div class="form-group">
      <label class="form-label">运行简称</label>
      <input type="text" class="form-input" id="detail-alias"
        value="${currentEditingModel.alias}" />
    </div>
    <div class="form-group">
      <label class="form-label">主模型 ID</label>
      <input type="text" class="form-input" id="detail-model-id"
        value="${currentEditingModel.model_id || ''}" />
    </div>
    <div class="form-group">
      <label class="form-label">API Key</label>
      <input type="password" class="form-input" id="detail-api-key"
        value="${currentEditingModel.api_key || ''}"
        placeholder="输入 API Key" />
    </div>
    <div class="form-group">
      <label class="form-label">Base URL</label>
      <input type="text" class="form-input" id="detail-base-url"
        value="${currentEditingModel.base_url || ''}"
        placeholder="https://api.anthropic.com" />
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
      <textarea class="config-textarea" id="detail-config-text"
        placeholder="粘贴完整配置文件内容..."></textarea>
      <div class="config-error" id="config-parse-error"></div>
      <div class="sync-status" id="sync-status"></div>
    </div>
    <button type="button" class="btn-save" id="save-btn">保存</button>
  `;

  // 初始化配置文本
  updateConfigText();
  bindDetailEvents();
}

// 绑定详情页事件
function bindDetailEvents() {
  const saveBtn = document.getElementById('save-btn');
  const browseBtn = document.getElementById('detail-browse-btn');
  const configText = document.getElementById('detail-config-text');

  saveBtn.addEventListener('click', handleSave);
  browseBtn.addEventListener('click', handleDetailBrowse);

  // 配置文本变更检测
  configText.addEventListener('input', debounce(handleConfigTextChange, 500));

  // 基础字段变更时标记未同步
  ['detail-display-name', 'detail-alias', 'detail-model-id', 'detail-api-key',
   'detail-base-url', 'detail-mode', 'detail-working-dir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', markUnsynced);
    }
  });
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

// 更新配置文本框
function updateConfigText() {
  const configText = document.getElementById('detail-config-text');
  if (!configText || !currentEditingModel) return;

  const config = {
    env: {
      ANTHROPIC_MODEL: currentEditingModel.model_id || '',
      ANTHROPIC_API_KEY: currentEditingModel.api_key || '',
      ANTHROPIC_BASE_URL: currentEditingModel.base_url || ''
    }
  };

  configText.value = JSON.stringify(config, null, 2);

  const status = document.getElementById('sync-status');
  if (status) {
    status.textContent = '已同步';
    status.className = 'sync-status synced';
  }
}

// 配置文本变更处理
function handleConfigTextChange() {
  const configText = document.getElementById('detail-config-text');
  const errorEl = document.getElementById('config-parse-error');

  try {
    const parsed = JSON.parse(configText.value);

    // 解析并填充字段
    if (parsed.env) {
      const displayName = document.getElementById('detail-display-name');
      const alias = document.getElementById('detail-alias');
      const modelId = document.getElementById('detail-model-id');
      const apiKey = document.getElementById('detail-api-key');
      const baseUrl = document.getElementById('detail-base-url');

      if (displayName) displayName.value = parsed.env.ANTHROPIC_MODEL || displayName.value;
      if (alias) alias.value = parsed.env.ANTHROPIC_MODEL || alias.value;
      if (modelId) modelId.value = parsed.env.ANTHROPIC_MODEL || '';
      if (apiKey) apiKey.value = parsed.env.ANTHROPIC_API_KEY || '';
      if (baseUrl) baseUrl.value = parsed.env.ANTHROPIC_BASE_URL || '';
    }

    errorEl.textContent = '';
    markSynced();
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
  const alias = document.getElementById('detail-alias').value.trim();
  if (!alias) {
    showToast('请输入运行简称');
    return;
  }

  currentEditingModel.alias = alias;
  currentEditingModel.model_id = document.getElementById('detail-model-id').value;
  currentEditingModel.api_key = document.getElementById('detail-api-key').value;
  currentEditingModel.base_url = document.getElementById('detail-base-url').value;
  currentEditingModel.mode = document.getElementById('detail-mode').value;
  currentEditingModel.working_dir = document.getElementById('detail-working-dir').value;

  // 新增还是更新
  if (currentEditingModel._originalAlias === null) {
    // 新增
    models.push({ ...currentEditingModel });
  } else {
    // 更新
    const index = models.findIndex(m => m.alias === currentEditingModel._originalAlias);
    if (index !== -1) {
      models[index] = { ...currentEditingModel };
    }
  }

  renderConfigList();
  showToast('保存成功');
  hideDetailPage();
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
    api_key: '',
    base_url: '',
    mode: 'normal',
    working_dir: '',
    _originalAlias: null
  };
  showDetailPage();
});

// 初始化
window.addEventListener('DOMContentLoaded', () => {
  loadModels();
});
