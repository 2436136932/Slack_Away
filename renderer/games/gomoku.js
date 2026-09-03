/* ============================================================
 * games/gomoku.js — 五子棋（注册表插件）
 *   Canvas 绘制 + 棋型评估 AI（本地）
 *   LLM 模式：把棋盘发给大模型要一个坐标，失败自动回退本地
 *   棋子透明度跟随 --stone-alpha 联动玻璃透明度
 * ============================================================ */
(function () {
  'use strict';

  const N = 15;                      // 15×15 棋盘
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const COLS = 'ABCDEFGHIJKLMNO';

  /* ---------- 棋型评估 AI ---------- */
  // 五元组打分：遍历所有长度为5的窗口，按双方连子数打分
  const SCORE5 = [0, 1, 10, 100, 1000, 100000];

  function allLines() {
    // 生成所有 5 连窗口（横、竖、两条斜线）
    const lines = [];
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const er = r + dr * 4, ec = c + dc * 4;
          if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
          const cells = [];
          for (let i = 0; i < 5; i++) cells.push([r + dr * i, c + dc * i]);
          lines.push(cells);
        }
      }
    }
    return lines;
  }
  const LINES = allLines();

  // 某个空位的启发式评分：对 ai 进攻分 + 对玩家 防守分
  function pointScore(board, r, c, ai, human) {
    let atk = 0, def = 0;
    for (const line of LINES) {
      // 只评估包含 (r,c) 的窗口
      let has = false;
      for (const [lr, lc] of line) { if (lr === r && lc === c) { has = true; break; } }
      if (!has) continue;
      let a = 0, h = 0;
      for (const [lr, lc] of line) {
        const v = board[lr][lc];
        if (v === ai) a++;
        else if (v === human) h++;
      }
      if (a > 0 && h === 0) atk += SCORE5[a];
      if (h > 0 && a === 0) def += SCORE5[h] * 1.1;   // 防守略优先
    }
    return atk + def;
  }

  function neighbors(board) {
    // 只考虑已有棋子附近 2 格内的空位
    const set = new Set();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (board[r][c] === EMPTY) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && board[nr][nc] === EMPTY) {
          set.add(nr * N + nc);
        }
      }
    }
    return [...set].map(k => [Math.floor(k / N), k % N]);
  }

  function bestMove(board, ai, diff) {
    const human = ai === BLACK ? WHITE : BLACK;
    const cands = neighbors(board);
    if (!cands.length) return { r: 7, c: 7 };

    // 直接赢 / 必须堵
    for (const [r, c] of cands) {
      board[r][c] = ai;
      if (winCheck(board, r, c, ai)) { board[r][c] = EMPTY; return { r, c }; }
      board[r][c] = EMPTY;
    }
    for (const [r, c] of cands) {
      board[r][c] = human;
      if (winCheck(board, r, c, human)) { board[r][c] = EMPTY; return { r, c }; }
      board[r][c] = EMPTY;
    }

    const scored = cands
      .map(([r, c]) => ({ r, c, s: pointScore(board, r, c, ai, human) }))
      .sort((x, y) => y.s - x.s);

    if (diff === 'easy') {
      const top = scored.slice(0, Math.min(8, scored.length));
      return top[Math.floor(Math.random() * top.length)];
    }
    if (diff === 'medium') {
      const top = scored.slice(0, Math.min(3, scored.length));
      return top[Math.floor(Math.random() * top.length)];
    }
    // hard：对前 6 个候选做一层展望（对方最佳回应）
    const deep = scored.slice(0, 6);
    let best = deep[0], bestVal = -Infinity;
    for (const m of deep) {
      board[m.r][m.c] = ai;
      let worst = Infinity;
      const replyCands = neighbors(board).slice(0, 200);
      for (const [r, c] of replyCands) {
        board[r][c] = human;
        const v = pointScore(board, r, c, human, ai);  // 对方视角
        if (v < worst) worst = v;
        board[r][c] = EMPTY;
        if (worst <= bestVal) break;   // 剪枝
      }
      board[m.r][m.c] = EMPTY;
      const val = m.s + (worst === Infinity ? 0 : -worst * 0.5);
      if (val > bestVal) { bestVal = val; best = m; }
    }
    return best;
  }

  function winCheck(board, r, c, side) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let cnt = 1;
      for (const s of [1, -1]) {
        let nr = r + dr * s, nc = c + dc * s;
        while (nr >= 0 && nr < N && nc >= 0 && nc < N && board[nr][nc] === side) {
          cnt++; nr += dr * s; nc += dc * s;
        }
      }
      if (cnt >= 5) return true;
    }
    return false;
  }

  /* ---------- 工厂 ---------- */
  function factory() {
    let root, canvas, g, ctx2d, cellSize = 0, pad = 0;
    let board = [];
    let moves = [];                // 悔棋栈：[{r,c,side}, ...]
    let turn = BLACK;            // 玩家执黑先行
    let playing = false;
    let diff = 'medium', mode = 'local';
    let ctx = null;              // app 注入
    let thinking = false;
    let resizeObs = null;
    let lastSize = 0;            // 上次 layout 的尺寸（避免微抖动清屏）

    function reset() {
      board = Array.from({ length: N }, () => Array(N).fill(EMPTY));
      moves = [];
      turn = BLACK;
      playing = true;
      thinking = false;
      lastMove = null;
      draw();
      ctx.setStatus('你执黑先行，点棋盘落子');
    }

    function layout() {
      const rect = root.getBoundingClientRect();
      const size = Math.max(240, Math.min(rect.width, rect.height) - 8);
      const dpr = window.devicePixelRatio || 1;
      // 抖动阈值：尺寸变化小于 2px 时不重设 canvas.width（避免清屏重绘造成视觉抖动）
      if (Math.abs(size - lastSize) < 2 && canvas && canvas.width) {
        // 只重算坐标参数，不重设画布像素尺寸
        g = size;
        cellSize = size / (N + 1);
        pad = cellSize;
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
        return;
      }
      lastSize = size;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      g = size;
      cellSize = size / (N + 1);
      pad = cellSize;
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

    /* 低对比配色：深色棋子在浅玻璃上会形成强色块，光降 alpha 只是"变淡"，
       对比度还在。做法是让颜色本身随透明度向中性灰收敛（降明度差 + 降饱和）。 */
    const NEUTRAL = [168, 172, 180];            // alpha=0 时收敛到的中性灰
    function mix(base, a) {
      const t = Math.max(0, Math.min(1, a));
      return Math.round(NEUTRAL[0] + (base[0] - NEUTRAL[0]) * t) + ','
           + Math.round(NEUTRAL[1] + (base[1] - NEUTRAL[1]) * t) + ','
           + Math.round(NEUTRAL[2] + (base[2] - NEUTRAL[2]) * t);
    }

    function draw() {
      if (!ctx2d || !board.length) return;   // board 未初始化时不绘制
      const alpha = stoneAlpha();
      const ink = stoneInk();                 // 颜色浓度（0 灰 ~ 1 实）
      const k = alpha * ink;                  // 最终插值强度
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);

      // 网格（浅灰，不用深灰；0% 时几乎不可见）
      ctx2d.strokeStyle = `rgba(134,139,149,${0.03 + 0.26 * k})`;
      ctx2d.lineWidth = 1;
      for (let i = 0; i < N; i++) {
        const p = pad + i * cellSize;
        ctx2d.beginPath();
        ctx2d.moveTo(pad, p); ctx2d.lineTo(pad + (N - 1) * cellSize, p);
        ctx2d.stroke();
        ctx2d.beginPath();
        ctx2d.moveTo(p, pad); ctx2d.lineTo(p, pad + (N - 1) * cellSize);
        ctx2d.stroke();
      }
      // 星位
      ctx2d.fillStyle = `rgba(134,139,149,${0.05 + 0.28 * k})`;
      for (const [r, c] of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) {
        ctx2d.beginPath();
        ctx2d.arc(pad + c * cellSize, pad + r * cellSize, 2.5, 0, Math.PI * 2);
        ctx2d.fill();
      }
      // 棋子 Pass 1：把棋子内部擦成全透明（桌面直接透出来，不再是实心色块）
      ctx2d.save();
      ctx2d.globalCompositeOperation = 'destination-out';
      ctx2d.fillStyle = '#000';
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (board[r][c] === EMPTY) continue;
        ctx2d.beginPath();
        ctx2d.arc(pad + c * cellSize, pad + r * cellSize, cellSize * 0.42, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.restore();

      // 棋子 Pass 2：极淡内衬 + 细环（主体是空心环，不再是一坨色块）
      const innerA = 0.03 + 0.24 * k;          // 内衬：默认几乎透明
      const ringA  = 0.26 + 0.46 * alpha;      // 细环：主要辨识来源
      ctx2d.lineWidth = 1.1;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = board[r][c];
        if (v === EMPTY) continue;
        const x = pad + c * cellSize, y = pad + r * cellSize;
        const rad = cellSize * 0.42;
        if (v === BLACK) {
          ctx2d.fillStyle   = `rgba(${mix([74, 78, 90], k)},${innerA})`;
          ctx2d.strokeStyle = `rgba(${mix([64, 68, 80], k)},${ringA})`;
        } else {
          ctx2d.fillStyle   = `rgba(${mix([240, 241, 246], k)},${innerA})`;
          ctx2d.strokeStyle = `rgba(${mix([118, 124, 137], k)},${ringA})`;
        }
        ctx2d.beginPath();
        ctx2d.arc(x, y, rad, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.stroke();
      }
      // 最后一手小标记（低调）
      if (lastMove) {
        const x = pad + lastMove.c * cellSize, y = pad + lastMove.r * cellSize;
        const isBlack = board[lastMove.r][lastMove.c] === BLACK;
        ctx2d.fillStyle = isBlack
          ? `rgba(255,255,255,${0.20 + 0.35 * alpha})`
          : `rgba(${mix([86, 90, 102], k)},${0.22 + 0.34 * alpha})`;
        ctx2d.beginPath();
        ctx2d.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }

    let lastMove = null;

    function posToCell(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - pad, y = e.clientY - rect.top - pad;
      const c = Math.round(x / cellSize), r = Math.round(y / cellSize);
      if (r < 0 || r >= N || c < 0 || c >= N) return null;
      if (Math.abs(x - c * cellSize) > cellSize * 0.45 || Math.abs(y - r * cellSize) > cellSize * 0.45) return null;
      return { r, c };
    }

    function onClick(e) {
      if (!playing || thinking || turn !== BLACK) return;
      const cell = posToCell(e);
      if (!cell || board[cell.r][cell.c] !== EMPTY) return;
      place(cell.r, cell.c, BLACK);
    }

    function place(r, c, side) {
      board[r][c] = side;
      lastMove = { r, c };
      moves.push({ r, c, side });
      draw();
      if (winCheck(board, r, c, side)) {
        playing = false;
        ctx.onGameEnd(side);     // 赢棋低调处理（隐身③）
        ctx.setStatus(side === BLACK ? '你赢了（低调收好）' : 'AI 赢了，再来一把？');
        return true;
      }
      // 平局
      if (board.flat().every(v => v !== EMPTY)) {
        playing = false;
        ctx.setStatus('平局');
        return true;
      }
      turn = side === BLACK ? WHITE : BLACK;
      if (turn === WHITE && playing) aiTurn();   // 轮到 AI 走棋
      return false;
    }

    function undo() {
      if (thinking || !playing) return false;       // AI 思考中不允许悔棋
      // 撤销最近两步（玩家黑 + AI 白），让玩家重新走。
      // 如果只下一步玩家就悔棋，则只撤玩家那一步。
      const last = moves.pop();
      if (!last) return false;
      board[last.r][last.c] = EMPTY;
      // 如果撤销的是 AI（白），再撤销玩家（黑）
      if (last.side === WHITE && moves.length && moves[moves.length - 1].side === BLACK) {
        const player = moves.pop();
        board[player.r][player.c] = EMPTY;
      }
      lastMove = moves.length ? { r: moves[moves.length - 1].r, c: moves[moves.length - 1].c } : null;
      turn = BLACK;
      playing = true;                             // 悔棋后继续对局，轮玩家
      draw();
      ctx.setStatus(moves.length ? '悔棋成功，轮到你（黑）' : '已悔棋到开局，点棋盘落子');
      return true;
    }

    async function aiTurn() {
      if (!playing) return;
      thinking = true;
      ctx.setStatus(mode === 'llm' ? '大模型思考中…（失败自动回退本地）' : 'AI 思考中…');
      let mv = null;
      if (mode === 'llm') {
        try { mv = await llmMove(); } catch (err) {
          ctx.setStatus('大模型走棋失败（' + String(err.message || err).slice(0, 60) + '）→ 本地接管');
        }
      }
      if (!mv) {
        // 本地兜底：让 AI 稍微歇口气，避免瞬间落子像卡顿
        await new Promise(res => setTimeout(res, 220));
        mv = bestMove(board, WHITE, diff);
      }
      if (!playing) { thinking = false; return; }   // 期间点了新局
      place(mv.r, mv.c, WHITE);
      thinking = false;
      if (playing) ctx.setStatus('轮到你（黑）');
    }

    async function llmMove() {
      const boardStr = board.map(row => row.map(v => String(v)).join('')).join(';');
      const text = await ctx.llm([
        { role: 'system', content: `你是一台严格的五子棋引擎。棋盘 ${N}×${N}，坐标格式为：列字母（A~O）+ 行数字（1~15），例如 H8。棋盘用 ${N} 段数字表示，段之间用分号分隔，每段 ${N} 个字符：0=空位，1=黑棋（玩家），2=白棋（你）。规则：黑白交替落子，先连成 5 子者获胜。你必须只输出一个合法的空位坐标（例如 H8），不要输出任何解释、标点或其他文字。` },
        { role: 'user', content: `当前棋盘：\n${boardStr}\n\n你是白棋（2）。请只输出你要落子的坐标：` },
      ], { temperature: 0.7, maxTokens: 64 });
      const m = text.toUpperCase().match(/([A-O])\s*(\d{1,2})/);
      if (!m) throw new Error('无法解析坐标: ' + text.slice(0, 30));
      const c = COLS.indexOf(m[1]), r = parseInt(m[2], 10) - 1;
      if (r < 0 || r >= N || c < 0 || c >= N || board[r][c] !== EMPTY) throw new Error('坐标非法或已被占');
      return { r, c };
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
    id: 'gomoku',
    name: '五子棋',
    icon: '⚫',
    factory,
  });
})();
