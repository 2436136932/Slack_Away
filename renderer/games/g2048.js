/* ============================================================
 * g2048.js — 2048
 *
 * 纯鼠标：在盘面上按住拖一下（>24px）即滑动；也支持方向键 / WASD。
 * 难度 = 棋盘大小：简单 5×5，中等 4×4（经典），困难 3×3（真的很难）。
 * 悔棋 = 快照回退一步（最多 50 步）。
 * ============================================================ */
(function () {
  'use strict';

  const SIZES = { easy: 5, medium: 4, hard: 3 };

  function factory() {
    let root, ctx = null, diff = 'medium';
    let N = 4, grid = [], score = 0, best = 0;
    let hist = [], over = false, won = false;
    let cells = [];        // DOM 格子
    let gridEl = null;
    let dragStart = null;
    let onDown, onUp, onKey;

    function reset() {
      N = SIZES[diff] || 4;
      grid = Array.from({ length: N }, () => new Array(N).fill(0));
      score = 0; hist = []; over = false; won = false;
      addRandom(); addRandom();
      buildDom();
      render();
      ctx.setStatus(`2048 ${N}×${N} · 鼠标滑动 / 方向键 · 得分 0`);
    }

    function addRandom() {
      const empty = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) empty.push([r, c]);
      if (!empty.length) return null;
      const [r, c] = empty[Math.floor(Math.random() * empty.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
      return [r, c];
    }

    /** 一行向左合并：[2,2,0,4] → [4,4,0,0] */
    function slide(arr) {
      const v = arr.filter(x => x);
      const out = [];
      let gained = 0;
      for (let i = 0; i < v.length; i++) {
        if (i + 1 < v.length && v[i] === v[i + 1]) {
          out.push(v[i] * 2); gained += v[i] * 2; i++;
        } else out.push(v[i]);
      }
      while (out.length < arr.length) out.push(0);
      return [out, gained];
    }

    function snapshot() {
      return { grid: grid.map(r => r.slice()), score, over, won };
    }
    function restore(s) {
      grid = s.grid.map(r => r.slice()); score = s.score; over = s.over; won = s.won;
    }

    function move(dir) {
      if (over) return false;
      const before = snapshot();
      let gained = 0, moved = false;

      for (let k = 0; k < N; k++) {
        let arr;
        if (dir === 'left') arr = grid[k].slice();
        else if (dir === 'right') arr = grid[k].slice().reverse();
        else if (dir === 'up') arr = grid.map(r => r[k]);
        else arr = grid.map(r => r[k]).reverse();

        const [out, g] = slide(arr);
        gained += g;
        for (let i = 0; i < N; i++) {
          let nr, nc, val;
          if (dir === 'left') { nr = k; nc = i; val = out[i]; }
          else if (dir === 'right') { nr = k; nc = N - 1 - i; val = out[N - 1 - i]; }
          else if (dir === 'up') { nr = i; nc = k; val = out[i]; }
          else { nr = N - 1 - i; nc = k; val = out[N - 1 - i]; }
          if (grid[nr][nc] !== val) moved = true;
          grid[nr][nc] = val;
        }
      }

      if (!moved) return false;

      hist.push(before);
      if (hist.length > 50) hist.shift();
      score += gained;
      if (score > best) best = score;
      const born = addRandom();
      render(born);

      // 达到 2048：低调提示一次，继续玩下去
      if (!won && grid.some(r => r.some(v => v >= 2048))) {
        won = true;
        ctx.setStatus(`到 2048 了（低调）· 得分 ${score} · 还能继续玩`);
        if (ctx.onGameEnd) ctx.onGameEnd('player');
        return true;
      }

      if (!hasMove()) {
        over = true;
        ctx.setStatus(`无处可走了 · 得分 ${score} · 最高 ${best} · 点新局再来`);
        render();
        return true;
      }
      ctx.setStatus(`2048 ${N}×${N} · 得分 ${score} · 最高 ${best}`);
      return true;
    }

    function hasMove() {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = grid[r][c];
        if (!v) return true;
        if (c + 1 < N && grid[r][c + 1] === v) return true;
        if (r + 1 < N && grid[r + 1][c] === v) return true;
      }
      return false;
    }

    /* ---------- DOM ---------- */
    function buildDom() {
      root.innerHTML = '';
      gridEl = document.createElement('div');
      gridEl.className = 'g48-grid';
      gridEl.style.setProperty('--n', String(N));
      cells = [];
      for (let i = 0; i < N * N; i++) {
        const el = document.createElement('div');
        el.className = 'g48-cell';
        gridEl.appendChild(el);
        cells.push(el);
      }
      root.appendChild(gridEl);
    }

    function render(born) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const el = cells[r * N + c];
        const v = grid[r][c];
        el.className = 'g48-cell' + (v ? ' v' + Math.min(v, 4096) : '');
        el.textContent = v ? String(v) : '';
        if (born && born[0] === r && born[1] === c && v) {
          el.classList.add('pop');
          setTimeout(() => el.classList.remove('pop'), 180);
        }
      }
      if (over) gridEl.classList.add('over'); else gridEl.classList.remove('over');
    }

    /* ---------- 交互：鼠标拖拽 + 键盘 ---------- */
    onDown = (e) => { dragStart = { x: e.clientX, y: e.clientY }; };
    onUp = (e) => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      dragStart = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
      else move(dy > 0 ? 'down' : 'up');
    };
    onKey = (e) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { move('left'); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { move('right'); e.preventDefault(); }
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') { move('up'); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { move('down'); e.preventDefault(); }
    };

    return {
      mount(el, appCtx) {
        root = el; ctx = appCtx;
        reset();
        gridEl.addEventListener('mousedown', onDown);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('keydown', onKey);
        window.__smokeState = () => ({
          score, best, over, won,
          max: grid.reduce((m, r) => Math.max(m, ...r), 0),
          filled: grid.flat().filter(v => v).length,
        });
        // 冒烟用：直接触发一次移动（等价于鼠标滑动）
        window.__g48Move = (dir) => move(dir);
      },
      destroy() {
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKey);
        try { delete window.__smokeState; } catch (e) { window.__smokeState = null; }
        try { delete window.__g48Move; } catch (e) { window.__g48Move = null; }
      },
      onDiffChange(d) { if (d !== diff) { diff = d; reset(); } },
      onNewGame() { reset(); },
      undo() {
        if (!hist.length) return false;
        restore(hist.pop());
        over = false;
        render();
        ctx.setStatus(`悔了一步 · 得分 ${score} · 最高 ${best}`);
        return true;
      },
    };
  }

  window.GlassGames.register({
    id: 'g2048',
    name: '2048',
    icon: 'Ⓑ',
    factory,
    flags: { hasAI: false },
  });
})();
