/* ============================================================
 * app.js — 壳应用
 *   拖拽移动 / 右下角缩放 / 位置记忆 / 透明度滑块
 *   鼠标移开自动淡化 / 标题伪装 / Alt+G 由主进程处理
 * ============================================================ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const card = $('#card');
  const stage = $('#stage');
  const statusbar = $('#statusbar');

  /* ---------- 设置加载 ---------- */
  const settings = {
    glassOpacity: 45,
    stoneInk: 45,         // 墨色浓度：0 全灰（隐身）~ 100 用足颜色（清晰）
    ghost: true,          // 幽灵模式：鼠标移开后淡到 3.5%
    difficulty: 'medium',
    mode: 'local',
    activeGame: 'gomoku',
    llmUrl: '', llmKey: '', llmModel: '',
    ...(window.GlassBridge ? {} : {}),
  };

  async function loadSettings() {
    if (!window.GlassBridge) return;   // 浏览器直接打开时用默认值
    const saved = await window.GlassBridge.getSettings();
    Object.assign(settings, saved || {});
  }

  function persist(patch) {
    Object.assign(settings, patch);
    if (window.GlassBridge) window.GlassBridge.setSettings(patch);
  }

  /* ---------- 透明度滑块（联动棋子透明度） ---------- */
  const slider = $('#alphaSlider');
  function applyAlpha(v) {
    const a = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    document.documentElement.style.setProperty('--glass-alpha', a.toFixed(3));
    slider.value = Math.round(a * 100);
    slider.style.setProperty('--fill', slider.value + '%');
    // CSS 变量变化不会触发 canvas 重画，必须手动调游戏暴露的 draw 钩子
    if (typeof window.__ggDraw__ === 'function') {
      try { window.__ggDraw__(); } catch (e) {}
    }
  }
  slider.addEventListener('input', () => {
    applyAlpha(slider.value);
    persist({ glassOpacity: Number(slider.value) });
  });

  /* ---------- 墨色滑块（棋子/棋盘的颜色浓度） ---------- */
  const inkSlider = $('#inkSlider');
  function applyInk(v) {
    const n = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    document.documentElement.style.setProperty('--stone-ink', n.toFixed(3));
    inkSlider.value = Math.round(n * 100);
    inkSlider.style.setProperty('--fill', inkSlider.value + '%');
    if (typeof window.__ggDraw__ === 'function') {
      try { window.__ggDraw__(); } catch (e) {}
    }
  }
  inkSlider.addEventListener('input', () => {
    applyInk(inkSlider.value);
    persist({ stoneInk: Number(inkSlider.value) });
  });

  /* ---------- 幽灵模式（极限隐身，主进程 Alt+H 可切换） ---------- */
  const btnGhost = $('#btnGhost');
  function applyGhost(on) {
    card.classList.toggle('ghost', !!on);
    btnGhost.classList.toggle('on', !!on);
    btnGhost.title = on
      ? '幽灵模式已开：鼠标移开后淡到 3.5%（Alt+H 关闭）'
      : '幽灵模式已关：鼠标移开后淡到 10%（Alt+H 开启）';
  }
  btnGhost.addEventListener('click', () => {
    const next = !(settings.ghost !== false);
    applyGhost(next);
    persist({ ghost: next });
    setStatus(next ? '幽灵模式已开：鼠标移开就几乎看不见了' : '幽灵模式已关');
  });
  // 供主进程快捷键调用
  window.__toggleGhost = function () {
    const next = !(settings.ghost !== false);
    applyGhost(next);
    persist({ ghost: next });
    return next;
  };

  /* ---------- 鼠标移开自动淡化（隐身②） ---------- */
  let fadeTimer = null;
  document.addEventListener('mouseleave', () => {
    fadeTimer = setTimeout(() => card.classList.add('faded'), 700);
  });
  document.addEventListener('mouseenter', () => {
    clearTimeout(fadeTimer);
    card.classList.remove('faded');
  });

  /* ---------- 拖拽移动（标题栏手柄） ---------- */
  const titlebar = $('#titlebar');
  let drag = null;
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.iconbtn')) return;
    drag = { sx: e.screenX, sy: e.screenY };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.sx, dy = e.screenY - drag.sy;
    drag.sx = e.screenX; drag.sy = e.screenY;
    if (window.GlassBridge) window.GlassBridge.moveWindowBy(dx, dy);
  });
  window.addEventListener('mouseup', () => { drag = null; });

  /* ---------- 右下角缩放手柄 ---------- */
  const rz = $('#resizeHandle');
  let resizing = null;
  rz.addEventListener('mousedown', (e) => {
    const rect = card.getBoundingClientRect();
    resizing = { sw: e.screenX, sh: e.screenY, w: rect.width, h: rect.height };
    e.preventDefault(); e.stopPropagation();
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const w = Math.max(320, resizing.w + (e.screenX - resizing.sw));
    const h = Math.max(480, resizing.h + (e.screenY - resizing.sh));
    if (window.GlassBridge) window.GlassBridge.resizeWindowTo(Math.round(w), Math.round(h));
  });
  window.addEventListener('mouseup', () => { resizing = null; });

  /* ---------- 隐藏按钮 ---------- */
  $('#btnHide').addEventListener('click', () => {
    if (window.GlassBridge) window.GlassBridge.hideWindow();
  });

  /* ---------- 工具条：难度 / 模式 ---------- */
  function bindSeg(segId, attr, key, onChange) {
    const seg = $(segId);
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      persist({ [key]: btn.dataset[attr] });
      if (onChange) onChange(btn.dataset[attr]);
    });
    // 恢复选中态
    const cur = settings[key];
    if (cur) seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset[attr] === cur));
  }

  /* ---------- LLM 设置面板 ---------- */
  const llmPanel = $('#llmPanel');
  $('#btnLlm').addEventListener('click', () => {
    $('#llmUrl').value = settings.llmUrl || '';
    $('#llmKey').value = settings.llmKey || '';
    $('#llmModel').value = settings.llmModel || '';
    llmPanel.classList.add('show');
  });
  $('#llmCancel').addEventListener('click', () => llmPanel.classList.remove('show'));
  $('#llmSave').addEventListener('click', () => {
    persist({
      llmUrl: $('#llmUrl').value.trim(),
      llmKey: $('#llmKey').value.trim(),
      llmModel: $('#llmModel').value.trim(),
    });
    llmPanel.classList.remove('show');
    setStatus('大模型配置已保存');
  });

  /* ---------- 获取模型列表（按当前输入的 URL+Key 调 /v1/models） ---------- */
  const getModelsBtn = $('#llmGetModels');
  const modelPanel = $('#llmModelPanel');
  const modelToggle = $('#llmModelToggle');

  function renderModelPanel(models, activeId) {
    modelPanel.innerHTML = '';
    if (!models || !models.length) {
      const e = document.createElement('div');
      e.className = 'mp-empty';
      e.textContent = '暂未拉取模型，输入 URL+Key 后点「获取模型」';
      modelPanel.appendChild(e);
      return;
    }
    const h = document.createElement('div');
    h.className = 'mp-header';
    h.textContent = `共 ${models.length} 个模型，点击选择（也可继续手输）`;
    modelPanel.appendChild(h);
    const active = (activeId || '').trim();
    models.forEach(id => {
      const item = document.createElement('div');
      item.className = 'mp-item' + (id === active ? ' mp-active' : '');
      const span = document.createElement('span');
      span.className = 'mp-id';
      span.textContent = id;
      const tag = document.createElement('span');
      tag.className = 'mp-tag';
      tag.textContent = id === active ? '当前' : (id.includes('vision') ? '多模态'
              : id.includes('embed') ? '向量'
              : id.includes('search') ? '检索'
              : id.includes('dall') || id.includes('image') ? '图像'
              : '对话');
      item.appendChild(span);
      item.appendChild(tag);
      item.addEventListener('click', () => {
        $('#llmModel').value = id;
        closePanel();
      });
      modelPanel.appendChild(item);
    });
  }
  function openPanel() { modelPanel.hidden = false; modelToggle.classList.add('open'); }
  function closePanel() { modelPanel.hidden = true; modelToggle.classList.remove('open'); }
  function isPanelOpen() { return !modelPanel.hidden; }

  modelToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPanelOpen()) closePanel(); else openPanel();
  });
  // 点外面自动收起
  document.addEventListener('click', (e) => {
    if (!isPanelOpen()) return;
    const picker = modelToggle.parentElement;
    if (!picker.contains(e.target)) closePanel();
  });
  // Esc 收起
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPanelOpen()) closePanel();
  });

  // 进入面板时若已有缓存（来自设置或上次拉到）也能展示
  renderModelPanel([], '');

  getModelsBtn.addEventListener('click', async () => {
    const url = $('#llmUrl').value.trim();
    const key = $('#llmKey').value.trim();
    if (!url) { setStatus('请先填 API Base URL'); return; }
    if (!key) { setStatus('请先填 API Key'); return; }
    if (!window.GlassBridge || !window.GlassBridge.listModels) {
      setStatus('当前环境不支持获取模型'); return;
    }
    getModelsBtn.disabled = true;
    const orig = getModelsBtn.textContent;
    getModelsBtn.textContent = '获取中…';
    try {
      const r = await window.GlassBridge.listModels({ baseUrl: url, apiKey: key });
      if (!r.ok) throw new Error(r.error || '拉取失败');
      const models = r.models || [];
      // 缓存到 module 作用域以便切回面板仍可见
      cachedModels = models;
      renderModelPanel(models, $('#llmModel').value.trim());
      // 自动展开面板让用户立刻看到所有模型
      openPanel();
      // 如果输入框为空，自动填第一个
      if (!$('#llmModel').value.trim() && models.length) $('#llmModel').value = models[0];
      getModelsBtn.textContent = `已拉到 ${models.length} 个`;
      setStatus(`已拉取 ${models.length} 个模型，点 ▾ 查看完整列表`);
    } catch (e) {
      getModelsBtn.textContent = '失败，重试';
      setStatus('获取模型失败：' + String(e.message || e).slice(0, 100));
    } finally {
      setTimeout(() => {
        getModelsBtn.disabled = false;
        if (getModelsBtn.textContent !== '失败，重试') getModelsBtn.textContent = orig;
      }, 2500);
    }
  });

  let cachedModels = [];   // 模块作用域缓存

  /* ---------- 新局按钮 ---------- */
  $('#btnNew').addEventListener('click', () => {
    if (app.gameInst && app.gameInst.onNewGame) app.gameInst.onNewGame();
  });

  /* ---------- 悔棋按钮 ---------- */
  const btnUndo = $('#btnUndo');
  btnUndo.addEventListener('click', () => {
    if (!app.gameInst || typeof app.gameInst.undo !== 'function') {
      setStatus('当前游戏不支持悔棋');
      return;
    }
    const ok = app.gameInst.undo();
    if (!ok) setStatus('已经回到开局，没有可悔的步了');
  });

  /* ---------- ctx：给游戏的上下文 ---------- */
  function setStatus(html) { statusbar.innerHTML = html; }

  const ctx = {
    settings,
    setStatus,
    /** 赢棋低调处理（隐身③）：游戏调用 onGameEnd(false) 表示不高亮庆祝 */
    onGameEnd(winSide) {
      // 摸鱼原则：赢了也不飘屏，只安静更新状态栏
      setStatus(`对局结束（低调，不张扬 🙂）`.replace(' 🙂', ''));
    },
    /** 调用大模型（OpenAI 兼容）。messages: [{role, content}] */
    async llm(messages, opts = {}) {
      if (!settings.llmUrl || !settings.llmKey) throw new Error('未配置大模型 API（点右上角 ⚙ 配置）');
      if (!window.GlassBridge) throw new Error('仅桌面端可用');
      const r = await window.GlassBridge.llmChat({
        baseUrl: settings.llmUrl,
        apiKey: settings.llmKey,
        model: settings.llmModel,
        messages,
        temperature: opts.temperature ?? 0.7,
        maxTokens: opts.maxTokens ?? 200,
      });
      if (!r.ok) throw new Error(r.error || 'LLM 调用失败');
      return r.text;
    },
  };

  /* ---------- 游戏顶栏（注册表自动生成） ---------- */
  function buildTabs() {
    const tabs = $('#gameTabs');
    tabs.innerHTML = '';
    window.GlassGames.list().forEach(g => {
      const b = document.createElement('button');
      b.className = 'tab' + (g.id === settings.activeGame ? ' active' : '');
      b.title = g.name;
      b.textContent = g.icon;
      b.addEventListener('click', () => activateGame(g.id));
      tabs.appendChild(b);
    });
  }

  let app = { gameInst: null };

  function activateGame(id) {
    const prev = app.gameInst;
    if (prev && prev.destroy) prev.destroy();
    app.gameInst = window.GlassGames.activate(id, stage, ctx);
    settings.activeGame = id;
    persist({ activeGame: id });
    buildTabs();
    // 让新游戏感知当前难度/模式
    if (app.gameInst.onDiffChange) app.gameInst.onDiffChange(settings.difficulty);
    if (app.gameInst.onModeChange) app.gameInst.onModeChange(settings.mode);
  }

  bindSeg('#diffSeg', 'diff', 'difficulty', (d) => {
    if (app.gameInst && app.gameInst.onDiffChange) app.gameInst.onDiffChange(d);
  });
  bindSeg('#modeSeg', 'mode', 'mode', (m) => {
    if (app.gameInst && app.gameInst.onModeChange) app.gameInst.onModeChange(m);
  });

  /* ---------- 启动 ---------- */
  (async function boot() {
    try {
      await loadSettings();
      applyAlpha(settings.glassOpacity);
      applyInk(settings.stoneInk == null ? 45 : settings.stoneInk);
      applyGhost(settings.ghost !== false);   // 默认开启
      // 设置加载完成后恢复难度/模式按钮的选中态（避免与默认值竞态）
      document.querySelectorAll('#diffSeg button').forEach(b =>
        b.classList.toggle('active', b.dataset.diff === settings.difficulty));
      document.querySelectorAll('#modeSeg button').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === settings.mode));
      if (!window.GlassGames.list().length) {
        // 游戏脚本加载失败兜底
        setStatus('未发现任何游戏');
        return;
      }
      if (!window.GlassGames.get(settings.activeGame)) settings.activeGame = window.GlassGames.list()[0].id;
      buildTabs();
      activateGame(settings.activeGame);
    } catch (err) {
      // 任何启动错误都显示在状态栏，避免白屏无提示
      try { document.getElementById('statusbar').textContent = '启动出错: ' + String(err && err.message || err).slice(0, 80); } catch (e) {}
      if (typeof console !== 'undefined') console.error('[glass] boot error', err);
    }
  })();

  window.__glassApp = { setStatus };
})();
