/* ============================================================
 * Glass Games — 桌面透明玻璃摸鱼小游戏集
 * Electron 主进程：
 *   - 无边框透明窗口（点击穿透区域外的空白处直接透到桌面）
 *   - 全局快捷键 Alt+G 呼出/隐藏
 *   - 托盘图标 + 菜单
 *   - 窗口位置/大小持久化（localStorage 也存一份，双保险）
 *   - IPC：设置持久化 / 窗口控制 / LLM 网关
 * ============================================================ */
const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// 兼容部分环境 GPU 进程崩溃（尤其远程桌面/虚拟桌面）：
// 1) in-process-gpu 把 GPU 并入主进程，避免 GPU 子进程崩溃连锁
// 2) disable-renderer-backgrounding 防止"透明窗口失焦被降级杀渲染进程"
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.disableHardwareAcceleration();

const IS_MAC = process.platform === 'darwin';

let win = null;
let tray = null;
let quitting = false;
let SETTING_FILE = '';

/* ---------- 设置持久化（JSON 文件，重启不丢） ---------- */
let settings = {};
function loadSettingsFile() {
  SETTING_FILE = path.join(app.getPath('userData'), 'glass-games-settings.json');
  try { settings = JSON.parse(fs.readFileSync(SETTING_FILE, 'utf8')); } catch (e) { settings = {}; }
  settings.winBounds = settings.winBounds || null;
  settings.glassOpacity = typeof settings.glassOpacity === 'number' ? settings.glassOpacity : 65;
}

function saveSettings() {
  try { fs.writeFileSync(SETTING_FILE, JSON.stringify(settings, null, 2)); } catch (e) { /* 静默 */ }
}

/* ---------- LLM 网关（OpenAI 兼容 /chat/completions） ---------- */
async function llmChat(payload) {
  const res = await fetch(`${payload.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${payload.apiKey}`,
    },
    body: JSON.stringify({
      model: payload.model || undefined,
      messages: payload.messages,
      temperature: payload.temperature ?? 0.7,
      max_tokens: payload.maxTokens ?? 200,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (e) {}
    throw new Error(`HTTP ${res.status} ${detail}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content || '';
  if (!String(text).trim()) throw new Error('模型返回空内容');
  return String(text).trim();
}

/* ---------- LLM 模型列表（OpenAI 兼容 GET /models） ---------- */
async function llmListModels(payload) {
  const res = await fetch(`${payload.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { 'Authorization': `Bearer ${payload.apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (e) {}
    throw new Error(`HTTP ${res.status} ${detail}`);
  }
  const json = await res.json();
  const models = (json.data || []).map(m => m && m.id).filter(Boolean);
  if (!models.length) throw new Error('模型列表为空');
  return models;
}

/* ---------- 窗口创建 ---------- */
function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  // 恢复上次位置；没有则默认屏幕右上区域
  const b = settings.winBounds;
  const bounds = b
    ? { x: Math.min(b.x, sw - 100), y: Math.min(b.y, sh - 100), width: b.width, height: b.height }
    : { x: Math.max(20, sw - 420), y: 80, width: 380, height: 640 };

  win = new BrowserWindow({
    ...bounds,
    frame: false,               // 无边框
    transparent: true,          // 真透明：桌面从玻璃后面透出来
    resizable: false,           // 缩放交给页面内的右下角手柄
    alwaysOnTop: true,          // 悬浮卡片
    skipTaskbar: true,          // 不占任务栏（摸鱼要低调）
    hasShadow: false,           // 阴影会让透明边缘看着发灰
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver'); // 压住多数置顶窗口
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 冒烟测试钩子（仅设置 GLASS_SMOKE=1 时生效）：
  // 验证注册表 + 挂载 + 象棋切换 + 落子交互，逐步截图
  if (process.env.GLASS_SMOKE) {
    win.webContents.on('console-message', (_e, _level, message) => {
      console.log('[RENDERER] ' + String(message).slice(0, 200));
    });
    const smokeDir = process.env.GLASS_SMOKE_DIR || app.getPath('temp');
    const shot = (name) => {
      try {
        return win.webContents.capturePage().then(img => {
          const p = path.join(smokeDir, name);
          fs.writeFileSync(p, img.toPNG());
          console.log('[SMOKE] screenshot=' + p);
        });
      } catch (e) { console.log('[SMOKE] shot error ' + e); return Promise.resolve(); }
    };
    win.webContents.on('did-finish-load', async () => {
      try {
        await new Promise(r => setTimeout(r, 1200));
        const read = () => win.webContents.executeJavaScript(`(function () {
          var s = document.getElementById('stage');
          return JSON.stringify({
            games: window.GlassGames ? window.GlassGames.list().map(function (g) { return g.id; }).join(',') : 'NO_REGISTRY',
            active: window.GlassGames && window.GlassGames.active ? window.GlassGames.active.id : 'none',
            tabs: document.querySelectorAll('#gameTabs .tab').length,
            canvas: s ? s.querySelectorAll('canvas').length : -1,
            status: (document.getElementById('statusbar') || {}).textContent || ''
          });
        })()`);
        console.log('[SMOKE] gomoku ' + await read());
        await shot('smoke-1-gomoku.png');

        // 切到象棋 tab（第 2 个）
        await win.webContents.executeJavaScript(
          'document.querySelectorAll("#gameTabs .tab")[1].click()');
        await new Promise(r => setTimeout(r, 700));
        console.log('[SMOKE] xiangqi ' + await read());
        await shot('smoke-2-xiangqi.png');

        // 五子棋落子交互：点天元 (7,7)，等本地 AI 回应
        await win.webContents.executeJavaScript(`(function () {
          document.querySelectorAll("#gameTabs .tab")[0].click();
        })()`);
        await new Promise(r => setTimeout(r, 500));
        const clickGomoku = await win.webContents.executeJavaScript(`(function () {
          var cv = document.querySelector('#stage canvas');
          var r = cv.getBoundingClientRect();
          // 棋盘 pad=cellSize，天元是 (7,7)：x = pad + 7*cell = cell*8
          var cell = r.width / 16;
          var ev = new MouseEvent('click', { clientX: r.left + cell * 8, clientY: r.top + cell * 8, bubbles: true });
          cv.dispatchEvent(ev);
          return 'clicked';
        })()`);
        console.log('[SMOKE] gomoku click=' + clickGomoku);
        await new Promise(r => setTimeout(r, 1500));   // 等 AI 落子
        const after = await win.webContents.executeJavaScript(`(function () {
          var sb = document.getElementById('statusbar');
          return sb.textContent;
        })()`);
        console.log('[SMOKE] after-move status=' + after);
        await shot('smoke-3-gomoku-moved.png');

        // 把透明度滑块拉到 0%：验证棋子联动隐形效果
        await win.webContents.executeJavaScript(`(function () {
          var s = document.getElementById('alphaSlider');
          s.value = 0;
          s.dispatchEvent(new Event('input', { bubbles: true }));
          // CSS 变量已变，但 canvas 不会自动重画，调用 mount 时挂的调试钩子强制重画
          if (typeof window.__ggDraw__ === 'function') window.__ggDraw__();
        })()`);
        await new Promise(r => setTimeout(r, 400));
        console.log('[SMOKE] alpha=0 status=' + await win.webContents.executeJavaScript(
          "document.getElementById('statusbar').textContent"));
        await shot('smoke-4-alpha-zero.png');

        // 恢复透明度 + 验证悔棋：先让棋子回来、再点悔棋
        await win.webContents.executeJavaScript(`(function () {
          var s = document.getElementById('alphaSlider');
          s.value = 65;
          s.dispatchEvent(new Event('input', { bubbles: true }));
          if (typeof window.__ggDraw__ === 'function') window.__ggDraw__();
        })()`);
        await new Promise(r => setTimeout(r, 300));
        // 点「悔棋」按钮：撤销玩家黑 + AI 白两步，棋盘应回到空盘（playing=false）
        const undoRes = await win.webContents.executeJavaScript(`(function () {
          document.getElementById('btnUndo').click();
          var cv = document.querySelector('#stage canvas');
          var c = cv.getContext('2d');
          // 简单判断：draw 调用了 clearRect。直接读 status 验证
          return document.getElementById('statusbar').textContent;
        })()`);
        console.log('[SMOKE] undo status=' + undoRes);
        await new Promise(r => setTimeout(r, 300));
        await shot('smoke-5-undo.png');

        // 墨色 0%（全灰）：玻璃拉满 100% 实体，只把颜色浓度归零，验证"颜色本身"够淡
        await win.webContents.executeJavaScript(`(function () {
          var a = document.getElementById('alphaSlider');
          a.value = 100;
          a.dispatchEvent(new Event('input', { bubbles: true }));
          var i = document.getElementById('inkSlider');
          i.value = 0;
          i.dispatchEvent(new Event('input', { bubbles: true }));
          // 摆几颗子好看效果
          return document.getElementById('inkSlider').value;
        })()`);
        await new Promise(r => setTimeout(r, 400));
        // 随便下两手，好让画面里有黑白子对比
        await win.webContents.executeJavaScript(`(function () {
          var cv = document.querySelector('#stage canvas');
          if (!cv) return 'no-canvas';
          var b = cv.getBoundingClientRect();
          function click(px, py) {
            var ev = new MouseEvent('click', { bubbles: true, clientX: px, clientY: py });
            cv.dispatchEvent(ev);
          }
          click(b.left + b.width * 0.5, b.top + b.height * 0.5);
          return 'clicked';
        })()`);
        await new Promise(r => setTimeout(r, 900));
        console.log('[SMOKE] ink=0 status=' + await win.webContents.executeJavaScript(
          "document.getElementById('statusbar').textContent"));
        await shot('smoke-7-墨色0-全灰.png');

        // smoke-8：最实档（玻璃 100% + 墨色 100%），切到象棋，验证空心棋子仍可辨认
        await win.webContents.executeJavaScript(`(function () {
          var a = document.getElementById('alphaSlider');
          a.value = 100;
          a.dispatchEvent(new Event('input', { bubbles: true }));
          var i = document.getElementById('inkSlider');
          i.value = 100;
          i.dispatchEvent(new Event('input', { bubbles: true }));
          var tabs = document.querySelectorAll('#gameTabs .tab');
          if (tabs[1]) tabs[1].click();
          return 'xiangqi-ink100';
        })()`);
        await new Promise(r => setTimeout(r, 600));
        await shot('smoke-8-象棋-空心棋子-最实档.png');

        // ===== 新增三游戏自动验证：遍历所有 tab → 读状态 → 模拟真实操作 → 截图 =====
        try {
          // 先把玻璃/墨色恢复到 85%/60%，便于看清
          await win.webContents.executeJavaScript(`(function () {
            // 只清淡化态，保留 ghost 模式（后面幽灵测试还要用）
            document.getElementById('card').classList.remove('faded');
            var s = document.getElementById('alphaSlider'); s.value = 85;
            s.dispatchEvent(new Event('input', { bubbles: true }));
            var i = document.getElementById('inkSlider'); i.value = 60;
            i.dispatchEvent(new Event('input', { bubbles: true }));
            return 1;
          })()`);
          const tabs = JSON.parse(await win.webContents.executeJavaScript(
            `JSON.stringify(Array.prototype.map.call(document.querySelectorAll('#gameTabs .tab'),
              function (b, i) { return { i: i, title: b.title }; }))`));
          for (const tab of tabs) {
            const t = tab.title;
            if (t === '五子棋' || t === '象棋') continue;    // 前面已验证过
            await win.webContents.executeJavaScript(
              `document.querySelectorAll('#gameTabs .tab')[${tab.i}].click()`);
            await new Promise(r => setTimeout(r, 500));
            const st = await win.webContents.executeJavaScript(
              "window.__smokeState ? JSON.stringify(window.__smokeState()) : 'null'");
            console.log(`[SMOKE] ${t} state=${st}`);

            if (t === '连连看') {
              // 自动找出一对可消的并点掉
              const pair = await win.webContents.executeJavaScript(`(function () {
                var p = window.__llPair && window.__llPair();
                if (!p) return 'no-pair';
                function hit(pos) {
                  var el = document.querySelector('.ll-tile[data-r="' + pos.r + '"][data-c="' + pos.c + '"]');
                  if (!el) return false;
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  return true;
                }
                if (!hit(p.a) || !hit(p.b)) return 'no-dom';
                return 'clicked';
              })()`);
              await new Promise(r => setTimeout(r, 500));
              console.log(`[SMOKE] ${t} pair=${pair} after=` + await win.webContents.executeJavaScript(
                "JSON.stringify(window.__smokeState())"));
            } else if (t === '2048') {
              // 模拟四个方向各滑一次
              for (const d of ['left', 'up', 'right', 'down']) {
                await win.webContents.executeJavaScript(`window.__g48Move && window.__g48Move('${d}')`);
                await new Promise(r => setTimeout(r, 120));
              }
              console.log('[SMOKE] 2048 after-moves=' + await win.webContents.executeJavaScript(
                "JSON.stringify(window.__smokeState())"));
            } else if (t === '红中麻将') {
              // 初始张数守恒校验：庄家 14 张 / 其余 13 张 / 牌墙 59
              const init = JSON.parse(await win.webContents.executeJavaScript(
                "JSON.stringify(window.__smokeState())"));
              console.log(`[SMOKE] 麻将 开局校验 hands=${JSON.stringify(init.hands)} wall=${init.wall}`
                + ` (期望 hands=[14,13,13,13] wall=59)`);
              // 连打 3 局（座位 0 也用 AI 策略，碰杠全接），统计胡家分布
              let huSeats = [], drew = 0;
              for (let g = 0; g < 3; g++) {
                let steps = 0, last = null, overSeen = false;
                for (; steps < 400; steps++) {
                  const st = JSON.parse(await win.webContents.executeJavaScript(
                    "JSON.stringify(window.__smokeState())"));
                  last = st;
                  if (st.phase === 'over') {
                    // 胡牌定格截图：别人胡牌时应弹出摊牌面板
                    if (!overSeen) {
                      overSeen = true;
                      console.log(`[SMOKE] 麻将 第${g + 1}局 胡牌定格: winner=${st.winner}`
                        + ` huView=${st.huView} myMelds=${st.myMelds} fresh=${st.fresh} toast=${st.toast}`);
                      await shot(`smoke-new-红中麻将-胡牌定格${g + 1}.png`);
                    }
                    break;
                  }
                  if (st.canDiscard) await win.webContents.executeJavaScript("window.__mjPlayAsBot()");
                  else if (st.pending) await win.webContents.executeJavaScript("window.__mjClaim(true)");
                  await new Promise(r => setTimeout(r, 60));
                }
                huSeats.push(last.winner);
                if (last.winner === -1) drew++;
                console.log(`[SMOKE] 麻将 第${g + 1}局 ${steps} 步: 胡家=${last.winner}`
                  + ` 牌墙剩 ${last.wall} 副露=${JSON.stringify(last.melds)} 牌河=${last.pool}`);
                // 开下一局
                await win.webContents.executeJavaScript(`document.getElementById('btnNew').click()`);
                await new Promise(r => setTimeout(r, 300));
              }
              console.log(`[SMOKE] 麻将 3 局结果: 胡家=${JSON.stringify(huSeats)} 流局 ${drew} 次`);

              // LLM 模式验证：备份原配置 → 填 mock → 切大模型模式 → 打一段对局 → 恢复
              const envUrl = process.env.GLASS_SMOKE_LLM_URL || '';
              const envKey = process.env.GLASS_SMOKE_LLM_KEY || '';
              if (envUrl && envKey) {
                const orig = await win.webContents.executeJavaScript(`(function () {
                  var $ = function (id) { return document.getElementById(id); };
                  $('llmPanel').classList.add('show');
                  return JSON.stringify({ url: $('llmUrl').value, key: $('llmKey').value, model: $('llmModel').value });
                })()`);
                await win.webContents.executeJavaScript(`(function () {
                  var env = { url: ${JSON.stringify(envUrl)}, key: ${JSON.stringify(envKey)} };
                  var $ = function (id) { return document.getElementById(id); };
                  $('llmPanel').classList.add('show');
                  $('llmUrl').value = env.url; $('llmKey').value = env.key; $('llmModel').value = 'mock';
                  $('llmSave').click();
                  var b = document.querySelector('#modeSeg button[data-mode="llm"]');
                  if (b) b.click();
                  return 1;
                })()`);
                await new Promise(r => setTimeout(r, 300));
                let ls = 0, ll = null;
                for (; ls < 120; ls++) {
                  ll = JSON.parse(await win.webContents.executeJavaScript(
                    "JSON.stringify(window.__smokeState())"));
                  if (ll.phase === 'over') break;
                  if (ll.canDiscard) await win.webContents.executeJavaScript("window.__mjPlayAsBot()");
                  else if (ll.pending) await win.webContents.executeJavaScript("window.__mjClaim(true)");
                  await new Promise(r => setTimeout(r, 60));
                }
                console.log(`[SMOKE] 麻将 LLM模式 ${ls} 步: phase=${ll.phase} 胡家=${ll.winner} 牌河=${ll.pool}`);
                // 恢复原配置 + 切回本地模式
                await win.webContents.executeJavaScript(`(function () {
                  var o = ${orig};
                  var $ = function (id) { return document.getElementById(id); };
                  $('llmPanel').classList.add('show');
                  $('llmUrl').value = o.url; $('llmKey').value = o.key; $('llmModel').value = o.model;
                  $('llmSave').click();
                  var b = document.querySelector('#modeSeg button[data-mode="local"]');
                  if (b) b.click();
                  return 1;
                })()`);
              }
              // 悔棋：收回最后打出的一张
              await win.webContents.executeJavaScript("window.__mjDiscard(0)");
              await new Promise(r => setTimeout(r, 200));
              await win.webContents.executeJavaScript(`document.getElementById('btnUndo').click()`);
              await new Promise(r => setTimeout(r, 200));
              console.log('[SMOKE] 麻将 after-undo=' + await win.webContents.executeJavaScript(
                "JSON.stringify(window.__smokeState())"));
            } else if (t === '扫雷') {
              const opened = await win.webContents.executeJavaScript(
                "window.__mnOpen ? String(window.__mnOpen()) : 'no-hook'");
              await new Promise(r => setTimeout(r, 300));
              console.log(`[SMOKE] 扫雷 open=${opened} after=` + await win.webContents.executeJavaScript(
                "JSON.stringify(window.__smokeState())"));
              // 右键插旗
              await win.webContents.executeJavaScript(`(function () {
                var cells = document.querySelectorAll('.mn-cell');
                var el = cells[0];
                if (!el) return 0;
                el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                return 1;
              })()`);
              await new Promise(r => setTimeout(r, 200));
              console.log('[SMOKE] 扫雷 after-flag=' + await win.webContents.executeJavaScript(
                "JSON.stringify(window.__smokeState())"));
              // 悔棋
              await win.webContents.executeJavaScript(`document.getElementById('btnUndo').click()`);
              await new Promise(r => setTimeout(r, 200));
              console.log('[SMOKE] 扫雷 after-undo=' + await win.webContents.executeJavaScript(
                "JSON.stringify(window.__smokeState())"));
            }
            await shot(`smoke-new-${t}.png`);
          }
        } catch (e) { console.log('[SMOKE] new-games error ' + e); }

        // 幽灵模式极限隐身：滑块 0% + ghost + 鼠标移开淡化
        await win.webContents.executeJavaScript(`(function () {
          var s = document.getElementById('alphaSlider');
          s.value = 0;
          s.dispatchEvent(new Event('input', { bubbles: true }));
          document.getElementById('card').classList.add('faded');
          return 1;
        })()`);
        await new Promise(r => setTimeout(r, 700));   // 等 opacity transition 走完
        console.log('[SMOKE] ghost card-class=' + await win.webContents.executeJavaScript(
          "document.getElementById('card').className"));
        console.log('[SMOKE] ghost card-opacity=' + await win.webContents.executeJavaScript(
          "getComputedStyle(document.getElementById('card')).opacity"));
        await shot('smoke-6-ghost-invisible.png');

        // 模型下拉面板验证：打开 LLM 设置面板 → 手工预填 URL/Key → 点「获取模型」→ 截图 + 数 item
        try {
          const envUrl = process.env.GLASS_SMOKE_LLM_URL || '';
          const envKey = process.env.GLASS_SMOKE_LLM_KEY || '';
          await win.webContents.executeJavaScript(`(function () {
            function trigger(el, type) {
              el && el.dispatchEvent(new Event(type, { bubbles: true }));
            }
            function $(id) { return document.getElementById(id); }
            // 关闭幽灵模式、恢复透明度，便于看清
            $('card').classList.remove('faded','ghost');
            var s = $('alphaSlider'); s.value = 85; trigger(s, 'input');
            // 打开 LLM 设置面板
            $('llmPanel').classList.add('show');
            // 预填 URL + Key（从 main.js 传进来的 envUrl/envKey 注入字符串）
            $('llmUrl').value = ${JSON.stringify(envUrl)};
            $('llmKey').value = ${JSON.stringify(envKey)};
            return 1;
          })()`);
          await new Promise(r => setTimeout(r, 250));
          // 如果环境变量没设置，直接跳过
          if (!envUrl || !envKey) {
            console.log('[SMOKE] model-panel skipped (no GLASS_SMOKE_LLM_URL/KEY env)');
          } else {
            await win.webContents.executeJavaScript(`document.getElementById('llmGetModels').click()`);
            await new Promise(r => setTimeout(r, 3500));   // 等网络返回 + 渲染
            const panelInfo = await win.webContents.executeJavaScript(`(function () {
              var p = document.getElementById('llmModelPanel');
              return {
                hidden: p.hidden,
                count: p.querySelectorAll('.mp-item').length,
                firstId: (p.querySelector('.mp-item .mp-id') || {}).textContent || '',
                header: (p.querySelector('.mp-header') || {}).textContent || '',
              };
            })()`);
            console.log('[SMOKE] model-panel hidden=' + panelInfo.hidden
              + ' count=' + panelInfo.count
              + ' first=' + panelInfo.firstId
              + ' header=' + panelInfo.header);
            await shot('smoke-7-model-panel.png');
            // 点第一个模型
            await win.webContents.executeJavaScript(`(function () {
              var i = document.querySelector('#llmModelPanel .mp-item');
              if (i) i.click();
              return 1;
            })()`);
            await new Promise(r => setTimeout(r, 200));
            console.log('[SMOKE] after-pick model=' + await win.webContents.executeJavaScript(
              "document.getElementById('llmModel').value"));
          }
        } catch (e) { console.log('[SMOKE] model-panel error ' + e); }
      } catch (e) { console.log('[SMOKE] error ' + e); }
      quitting = true;          // 允许窗口真正关闭（跳过隐藏到托盘）
      setTimeout(() => { try { win.destroy(); } catch (e) {} app.quit(); }, 300);
    });
  }

  // 关闭 = 隐藏到托盘，进程常驻，Alt+G 秒呼出
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
  win.on('moved', () => persistBounds());
  win.on('resized', () => persistBounds());
}

function persistBounds() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  settings.winBounds = b;
  saveSettings();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

/* ---------- 托盘 ---------- */
function createTray() {
  // 16x16 透明底 + 简单玻璃方块图形，免图标文件
  const img = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9cAAAAj0lEQVR4nKWQsQ3DMAxFn2i6TTSj6jQxM7GcJiZIRMQtUogSJUpEiRLtH5tDyLscUnL+cjj3XgNB3OoC3vCEZzbgbwtYwlMe8IA3TOEJT3jCA05hCU94wgMupsBfwhNe8YQnPOEJD1vAEx7whCc84QEPWMA7nvCEJzzhCQ9b4AEPeMITHvCAE1zCEx7wgKX/6QtYwlMe8ID/eML/eMIr3vCEF7ziDa/4w395xU8SjF8AAAAASUVORK5CYII='
  );
  tray = new Tray(img);
  tray.setToolTip('摸鱼玻璃小局 — Alt+G 呼出/隐藏');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '呼出 / 隐藏 (Alt+G)', click: () => toggleWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => toggleWindow());
}

/* ---------- IPC ---------- */
ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:set', (e, patch) => {
  Object.assign(settings, patch || {});
  saveSettings();
  return true;
});

ipcMain.handle('win:moveBy', (e, dx, dy) => {
  if (!win) return false;
  const b = win.getBounds();
  win.setBounds({ x: Math.round(b.x + dx), y: Math.round(b.y + dy), width: b.width, height: b.height });
  persistBounds();
  return true;
});

ipcMain.handle('win:resizeTo', (e, width, height) => {
  if (!win) return false;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.max(320, Math.min(width, sw));
  const h = Math.max(480, Math.min(height, sh));
  const b = win.getBounds();
  win.setBounds({ x: b.x, y: b.y, width: w, height: h });
  persistBounds();
  return true;
});

ipcMain.handle('win:hide', () => { if (win) win.hide(); return true; });

ipcMain.handle('llm:chat', async (e, payload) => {
  try {
    const text = await llmChat(payload);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 200) };
  }
});

ipcMain.handle('llm:listModels', async (e, payload) => {
  try {
    const models = await llmListModels(payload);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 200) };
  }
});

/* ---------- 生命周期 ---------- */
app.whenReady().then(() => {
  loadSettingsFile();
  createWindow();
  createTray();
  globalShortcut.register('Alt+G', () => toggleWindow());
  // Alt+H：切换幽灵模式（极限隐身），立即生效，不用点按钮
  globalShortcut.register('Alt+H', () => {
    if (!win) return;
    win.webContents.executeJavaScript('window.__toggleGhost && window.__toggleGhost()').catch(() => {});
  });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// 点托盘退出才真正退出；所有窗口关闭不退出（常驻托盘）
app.on('window-all-closed', () => { /* no-op：常驻 */ });
