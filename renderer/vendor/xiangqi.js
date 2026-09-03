/* ============================================================
 * 中国象棋引擎 xiangqi.js (UMD)
 * 浏览器：挂 window.XQ；Service Worker(importScripts)：挂 self.XQ；
 * Node：module.exports（用于单测）。
 *
 * 棋盘坐标：9 列(0-8 → a-i) × 10 行(0-9)。
 *   row 0 = 黑方底线（上方）；row 9 = 红方底线（下方）。
 *   对外坐标行号 1-10：行号 1 = row0（上），行号 10 = row9（下）。
 *   走法坐标格式：列字母+行号连写，如 h2h3（从 h2 走到 h3）。
 * ============================================================ */
(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { global.XQ = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 9, ROWS = 10;
  const RED = 'r', BLACK = 'b';
  const VALUE = { K: 1000000, R: 900, C: 450, N: 400, B: 200, A: 200, P: 100 };

  // 汉字（渲染用）：红方 帅仕相马车炮兵；黑方 将士象马车炮卒
  const CN = {
    r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
    b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
  };

  // 局面字符串编码：空 '.', 红子大写类型字母, 黑子小写类型字母
  function enc(p) { return p ? (p.c === RED ? p.t : p.t.toLowerCase()) : '.'; }
  function dec(ch) {
    if (!ch || ch === '.' || ch === '0' || ch === ' ') return null;
    const t = ch.toUpperCase();
    const c = (ch === ch.toUpperCase()) ? RED : BLACK;
    return { t, c };
  }

  function inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

  function cloneBoard(b) {
    return b.map(row => row.map(p => (p ? { t: p.t, c: p.c } : null)));
  }

  function initialBoard() {
    const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const back = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
    for (let c = 0; c < COLS; c++) {
      b[0][c] = { t: back[c], c: BLACK };
      b[9][c] = { t: back[c], c: RED };
    }
    b[2][1] = { t: 'C', c: BLACK }; b[2][7] = { t: 'C', c: BLACK };
    b[7][1] = { t: 'C', c: RED };   b[7][7] = { t: 'C', c: RED };
    for (let c = 0; c < COLS; c += 2) {
      b[3][c] = { t: 'P', c: BLACK };
      b[6][c] = { t: 'P', c: RED };
    }
    return b;
  }

  function findKing(b, color) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (p && p.t === 'K' && p.c === color) return { r, c };
    }
    return null;
  }

  /* ---------- 伪合法走法生成（不考虑送将/照面） ---------- */
  function genMoves(b, color) {
    const moves = [];
    const add = (fr, fc, tr, tc) => {
      const tp = b[tr][tc];
      if (!tp || tp.c !== color) moves.push({ fr, fc, tr, tc });
    };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (!p || p.c !== color) continue;
        switch (p.t) {
          case 'R': {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dr, dc] of dirs) {
              let nr = r + dr, nc = c + dc;
              while (inBoard(nr, nc)) {
                if (!b[nr][nc]) add(r, c, nr, nc);
                else { if (b[nr][nc].c !== color) add(r, c, nr, nc); break; }
                nr += dr; nc += dc;
              }
            }
            break;
          }
          case 'C': {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dr, dc] of dirs) {
              let nr = r + dr, nc = c + dc;
              while (inBoard(nr, nc) && !b[nr][nc]) { add(r, c, nr, nc); nr += dr; nc += dc; }
              if (!inBoard(nr, nc)) continue;
              nr += dr; nc += dc; // 越过炮架
              while (inBoard(nr, nc)) {
                if (!b[nr][nc]) { nr += dr; nc += dc; continue; }
                if (b[nr][nc].c !== color) add(r, c, nr, nc);
                break;
              }
            }
            break;
          }
          case 'N': {
            const cand = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
            for (const [dr, dc] of cand) {
              const tr = r + dr, tc = c + dc;
              if (!inBoard(tr, tc)) continue;
              let br, bc;
              if (Math.abs(dr) === 2) { br = r + dr / 2; bc = c; }
              else { br = r; bc = c + dc / 2; }
              if (b[br][bc]) continue; // 蹩马腿
              add(r, c, tr, tc);
            }
            break;
          }
          case 'B': {
            const cand = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
            for (const [dr, dc] of cand) {
              const tr = r + dr, tc = c + dc;
              if (!inBoard(tr, tc)) continue;
              if (color === RED && tr < 5) continue;   // 相不过河
              if (color === BLACK && tr > 4) continue; // 象不过河
              if (b[r + dr / 2][c + dc / 2]) continue; // 塞象眼
              add(r, c, tr, tc);
            }
            break;
          }
          case 'A': {
            const cand = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
            for (const [dr, dc] of cand) {
              const tr = r + dr, tc = c + dc;
              if (!inBoard(tr, tc)) continue;
              if (color === RED && !(tr >= 7 && tr <= 9 && tc >= 3 && tc <= 5)) continue;
              if (color === BLACK && !(tr >= 0 && tr <= 2 && tc >= 3 && tc <= 5)) continue;
              add(r, c, tr, tc);
            }
            break;
          }
          case 'K': {
            const cand = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dr, dc] of cand) {
              const tr = r + dr, tc = c + dc;
              if (!inBoard(tr, tc)) continue;
              if (color === RED && !(tr >= 7 && tr <= 9 && tc >= 3 && tc <= 5)) continue;
              if (color === BLACK && !(tr >= 0 && tr <= 2 && tc >= 3 && tc <= 5)) continue;
              // 飞将：目标为对方将时，必须中间无子才合法（正常走法不含此情况，
              // 因为对方将不在己方九宫邻格；照面局面的排除交给 legalMoves）
              add(r, c, tr, tc);
            }
            break;
          }
          case 'P': {
            const dir = color === RED ? -1 : 1;
            const fr2 = r + dir, fc2 = c;
            if (inBoard(fr2, fc2) && (!b[fr2][fc2] || b[fr2][fc2].c !== color)) add(r, c, fr2, fc2);
            const crossed = color === RED ? r <= 4 : r >= 5; // 过河后可左右
            if (crossed) {
              for (const dc of [-1, 1]) {
                const tr = r, tc = c + dc;
                if (inBoard(tr, tc) && (!b[tr][tc] || b[tr][tc].c !== color)) add(r, c, tr, tc);
              }
            }
            break;
          }
        }
      }
    }
    return moves;
  }

  function applyMove(b, m) {
    const nb = cloneBoard(b);
    nb[m.tr][m.tc] = nb[m.fr][m.fc];
    nb[m.fr][m.fc] = null;
    return nb;
  }

  // (r,c) 是否被 byColor 攻击
  function isAttacked(b, r, c, byColor) {
    const moves = genMoves(b, byColor);
    for (const m of moves) if (m.tr === r && m.tc === c) return true;
    return false;
  }

  function isInCheck(b, color) {
    const k = findKing(b, color);
    if (!k) return false;
    const enemy = color === RED ? BLACK : RED;
    return isAttacked(b, k.r, k.c, enemy);
  }

  // 合法走法（过滤送将/照面局面）
  function legalMoves(b, color) {
    const enemy = color === RED ? BLACK : RED;
    const pseudo = genMoves(b, color);
    const out = [];
    for (const m of pseudo) {
      const nb = applyMove(b, m);
      const k = findKing(nb, color);
      if (!k) continue;
      if (!isAttacked(nb, k.r, k.c, enemy)) out.push(m);
    }
    return out;
  }

  /* ---------- 序列化 ---------- */
  function toStr(b) {
    return b.map(row => row.map(enc).join('')).join('\n');
  }
  function fromStr(s) {
    const rows = String(s).trim().split(/[\n;]/).map(x => x.trim()).filter(x => x.length);
    const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    for (let r = 0; r < Math.min(rows.length, ROWS); r++) {
      const line = rows[r];
      for (let c = 0; c < Math.min(line.length, COLS); c++) b[r][c] = dec(line[c]);
    }
    return b;
  }
  function boardKey(b, turn) {
    return (turn === RED ? 'r' : 'b') + toStr(b).replace(/\n/g, '');
  }

  // 坐标解析：h2h3 -> {fr,fc,tr,tc}（行号1=row0 上，行号10=row9 下）
  function parseCoord(text) {
    if (!text) return null;
    const m = String(text).toUpperCase().match(/([A-I])\s*([1-9]|10)\s*([A-I])\s*([1-9]|10)/);
    if (!m) return null;
    const colOf = ch => 'ABCDEFGHI'.indexOf(ch);
    const fr = parseInt(m[2], 10) - 1, fc = colOf(m[1]);
    const tr = parseInt(m[4], 10) - 1, tc = colOf(m[3]);
    if (fr < 0 || fr >= ROWS || fc < 0 || fc >= COLS) return null;
    if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return null;
    return { fr, fc, tr, tc };
  }

  /* ---------- 评估（红方视角正值，黑方负值） ---------- */
  const PPOS = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 1, 3, 5, 3, 1, 1, 1],
    [6, 6, 8, 12, 14, 12, 8, 6, 6],
    [10, 10, 12, 16, 18, 16, 12, 10, 10],
    [10, 10, 12, 16, 18, 16, 12, 10, 10],
    [10, 10, 12, 16, 18, 16, 12, 10, 10],
    [10, 10, 12, 16, 18, 16, 12, 10, 10],
    [6, 6, 8, 12, 14, 12, 8, 6, 6],
    [1, 1, 1, 3, 5, 3, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
  function evaluate(b) {
    let s = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (!p) continue;
        let v = VALUE[p.t];
        if (p.t === 'P') { const rr = p.c === RED ? r : (9 - r); v += PPOS[rr][c] || 0; }
        if (p.t === 'N' || p.t === 'C') v += (4 - Math.abs(c - 4)) * 4; // 中心加成
        if (p.t === 'K') v += (p.c === RED ? r : (9 - r)) * 2; // 将躲后方略好
        s += (p.c === RED ? v : -v);
      }
    }
    return s;
  }

  function capScore(b, m) { const tp = b[m.tr][m.tc]; return tp ? (VALUE[tp.t] || 0) : 0; }

  /* ---------- 搜索：negamax + alpha-beta ---------- */
  function negamax(b, depth, alpha, beta, color, node) {
    if (depth === 0) return (color === RED ? evaluate(b) : -evaluate(b));
    const moves = legalMoves(b, color);
    if (!moves.length) return color === RED ? -900000 - depth : 900000 + depth;
    moves.sort((x, y) => capScore(b, y) - capScore(b, x)); // 吃子优先提升剪枝
    let best = -Infinity;
    for (const m of moves) {
      node.n++;
      if (node.n > node.limit) return (color === RED ? evaluate(b) : -evaluate(b));
      const nb = applyMove(b, m);
      const val = -negamax(nb, depth - 1, -beta, -alpha, color === RED ? BLACK : RED, node);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // 主搜索：返回最佳走法 {fr,fc,tr,tc}
  function search(b, color, diff) {
    const depthMap = { easy: 1, medium: 2, hard: 3 };
    const depth = depthMap[diff] || 2;
    const nodeLimit = diff === 'hard' ? 120000 : (diff === 'medium' ? 40000 : 8000);
    const moves = legalMoves(b, color);
    if (!moves.length) return null;
    moves.sort((x, y) => capScore(b, y) - capScore(b, x));
    if (diff === 'easy') {
      // 简单档：在评分靠前的若干手里随机选，偏进攻、水平有限
      const top = moves.slice(0, Math.min(moves.length, 8));
      return top[Math.floor(Math.random() * top.length)];
    }
    const node = { n: 0, limit: nodeLimit };
    let best = null, bestVal = -Infinity;
    for (const m of moves) {
      const nb = applyMove(b, m);
      const val = -negamax(nb, depth - 1, -Infinity, Infinity, color === RED ? BLACK : RED, node);
      if (val > bestVal) { bestVal = val; best = m; }
    }
    return best;
  }

  return {
    RED, BLACK, COLS, ROWS, CN, VALUE,
    initialBoard, cloneBoard, findKing, inBoard,
    genMoves, applyMove, isAttacked, isInCheck, legalMoves,
    toStr, fromStr, boardKey, parseCoord, enc, dec,
    evaluate, search,
  };
});
