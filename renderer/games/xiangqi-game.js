/* ============================================================
 * games/xiangqi-game.js — 中国象棋（注册表插件）
 *   规则引擎复用原项目 xiangqi.js（window.XQ，UMD）
 *   Canvas 绘制 + XQ negamax 本地 AI
 *   LLM 模式：把合法走法列表发给大模型挑一个，失败回退本地
 * ============================================================ */
(function () {
  'use strict';

  const CN = {
    r: { K: '帥', A: '仕', B: '相', N: '馬', R: '車', C: '炮', P: '兵' },
    b: { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '炮', P: '卒' },
  };

  function factory() {
    let root, canvas, ctx2d, ctx = null;
    let board = null, turn = 'r';
    let moves = [];                // 悔棋栈：[{m:{fr,fc,tr,tc}, captured, side}, ...]
    let playing = false, thinking = false;
    let diff = 'medium', mode = 'local';
    let selected = null;          // {r,c} 已选中的己方棋子
    let legalTargets = [];        // 选中子的合法落点
    let lastMove = null;          // {fr,fc,tr,tc}
    let cellSize = 0, padX = 0, padY = 0, bw = 0, bh = 0;
    let resizeObs = null;
    let lastSizeW = 0, lastSizeH = 0;   // 上次 layout 尺寸，阈值抖动

    const W = 9, H = 10;          // 9 列 10 行

    function reset() {
      board = window.XQ.initialBoard();
      moves = [];
      turn = 'r';
      playing = true;
      thinking = false;
      selected = null; legalTargets = []; lastMove = null;
      draw();
      ctx.setStatus('你执红先行，点棋子再点落点');
    }

    function layout() {
      const rect = root.getBoundingClientRect();
      const availW = rect.width - 8, availH = rect.height - 8;
      cellSize = Math.max(22, Math.min(availW / (W + 1), availH / (H + 1)));
      bw = cellSize * (W - 1);
      bh = cellSize * (H - 1);
      const sizeW = bw + cellSize * 2, sizeH = bh + cellSize * 2;
      const dpr = window.devicePixelRatio || 1;
      // 抖动阈值：尺寸变化小于 2px 时不重设 canvas.width（避免清屏重绘造成视觉抖动）
      if (Math.abs(sizeW - lastSizeW) < 2 && Math.abs(sizeH - lastSizeH) < 2 && canvas && canvas.width) {
        padX = cellSize; padY = cellSize;
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
        return;
      }
      lastSizeW = sizeW; lastSizeH = sizeH;
      canvas.style.width = sizeW + 'px';
      canvas.style.height = sizeH + 'px';
      canvas.width = Math.round(sizeW * dpr);
      canvas.height = Math.round(sizeH * dpr);
      padX = cellSize; padY = cellSize;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    function stoneAlpha() {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--stone-alpha');
      const n = parseFloat(v);
      return isNaN(n) ? 0.9 : n;
    }
    /* 墨色浓度：0 = 完全中性灰（最不显眼），1 = 用足底色（最清晰） */
    function stoneInk() {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--stone-ink');
      const n = parseFloat(v);
      return isNaN(n) ? 0.6 : n;
    }

    /* 低对比配色：鲜红 #c0392b 和深蓝灰在浅玻璃上对比过强，光降 alpha 只是"变淡"。
       让颜色本身随透明度向中性灰收敛（降明度差 + 降饱和），才是真的融进背景。 */
    const NEUTRAL = [168, 172, 180];
    function mix(base, a) {
      const t = Math.max(0, Math.min(1, a));
      return Math.round(NEUTRAL[0] + (base[0] - NEUTRAL[0]) * t) + ','
           + Math.round(NEUTRAL[1] + (base[1] - NEUTRAL[1]) * t) + ','
           + Math.round(NEUTRAL[2] + (base[2] - NEUTRAL[2]) * t);
    }

    function draw() {
      if (!ctx2d || !board) return;
      const alpha = stoneAlpha();
      const ink = stoneInk();                 // 颜色浓度（0 灰 ~ 1 实）
      const k = alpha * ink;                  // 最终插值强度
      const lineA = 0.025 + 0.26 * k;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);

      const X = c => padX + c * cellSize;
      const Y = r => padY + r * cellSize;

      // 横线（浅灰，不用深灰）
      ctx2d.strokeStyle = `rgba(134,139,149,${lineA})`;
      ctx2d.lineWidth = 1;
      for (let r = 0; r < H; r++) {
        ctx2d.beginPath();
        ctx2d.moveTo(X(0), Y(r)); ctx2d.lineTo(X(W - 1), Y(r));
        ctx2d.stroke();
      }
      // 竖线（楚河汉界断开）
      for (let c = 0; c < W; c++) {
        if (c === 0 || c === W - 1) {
          ctx2d.beginPath();
          ctx2d.moveTo(X(c), Y(0)); ctx2d.lineTo(X(c), Y(H - 1));
          ctx2d.stroke();
        } else {
          ctx2d.beginPath();
          ctx2d.moveTo(X(c), Y(0)); ctx2d.lineTo(X(c), Y(4));
          ctx2d.stroke();
          ctx2d.beginPath();
          ctx2d.moveTo(X(c), Y(5)); ctx2d.lineTo(X(c), Y(H - 1));
          ctx2d.stroke();
        }
      }
      // 九宫斜线
      for (const [r1, c1, r2, c2] of [[0, 3, 2, 5], [0, 5, 2, 3], [7, 3, 9, 5], [7, 5, 9, 3]]) {
        ctx2d.beginPath();
        ctx2d.moveTo(X(c1), Y(r1)); ctx2d.lineTo(X(c2), Y(r2));
        ctx2d.stroke();
      }
      // 楚河汉界
      ctx2d.fillStyle = `rgba(134,139,149,${0.05 + 0.28 * k})`;
      ctx2d.font = `${Math.round(cellSize * 0.5)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
      const midY = Y(4.5);
      ctx2d.fillText('楚 河', X(1.5), midY);
      ctx2d.fillText('漢 界', X(6.5), midY);

      // 棋子 Pass 1：把棋子内部擦成全透明（底座直接透明，桌面透出来）
      ctx2d.save();
      ctx2d.globalCompositeOperation = 'destination-out';
      ctx2d.fillStyle = '#000';
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        if (!board[r][c]) continue;
        ctx2d.beginPath();
        ctx2d.arc(X(c), Y(r), cellSize * 0.44, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.restore();

      // 棋子 Pass 2：极淡内衬 + 细环 + 字（主体是空心环）
      const innerA = 0.02 + 0.20 * k;          // 内衬：默认几乎透明
      const ringA  = 0.24 + 0.44 * alpha;      // 细环：主要辨识来源
      ctx2d.lineWidth = 1.2;
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const p = board[r][c];
        if (!p) continue;
        const x = X(c), y = Y(r);
        const rad = cellSize * 0.44;
        const isRed = p.c === 'r';
        // 内衬 + 环
        ctx2d.fillStyle = isRed
          ? `rgba(${mix([250, 241, 239], k)},${innerA})`
          : `rgba(${mix([234, 236, 242], k)},${innerA})`;
        ctx2d.strokeStyle = isRed
          ? `rgba(${mix([186, 118, 110], k)},${ringA})`
          : `rgba(${mix([92, 106, 128], k)},${ringA})`;
        ctx2d.beginPath();
        ctx2d.arc(x, y, rad, 0, Math.PI * 2);
        ctx2d.fill(); ctx2d.stroke();
        // 字（没了白底，字要稍微实一点才看得清）
        ctx2d.fillStyle = isRed
          ? `rgba(${mix([186, 112, 104], k)},${0.44 + 0.42 * alpha})`
          : `rgba(${mix([84, 98, 120], k)},${0.44 + 0.42 * alpha})`;
        ctx2d.font = `500 ${Math.round(cellSize * 0.46)}px "PingFang SC", "Microsoft YaHei", serif`;
        ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
        ctx2d.fillText(CN[p.c][p.t], x, y + 0.5);
      }

      // 上一步痕迹（灰蓝，不用亮蓝；画在棋子之上，避免被擦除）
      if (lastMove) {
        ctx2d.strokeStyle = `rgba(${mix([126, 144, 170], k)},${0.14 + 0.24 * alpha})`;
        ctx2d.lineWidth = 1.5;
        for (const [r, c] of [[lastMove.fr, lastMove.fc], [lastMove.tr, lastMove.tc]]) {
          ctx2d.beginPath();
          ctx2d.arc(X(c), Y(r), cellSize * 0.5, 0, Math.PI * 2);
          ctx2d.stroke();
        }
      }

      // 选中高亮 + 合法落点（画在棋子之上）
      if (selected) {
        ctx2d.fillStyle = `rgba(${mix([126, 144, 170], k)},${0.08 + 0.14 * alpha})`;
        ctx2d.beginPath();
        ctx2d.arc(X(selected.c), Y(selected.r), cellSize * 0.5, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.fillStyle = `rgba(${mix([112, 132, 162], k)},${0.18 + 0.28 * alpha})`;
        for (const m of legalTargets) {
          ctx2d.beginPath();
          ctx2d.arc(X(m.tc), Y(m.tr), 3.2, 0, Math.PI * 2);
          ctx2d.fill();
        }
      }
    }

    function posToCell(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - padX, y = e.clientY - rect.top - padY;
      const c = Math.round(x / cellSize), r = Math.round(y / cellSize);
      if (r < 0 || r >= H || c < 0 || c >= W) return null;
      if (Math.abs(x - c * cellSize) > cellSize * 0.45 || Math.abs(y - r * cellSize) > cellSize * 0.45) return null;
      return { r, c };
    }

    function onClick(e) {
      if (!playing || thinking || turn !== 'r') return;
      const cell = posToCell(e);
      if (!cell) return;
      const p = board[cell.r][cell.c];

      if (selected) {
        const m = legalTargets.find(m => m.tr === cell.r && m.tc === cell.c);
        if (m) { doMove(m); return; }
      }
      if (p && p.c === 'r') {
        selected = cell;
        legalTargets = window.XQ.legalMoves(board, 'r').filter(m => m.fr === cell.r && m.fc === cell.c);
        draw();
        ctx.setStatus(`选中${CN.r[p.t]}，共 ${legalTargets.length} 个合法落点`);
      } else {
        selected = null; legalTargets = [];
        draw();
      }
    }

    function doMove(m) {
      const captured = board[m.tr][m.tc];
      board[m.tr][m.tc] = board[m.fr][m.fc];
      board[m.fr][m.fc] = null;
      lastMove = m;
      moves.push({ m: { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc }, captured, side: turn });
      selected = null; legalTargets = [];
      draw();

      // 吃将 = 胜负
      if (captured && captured.t === 'K') {
        playing = false;
        ctx.onGameEnd(captured.c);
        ctx.setStatus(captured.c === 'b' ? '你赢了（低调收好）' : 'AI 赢了，再来一把？');
        return;
      }
      turn = turn === 'r' ? 'b' : 'r';

      // 无子可走 = 负
      const side = turn;
      if (!window.XQ.legalMoves(board, side).length) {
        playing = false;
        ctx.setStatus(side === 'b' ? '黑方无棋可走，你赢！' : '红方无棋可走，AI 赢');
        return;
      }

      if (turn === 'b') aiTurn();
      else ctx.setStatus('轮到你（红）');
    }

    function undo() {
      if (thinking || !playing) return false;
      // 撤销最近两步（玩家红 + AI 黑），让玩家重新走
      const last = moves.pop();
      if (!last) return false;
      // 还原棋子
      board[last.m.fr][last.m.fc] = board[last.m.tr][last.m.tc];
      board[last.m.tr][last.m.tc] = last.captured;
      // 如果撤销的是 AI（黑），再撤销玩家（红）
      if (last.side === 'b' && moves.length && moves[moves.length - 1].side === 'r') {
        const prev = moves.pop();
        board[prev.m.fr][prev.m.fc] = board[prev.m.tr][prev.m.tc];
        board[prev.m.tr][prev.m.tc] = prev.captured;
      }
      lastMove = moves.length
        ? { fr: moves[moves.length - 1].m.fr, fc: moves[moves.length - 1].m.fc,
            tr: moves[moves.length - 1].m.tr, tc: moves[moves.length - 1].m.tc }
        : null;
      turn = 'r';
      selected = null; legalTargets = [];
      playing = true;
      draw();
      ctx.setStatus(moves.length ? '悔棋成功，轮到你（红）' : '已悔棋到开局，点棋子再点落点');
      return true;
    }

    async function aiTurn() {
      if (!playing) return;
      thinking = true;
      ctx.setStatus(mode === 'llm' ? '大模型思考中…（失败自动回退本地）' : 'AI 思考中…');
      // 让 UI 先渲染
      await new Promise(res => setTimeout(res, 30));

      let mv = null;
      if (mode === 'llm') {
        try {
          const moves = window.XQ.legalMoves(board, 'b')
            .map(m => window.XQ.parseCoordRev ? window.XQ.parseCoordRev(m) : coordStr(m));
          mv = await llmMove(moves);
        } catch (err) {
          ctx.setStatus('大模型走棋失败（' + String(err.message || err).slice(0, 60) + '）→ 本地接管');
        }
      }
      if (!mv) {
        await new Promise(res => setTimeout(res, 200));
        mv = window.XQ.search(board, 'b', diff);
      }
      if (!playing) { thinking = false; return; }
      if (!mv) {
        playing = false;
        ctx.setStatus('黑方无棋可走，你赢！');
        return;
      }
      thinking = false;
      doMove(mv);
    }

    function coordStr(m) {
      const colOf = i => 'abcdefghi'[i];
      return colOf(m.fc) + (m.fr + 1) + colOf(m.tc) + (m.tr + 1);
    }

    async function llmMove(moveList) {
      const boardStr = board.map(row => row.map(p => {
        if (!p) return '.';
        return p.c === 'r' ? p.t : p.t.toLowerCase();
      }).join('')).join('\n');
      const text = await ctx.llm([
        { role: 'system', content: '你是一名严谨的中国象棋引擎。你只能从给出的「合法走法列表」中挑选一个，并原样输出该走法字符串（例如 h2h3），不要输出任何解释、标点或其他文字。绝对不要输出列表之外的走法。' },
        { role: 'user', content: `当前局面（红方在下方、黑方在上方；大写=红子，小写=黑子：K=将帅 R=车 N=马 B=相/象 A=士 C=炮 P=兵/卒 . =空）：\n${boardStr}\n\n轮到黑方走子。\n合法走法列表（只能选其中一个）：\n${moveList.join(', ')}\n\n请只输出你要走的走法字符串（必须严格等于列表中的某一项）：` },
      ], { temperature: 0.5, maxTokens: 64 });
      const t = text.toLowerCase();
      for (const s of moveList) if (t.includes(s)) {
        // 还原成 move 对象
        const fr = parseInt(s[1], 10) - 1, fc = 'abcdefghi'.indexOf(s[0]);
        const tr = parseInt(s[3], 10) - 1, tc = 'abcdefghi'.indexOf(s[2]);
        return { fr, fc, tr, tc };
      }
      throw new Error('未返回合法走法: ' + t.slice(0, 30));
    }

    return {
      mount(el, appCtx) {
        root = el; ctx = appCtx;
        reset();                                  // 先初始化棋盘数据
        canvas = document.createElement('canvas');
        canvas.style.cursor = 'pointer';
        root.appendChild(canvas);
        ctx2d = canvas.getContext('2d');
        canvas.addEventListener('click', onClick);
        resizeObs = new ResizeObserver(() => layout());
        resizeObs.observe(root);
        layout();                                 // 再布局绘制
        if (typeof window !== 'undefined') window.__ggDraw__ = draw;   // 调试钩子（透明度变化时手动重画）
      },
      destroy() {
        if (resizeObs) resizeObs.disconnect();
        playing = false;
      },
      onDiffChange(d) { diff = d; },
      onModeChange(m) { mode = m; },
      onNewGame() { reset(); },
      undo() { return undo(); },
    };
  }

  window.GlassGames.register({
    id: 'xiangqi',
    name: '象棋',
    icon: '♟',
    factory,
  });
})();
