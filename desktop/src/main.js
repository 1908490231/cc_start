const invoke = window.__TAURI__.core.invoke;
const open = window.__TAURI__.dialog.open;

// 状态
let selectedModel = null;
let models = [];

// DOM 元素
const modelGrid = document.getElementById('model-grid');
const workDirInput = document.getElementById('work-dir');
const browseBtn = document.getElementById('browse-btn');
const launchBtn = document.getElementById('launch-btn');
const dirError = document.getElementById('dir-error');
const modelError = document.getElementById('model-error');
const toast = document.getElementById('toast');
const modeRadios = document.querySelectorAll('input[name="mode"]');

// 显示 toast
function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// 清除错误
function clearErrors() {
  dirError.textContent = '';
  modelError.textContent = '';
}

// 加载模型列表
async function loadModels() {
  try {
    models = await invoke('list_models');
    renderModels();
  } catch (e) {
    modelGrid.innerHTML = `<div class="model-empty">加载模型失败: ${e}</div>`;
  }
}

// 渲染模型卡片
function renderModels() {
  if (models.length === 0) {
    modelGrid.innerHTML = '<div class="model-empty">暂无可用模型，请先使用 cc add 添加</div>';
    return;
  }
  modelGrid.innerHTML = models.map(m => `
    <div class="model-card" data-alias="${m.alias}">
      <div class="model-alias">${m.alias}</div>
      <div class="model-id">${m.model_id || '—'}</div>
    </div>
  `).join('');

  // 绑定点击事件
  document.querySelectorAll('.model-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedModel = card.dataset.alias;
      clearErrors();
    });
  });
}

// 浏览文件夹
browseBtn.addEventListener('click', async () => {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择工作目录'
    });
    if (selected) {
      workDirInput.value = selected;
      clearErrors();
    }
  } catch (e) {
    console.error('选择目录失败:', e);
  }
});

// 启动
launchBtn.addEventListener('click', async () => {
  clearErrors();

  // 校验工作目录
  const workDir = workDirInput.value.trim();
  if (!workDir) {
    dirError.textContent = '请选择工作目录';
    return;
  }

  // 校验模型
  if (!selectedModel) {
    modelError.textContent = '请选择一个模型';
    return;
  }

  // 获取启动模式
  const skipPermissions = document.querySelector('input[name="mode"]:checked').value === 'skip-permissions';

  try {
    await invoke('launch_claude', {
      params: {
        alias: selectedModel,
        working_dir: workDir,
        skip_permissions: skipPermissions
      }
    });
    showToast(`已启动 ${selectedModel}`);
  } catch (e) {
    showToast(`启动失败: ${e}`);
  }
});

// 初始化
window.addEventListener('DOMContentLoaded', () => {
  loadModels();
});
