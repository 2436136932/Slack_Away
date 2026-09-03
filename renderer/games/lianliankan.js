/* ============================================================
 * lianliankan.js — 连连看
 *
 * 纯鼠标：点两个同图案的方块，路径转弯 ≤2 次就能消。
 * 难度 = 棋盘大小：简单 5×6=30 张，中等 6×8=48 张，困难 7×10=70 张。
 *
 * 寻路：在"虚拟棋盘"上 BFS（外围多一圈永远可走），状态 = (行,列,方向)，
 * 代价 = 转弯次数，≤2 即可连。找到后把路径画成 SVG 折线，260ms 后淡出。
 * 无解时自动重排剩下的方块（洗牌直到出现可消对）。
 * ============================================================ */
(function () {
  'use strict';

  const LEVELS = {
    easy:   { R: 5, C: 6 },
    medium: { R: 6, C: 8 },
    hard:   { R: 7, C: 10 },
  };

  // 图案池（低饱和 emoji，靠 opacity 联动墨色滑块）
  const ICONS = [
    '🍎', '🍇', '🍊', '🍋', '🍉', '🍓', '🥝', '🍑', '🍍', '🥑',
    '🌽', '🍄', '🌰', '🥕', '🍒', '🫐', '🍆', '🥔', '🐱', '🐼',
    '🦊', '🐸', '🐙', '🦋', '🐢', '🐧', '🦉', '🐝', '🌻', '🍀',
    '⭐', '🌙', '☀', '⚡', '❄', '☂', '⭐', '✿',
  ];

  const GAP = 4;            // 与 CSS .ll-grid 的 gap 保持一致
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function factory() {
    let root, ctx = null, diff = 'medium';
    let R = 0, C = 0;                 // 真实棋盘 R 行 C 列
    let grid = [];                    // 虚拟棋盘 (R+2)×(C+2)，0=空，>0=图案 id
    let left = 0;                     // 剩余方块数
    let sel = null;                   // {r,c} 已选中
    let hist = [];                    // 撤销栈：[{r,c,t},{r,c,t}]
    let tileEls = [];                 // 真实棋盘格子 DOM（按 (r-1)*C+(c-1) 索引）
    let wrapEl = null, gridEl = null, svgEl = null;
    let onClick = null;

    function newGrid() { return Array.from({ length: R + 2 }, () => new Array(C + 2).fill(0)); }

    /* ---------- 生成棋盘（保证每种图案成对） ---------- */
    function genBoard() {
      grid = newGrid();
      const pairs = (R * C) / 2;
      const T = Math.min(ICONS.length, pairs);
      const bag = [];
      for (let i = 0; i < pairs; i++) bag.push((i % T) + 1);
      const tiles = bag.concat(bag);
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t;
      }
      let p = 0;
      for (let r = 1; r <= R; r++) for (let c = 1; c <= C; c++) grid[r][c] = tiles[p++];
      left = R * C;
    }

    /* ---------- 寻路：转弯 ≤2 ---------- */
    const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

    function findPath(a, b) {
      const W = C + 2, H = R + 2;
      const key = (r, c, d) => (r * W + c) * 4 + d;
      const bestT = new Map(), prev = new Map();
      const q = [];
      for (let d = 0; d < 4; d++) {
        const k = key(a.r, a.c, d);
        bestT.set(k, 0); prev.set(k, -1);
        q.push({ r: a.r, c: a.c, d, t: 0, k });
      }
      let head = 0, endKey = -1;
      while (head < q.length) {
        const cur = q[head++];
        if (cur.t > 2) continue;
        const nr = cur.r + DIRS[cur.d][0], nc = cur.c + DIRS[cur.d][1];
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        if (nr === b.r && nc === b.c) { endKey = cur.k; break; }
        if (grid[nr][nc] !== 0) continue;
        for (const nd of [cur.d, (cur.d + 1) % 4, (cur.d + 3) % 4]) {
          const nt = cur.t + (nd === cur.d ? 0 : 1);
          if (nt > 2) continue;
          const k = key(nr, nc, nd);
          if (bestT.has(k) && bestT.get(k) <= nt) continue;
          bestT.set(k, nt);
          prev.set(k, cur.k);
          q.push({ r: nr, c: nc, d: nd, t: nt, k });
        }
      }
      if (endKey === -1) return null;
      // 回溯路径
      const pts = [{ r: b.r, c: b.c }];
      let k = endKey;
      while (k !== -1 && k !== undefined) {
        pts.unshift({ r: Math.floor(k / 4 / W), c: Math.floor(k / 4) % W });
        k = prev.get(k);
      }
      return pts;
    }

    /* ---------- 是否存在可消对 ---------- */
    function findAnyPair() {
      for (let r1 = 1; r1 <= R; r1++) for (let c1 = 1; c1 <= C; c1++) {
        if (!grid[r1][c1]) continue;
        for (let r2 = 1; r2 <= R; r2++) for (let c2 = 1; c2 <= C; c2++) {
          if (r1 === r2 && c1 === c2) continue;
          if (grid[r2][c2] !== grid[r1][c1]) continue;
          const p = findPath({ r: r1, c: c1 }, { r: r2, c: c2 });
          if (p) return [{ r: r1, c: c1 }, { r: r2, c: c2 }, p];
        }
      }
      return null;
    }

    /* ---------- 无解时重排剩余方块 ---------- */
    function reshuffle() {
      const vals = [];
      for (let r = 1; r <= R; r++) for (let c = 1; c <= C; c++) if (grid[r][c]) vals.push(grid[r][c]);
      for (let tryN = 0; tryN < 60; tryN++) {
        for (let i = vals.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = vals[i]; vals[i] = vals[j]; vals[j] = t;
        }
        let p = 0;
        for (let r = 1; r <= R; r++) for (let c = 1; c <= C; c++) if (grid[r][c]) grid[r][c] = vals[p++];
        if (findAnyPair()) { syncTiles(); return true; }
      }
      return false;
    }

    /* ---------- DOM ---------- */
    function buildDom() {
      root.innerHTML = '';
      wrapEl = document.createElement('div');
      wrapEl.className = 'll-wrap';
      gridEl = document.createElement('div');
      gridEl.className = 'll-grid';
      gridEl.style.setProperty('--c', String(C));
      tileEls = [];
      for (let r = 1; r <= R; r++) for (let c = 1; c <= C; c++) {
        const el = document.createElement('div');
        el.className = 'll-tile';
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.innerHTML = '<span class="e"></span>';
        gridEl.appendChild(el);
        tileEls.push(el);
      }
      svgEl = document.createElementNS(SVG_NS, 'svg');
      svgEl.setAttribute('class', 'll-svg');
      wrapEl.appendChild(gridEl);
      wrapEl.appendChild(svgEl);
      root.appendChild(wrapEl);
    }

    /** 把数据同步到 DOM（方块图案 / 已消状态） */
    function syncTiles() {
      for (let r = 1; r <= R; r++) for (let c = 1; c <= C; c++) {
        const el = tileEls[(r - 1) * C + (c - 1)];
        const v = grid[r][c];
        el.firstChild.textContent = v ? ICONS[(v - 1) % ICONS.length] : '';
        el.classList.toggle('gone', !v);
      }
    }

    /** 虚拟坐标 → 像素中心（外圈坐标往外推一个格距） */
    function centerOf(r, c) {
      const rr = Math.min(Math.max(r, 1), R), cc = Math.min(Math.max(c, 1), C);
      const el = tileEls[(rr - 1) * C + (cc - 1)];
      const w = el.offsetWidth, h = el.offsetHeight;
      let x = el.offsetLeft + w / 2, y = el.offsetTop + h / 2;
      if (c === 0) x -= (w + GAP); else if (c === C + 1) x += (w + GAP);
      if (r === 0) y -= (h + GAP); else if (r === R + 1) y += (h + GAP);
      return { x, y };
    }

    function drawPath(pts) {
      svgEl.innerHTML = '';
      if (!pts || pts.length < 2) return;
      const d = pts.map((p, i) => {
        const { x, y } = centerOf(p.r, p.c);
        return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      }).join(' ');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'll-path');
      svgEl.appendChild(path);
      setTimeout(() => { try { svgEl.innerHTML = ''; } catch (e) {} }, 300);
    }

    /* ---------- 点击 ---------- */
    onClick = (e) => {
      const el = e.target.closest('.ll-tile');
      if (!el || el.classList.contains('gone')) return;
      const r = Number(el.dataset.r), c = Number(el.dataset.c);
      const t = grid[r][c];
      if (!t) return;

      if (!sel) { sel = { r, c }; el.classList.add('sel'); return; }
      if (sel.r === r && sel.c === c) { el.classList.remove('sel'); sel = null; return; }

      const a = sel, b = { r, c };
      el.classList.add('sel');
      if (t !== grid[a.r][a.c]) {
        // 图案不同：改选新的
        clearSel();
        sel = b; el.classList.add('sel');
        return;
      }
      const path = findPath(a, b);
      if (!path) {
        clearSel();
        sel = b; el.classList.add('sel');
        ctx.setStatus('这两个连不上（转弯超过 2 次）');
        return;
      }
      drawPath(path);
      hist.push([{ r: a.r, c: a.c, t: grid[a.r][a.c] }, { r: b.r, c: b.c, t: grid[b.r][b.c] }]);
      if (hist.length > 100) hist.shift();
      // 闪一下再消失
      [a, b].forEach(p => tileEls[(p.r - 1) * C + (p.c - 1)].classList.add('hit'));
      setTimeout(() => {
        grid[a.r][a.c] = 0; grid[b.r][b.c] = 0;
        [a, b].forEach(p => {
          const t2 = tileEls[(p.r - 1) * C + (p.c - 1)];
          t2.classList.remove('hit'); t2.classList.add('gone');
          t2.firstChild.textContent = '';
        });
        left -= 2;
        afterRemove();
      }, 140);
      clearSel();
    };

    function clearSel() {
      tileEls.forEach(el => el.classList.remove('sel'));
      sel = null;
    }

    function afterRemove() {
      if (left <= 0) {
        ctx.setStatus('全消完了（低调收好）');
        if (ctx.onGameEnd) ctx.onGameEnd('player');
        return;
      }
      if (!findAnyPair()) {
        if (reshuffle()) {
          ctx.setStatus(`剩余 ${left} 张 · 已自动重排`);
        } else {
          ctx.setStatus(`剩余 ${left} 张 · 无解了，点新局`);
        }
        return;
      }
      ctx.setStatus(`剩余 ${left} 张 · 点两个相同的消掉`);
    }

    function reset() {
      const L = LEVELS[diff] || LEVELS.medium;
      R = L.R; C = L.C;
      sel = null; hist = [];
      buildDom();
      genBoard();
      syncTiles();
      if (!findAnyPair()) reshuffle();
      ctx.setStatus(`连连看 ${R}×${C} · 剩余 ${left} 张`);
    }

    return {
      mount(el, appCtx) {
        root = el; ctx = appCtx;
        reset();
        gridEl.addEventListener('click', onClick);
        window.__smokeState = () => ({
          left, rows: R, cols: C,
          hasPair: !!findAnyPair(),
          selected: sel ? (sel.r + ',' + sel.c) : '',
        });
        // 冒烟用：返回一对可消的坐标，供测试脚本自动点击
        window.__llPair = () => {
          const p = findAnyPair();
          return p ? { a: p[0], b: p[1] } : null;
        };
      },
      destroy() {
        try { delete window.__smokeState; } catch (e) { window.__smokeState = null; }
        try { delete window.__llPair; } catch (e) { window.__llPair = null; }
      },
      onDiffChange(d) { if (d !== diff) { diff = d; reset(); } },
      onNewGame() { reset(); },
      undo() {
        const last = hist.pop();
        if (!last) return false;
        last.forEach(p => { grid[p.r][p.c] = p.t; });
        left += 2;
        syncTiles();
        ctx.setStatus(`悔了一步 · 剩余 ${left} 张`);
        return true;
      },
    };
  }

  window.GlassGames.register({
    id: 'lianliankan',
    name: '连连看',
    icon: '🀄',
    factory,
    flags: { hasAI: false },
  });
})();
