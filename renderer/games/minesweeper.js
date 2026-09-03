/* ============================================================
 * minesweeper.js — 扫雷
 *
 * 纯鼠标：左键挖开 / 右键插旗。
 * 首挖必安全（首点及其 8 邻域不布雷，所以第一下总能展开一片）。
 * 难度 = 棋盘尺寸 + 雷数：简单 9×9/10，中等 12×12/24，困难 16×13/40。
 *
 * 颜色全部走 CSS calc() 联动 --glass-alpha / --stone-ink，
 * 因此拖动滑块时 DOM 自动变淡，不需要 JS 重绘（canvas 才需要）。
 * ============================================================ */
(function () {
  'use strict';

  const LEVELS = {
    easy:   { R: 9,  C: 9,  M: 10 },
    medium: { R: 12, C: 12, M: 24 },
    hard:   { R: 16, C: 13, M: 40 },
  };

  const MINE = 9;          // 格子值 9 代表雷（0~8 是周围雷数）
  const ST_HIDDEN = 0, ST_DUG = 1, ST_FLAG = 2;

  function factory() {
    let root, ctx = null, diff = 'medium';
    let R = 0, C = 0, M = 0;
    let grid = [];        // 每格：0~8 数字 / 9 雷
    let state = [];       // 每格：0 未挖 / 1 已挖 / 2 旗
    let started = false, over = false, win = false;
    let dug = 0, flags = 0;
    let hist = [];        // 快照栈（悔棋用）
    let cells = [];       // DOM 引用
    let gridEl = null;
    let onCtx = null;     // contextmenu 监听（destroy 时移除）

    function idx(r, c) { return r * C + c; }
    function inBoard(r, c) { return r >= 0 && r < R && c >= 0 && c < C; }

    function snapshot() {
      return { grid: grid.slice(), state: state.slice(), dug, flags, over, win, started, M };
    }
    function restore(s) {
      grid = s.grid.slice(); state = s.state.slice();
      dug = s.dug; flags = s.flags; over = s.over; win = s.win;
      started = s.started; M = s.M;
    }

    /* ---------- 布雷（首挖点及 8 邻域排除） ---------- */
    function placeMines(sr, sc) {
      grid = new Array(R * C).fill(0);
      const forbid = new Set();
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const r = sr + dr, c = sc + dc;
        if (inBoard(r, c)) forbid.add(idx(r, c));
      }
      const pool = [];
      for (let i = 0; i < R * C; i++) if (!forbid.has(i)) pool.push(i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      M = Math.min(M, pool.length);          // 盘面太小则减少雷数
      for (let i = 0; i < M; i++) grid[pool[i]] = MINE;
      // 算周围雷数
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = idx(r, c);
        if (grid[i] === MINE) continue;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (inBoard(nr, nc) && grid[idx(nr, nc)] === MINE) n++;
        }
        grid[i] = n;
      }
    }

    /* ---------- DOM ---------- */
    function buildDom() {
      root.innerHTML = '';
      gridEl = document.createElement('div');
      gridEl.className = 'mn-grid';
      gridEl.style.setProperty('--c', String(C));
      cells = [];
      for (let i = 0; i < R * C; i++) {
        const el = document.createElement('div');
        el.className = 'mn-cell';
        el.dataset.i = String(i);
        gridEl.appendChild(el);
        cells.push(el);
      }
      root.appendChild(gridEl);
    }

    function render() {
      for (let i = 0; i < R * C; i++) {
        const el = cells[i];
        const v = grid[i], st = state[i];
        el.className = 'mn-cell';
        el.textContent = '';
        if (st === ST_FLAG) { el.classList.add('flag'); el.textContent = '⚑'; }
        else if (st === ST_DUG) {
          el.classList.add('dug');
          if (v === MINE) { el.classList.add('boom'); el.textContent = '✹'; }
          else if (v > 0) { el.textContent = String(v); el.classList.add('n' + v); }
        }
        // 输了：亮出所有雷（低调，不用高亮色）
        if (over && !win && v === MINE && st !== ST_DUG) { el.classList.add('mine'); el.textContent = '✹'; }
        if (over && win && v === MINE) { el.classList.add('flag'); el.textContent = '⚑'; }
      }
      if (!over) ctx.setStatus(`剩余 ${M - flags} 雷 · 已挖 ${dug}/${R * C - M}`);
    }

    /* ---------- 挖开（0 格自动扩散） ---------- */
    function dig(r, c) {
      if (over) return;
      const i = idx(r, c);
      if (state[i] === ST_DUG || state[i] === ST_FLAG) return;

      hist.push(snapshot());
      if (hist.length > 50) hist.shift();

      if (!started) { placeMines(r, c); started = true; }

      if (grid[i] === MINE) {
        state[i] = ST_DUG; over = true;
        ctx.setStatus('踩雷了，低调重开一局');
        if (ctx.onGameEnd) ctx.onGameEnd('ai');
        render();
        return;
      }

      const q = [[r, c]];
      while (q.length) {
        const [cr, cc] = q.pop();
        const ci = idx(cr, cc);
        if (state[ci] === ST_DUG || state[ci] === ST_FLAG) continue;
        state[ci] = ST_DUG; dug++;
        if (grid[ci] === 0) {
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const nr = cr + dr, nc = cc + dc;
            if (!inBoard(nr, nc)) continue;
            const ni = idx(nr, nc);
            if (state[ni] === ST_DUG || state[ni] === ST_FLAG) continue;
            q.push([nr, nc]);
          }
        }
      }

      if (dug === R * C - M) {
        over = true; win = true;
        ctx.setStatus('全部排完了（低调收好）');
        if (ctx.onGameEnd) ctx.onGameEnd('player');
      }
      render();
    }

    function toggleFlag(r, c) {
      if (over) return;
      const i = idx(r, c);
      if (state[i] === ST_DUG) return;
      hist.push(snapshot());
      if (hist.length > 50) hist.shift();
      state[i] = state[i] === ST_FLAG ? ST_HIDDEN : ST_FLAG;
      flags = state.filter(s => s === ST_FLAG).length;
      render();
    }

    /* ---------- 交互 ---------- */
    function onGridClick(e) {
      const el = e.target.closest('.mn-cell');
      if (!el) return;
      const i = Number(el.dataset.i);
      dig(Math.floor(i / C), i % C);
    }
    onCtx = (e) => {
      const el = e.target.closest('.mn-cell');
      if (!el) return;
      e.preventDefault();
      const i = Number(el.dataset.i);
      toggleFlag(Math.floor(i / C), i % C);
    };

    function reset() {
      const L = LEVELS[diff] || LEVELS.medium;
      R = L.R; C = L.C; M = L.M;
      grid = new Array(R * C).fill(0);
      state = new Array(R * C).fill(ST_HIDDEN);
      started = false; over = false; win = false;
      dug = 0; flags = 0; hist = [];
      buildDom();
      render();
      ctx.setStatus(`扫雷 ${R}×${C} · 雷 ${M} · 左键挖 / 右键插旗`);
    }

    return {
      mount(el, appCtx) {
        root = el; ctx = appCtx;
        reset();
        gridEl.addEventListener('click', onGridClick);
        root.addEventListener('contextmenu', onCtx);
        window.__smokeState = () => ({
          remain: R * C - M - dug, flags, over, win, dug, mines: M,
        });
        // 冒烟用：挖中间那格（首挖必安全，会展开一片）
        window.__mnOpen = () => { dig(Math.floor(R / 2), Math.floor(C / 2)); return true; };
      },
      destroy() {
        if (root) root.removeEventListener('contextmenu', onCtx);
        try { delete window.__smokeState; } catch (e) { window.__smokeState = null; }
        try { delete window.__mnOpen; } catch (e) { window.__mnOpen = null; }
      },
      onDiffChange(d) { if (d !== diff) { diff = d; reset(); } },
      onNewGame() { reset(); },
      undo() {
        if (over || !hist.length) return false;
        restore(hist.pop());
        render();
        ctx.setStatus(`悔了一步 · 剩余 ${M - flags} 雷`);
        return true;
      },
    };
  }

  window.GlassGames.register({
    id: 'minesweeper',
    name: '扫雷',
    icon: '⊞',
    factory,
    flags: { hasAI: false },     // 没有对手 → 隐藏模式切换 / LLM 设置
  });
})();
