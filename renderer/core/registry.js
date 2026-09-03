/* ============================================================
 * registry.js — 游戏注册表（可拓展核心）
 *
 * 新增一个游戏只需：
 *   1. 在 games/ 下新建 xxx.js
 *   2. 调 GlassGames.register({ id, name, icon, factory })
 *   3. 在 index.html 里 <script src="games/xxx.js"> 一行
 * 顶栏图标自动生成，核心零侵入。
 *
 * 游戏工厂约定（factory 返回的对象）：
 *   mount(root, ctx)   挂载到 root 元素；ctx 见下
 *   destroy()          卸载清理（事件、定时器）
 *   onDiffChange(diff) 难度切换（'easy'|'medium'|'hard'）
 *   onModeChange(mode) 对手模式切换（'local'|'llm'）
 *   onNewGame()        点击「新局」
 *
 * ctx 提供：
 *   setStatus(html)     状态栏
 *   onThemeColor(cb)    赢棋时高亮开关：cb(false) 保持低调（隐身③）
 *   llm(messages, opts) 走主进程调 OpenAI 兼容接口，返回文本
 *   settings            全局设置引用
 * ============================================================ */
(function () {
  'use strict';

  const games = [];
  let activeId = null;

  const GlassGames = {
    /** 注册一个游戏 */
    register(def) {
      if (!def || !def.id || typeof def.factory !== 'function') {
        console.error('[registry] 无效的游戏定义', def);
        return;
      }
      games.push(def);
    },

    list() { return games.slice(); },

    get(id) { return games.find(g => g.id === id) || null; },

    get active() { return activeId ? this.get(activeId) : null; },

    /** 激活某个游戏（由 app.js 调用） */
    activate(id, stage, ctx) {
      const def = this.get(id);
      if (!def) return null;
      activeId = id;
      stage.innerHTML = '';
      const inst = def.factory();
      const root = document.createElement('div');
      root.className = 'game-root';
      stage.appendChild(root);
      inst.mount(root, ctx);
      return inst;
    },
  };

  window.GlassGames = GlassGames;
})();
