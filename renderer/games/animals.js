/* ============================================================
 * animals.js — 斗兽棋（动物棋）
 *
 * 8×8 棋盘，红蓝双方各 8 个动物，按等级吃子：
 *   象8 > 狮7 > 虎6 > 豹5 > 狼4 > 狗3 > 猫2 > 鼠1
 * 特殊：鼠>象（鼠可以吃象）；鼠不能吃老鼠；狮虎可跳河；
 * 陷阱：己方陷阱里的棋子等级变 1（鼠除外）；兽穴被占即输。
 * 本地 AI 三难度（简单=乱走 / 中等=吃大子+躲 / 困难=攻击兽穴）。
 * ============================================================ */
(function () {
  'use strict';

  const N = 8;
  // 初始布局（蓝=玩家在下，红=AI在上）
  const INIT = [
    [['r','r'], ['r','c'], ['r','d'], ['r','w'], ['r','l'], ['r','t'], ['r','s'], ['r','e']],   // 上=红（镜像对称）：鼠猫狗狼豹虎狮象
    [null, null, null, null, null, null, null, null],
    [null, 'pit', null, 'pit', null, 'pit', null, 'pit'],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, 'pit', null, 'pit', null, 'pit', null, 'pit'],
    [null, null, null, null, null, null, null, null],
    [['b','l'], ['b','s'], ['b','t'], ['b','e'], ['b','w'], ['b','d'], ['b','c'], ['b','r']],   // 下=蓝：豹狮虎象狼狗猫鼠（e=象）
  ];
  const DEN_R = [0, 3];   // 红方兽穴（上）
  const DEN_B = [7, 3];   // 蓝方兽穴（下）

  const ANIMALS = [
    { id: 'r', name: '鼠', rank: 1, icon: '🐭', color: 'rgba(168,116,112,' },
    { id: 'c', name: '猫', rank: 2, icon: '🐱', color: 'rgba(112,148,132,' },
    { id: 'd', name: '狗', rank: 3, icon: '🐶', color: 'rgba(112,134,168,' },
    { id: 'w', name: '狼', rank: 4, icon: '🐺', color: 'rgba(168,116,112,' },
    { id: 'l', name: '豹', rank: 5, icon: '🐆', color: 'rgba(112,148,132,' },
    { id: 't', name: '虎', rank: 6, icon: '🐯', color: 'rgba(168,116,112,' },
    { id: 's', name: '狮', rank: 7, icon: '🦁', color: 'rgba(112,134,168,' },
    { id: 'e', name: '象', rank: 8, icon: '🐘', color: 'rgba(168,116,112,' },
  ];
  const ANIMAL_MAP = {};
  ANIMALS.forEach(a => ANIMAL_MAP[a.id] = a);
  const SIDE = { b: '蓝', r: '红' };
  const SIDE_NAME = { b: '你', r: 'AI' };

  function animalIcon(c) { return c ? ANIMAL_MAP[c[1]].icon : ''; }
  function animalRank(c) { return c ? ANIMAL_MAP[c[1]].rank : 0; }
  function animalName(c) { return c ? ANIMAL_MAP[c[1]].name : ''; }

  function factory() {
    let root, ctx = null, diff = 'medium', mode = 'local';
    let board = [], turn = 'b', over = false, winner = null;
    let selected = null, legalMoves = [];
    let hist = [], aiThinking = false;
    let gridEl = null;

    /* ---------- 核心规则 ---------- */

    // 河区：第3/5行，第2-6列（索引1-5）
    function isRiver(r, c) { return (r === 2 || r === 5) && c >= 1 && c <= 5; }

    // 陷阱：有 'pit' 标记的格子
    function isPit(r, c) { return board[r][c] === 'pit'; }

    // 兽穴
    function isDen(r, c) { return (r === DEN_R[0] && c === DEN_R[1]) || (r === DEN_B[0] && c === DEN_B[1]); }
    // 兽穴所属方（红穴='r' 蓝穴='b' 非穴=null）
    function denOwner(r, c) {
      if (r === DEN_R[0] && c === DEN_R[1]) return 'r';
      if (r === DEN_B[0] && c === DEN_B[1]) return 'b';
      return null;
    }

    // 取格子内容（动物或 null；陷阱/兽穴返回 null 不占子）
    function at(r, c) {
      if (r < 0 || r >= N || c < 0 || c >= N) return null;
      const v = board[r][c];
      if (v === 'pit' || v === null) return null;
      return v;
    }

    // 动物实际战斗力（陷阱里变 1，鼠永远 1）
    function power(c, r, cc) {
      const rank = animalRank(c);
      if (rank === 1) return 1;                 // 鼠永远是 1
      if (isPit(r, cc)) return 1;               // 陷阱里变 1
      return rank;
    }

    // 能否从 (r,c) 走到 (nr,nc)
    function canMove(r, c, nr, nc) {
      const me = board[r][c];
      if (!me || typeof me === 'string') return false;
      const dr = Math.abs(nr - r), dc = Math.abs(nc - c);
      // 只能走一步（上下左右）
      if (dr + dc !== 1) {
        // 狮虎跳河：同行/同列，中间全是河
        if (me[1] === 's' || me[1] === 't') {
          const sameRow = r === nr, sameCol = c === nc;
          if (!(sameRow || sameCol)) return false;
          let ok = true;
          const stepR = sameRow ? 0 : (nr > r ? 1 : -1);
          const stepC = sameCol ? 0 : (nc > c ? 1 : -1);
          let rr = r + stepR, cc = c + stepC;
          while (rr !== nr || cc !== nc) {
            if (!isRiver(rr, cc)) { ok = false; break; }
            rr += stepR; cc += stepC;
          }
          if (!ok) return false;
        } else return false;
      }
      // 目标不可越界、不可进己方兽穴（只能进对方兽穴）
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) return false;
      if (denOwner(nr, nc) === me[0]) return false;
      // 鼠不能进河（其他动物可）
      if (isRiver(nr, nc) && me[1] === 'r') return false;
      // 目标格
      const target = at(nr, nc);
      if (!target) return true;                  // 空格/陷阱/对方兽穴
      if (target[0] === me[0]) return false;     // 己方子
      // 吃子判定
      if (me[1] === 'r' && target[1] === 'e') return true;   // 鼠吃象
      if (target[1] === 'r' && me[1] !== 'r') return false;  // 老鼠不能被非鼠吃
      return power(me, r, c) > power(target, nr, nc) || (power(me, r, c) === power(target, nr, nc) && false);
    }

    // 所有合法走法
    function legalMovesFor(r, c) {
      const res = [];
      for (let nr = 0; nr < N; nr++) for (let nc = 0; nc < N; nc++) {
        if (canMove(r, c, nr, nc)) res.push([nr, nc]);
      }
      return res;
    }

    // 游戏是否结束（占对方兽穴即胜）
    function checkEnd() {
      const atR = at(DEN_R[0], DEN_R[1]), atB = at(DEN_B[0], DEN_B[1]);
      if (atR && atR[0] === 'b') { over = true; winner = 'b'; return; }
      if (atB && atB[0] === 'r') { over = true; winner = 'r'; return; }
      // 无子可走判负
      const anyMove = (side) => {
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
          const v = board[r][c];
          if (v && typeof v === 'object' && v[0] === side && legalMovesFor(r, c).length) return true;
        }
        return false;
      };
      if (!anyMove('b')) { over = true; winner = 'r'; }
      else if (!anyMove('r')) { over = true; winner = 'b'; }
    }

    /* ---------- 快照（悔棋） ---------- */
    function snapshot() {
      return {
        board: board.map(row => row.map(cell => cell ? (typeof cell === 'object' ? cell.slice() : cell) : cell)),
        turn, selected, legalMoves: legalMoves.map(m => m.slice()),
      };
    }
    function restore(s) {
      board = s.board; turn = s.turn; selected = s.selected; legalMoves = s.legalMoves;
    }

    /* ---------- AI ---------- */
    /** 棋盘编码（LLM 可读）：每行 8 格，.空 陷阱# 兽穴O，动物=阵营小写+首字 */
    function boardStr() {
      const rows = [];
      for (let r = 0; r < N; r++) {
        let row = '';
        for (let c = 0; c < N; c++) {
          const v = board[r][c];
          if (v === 'pit') row += '#';
          else if (v && typeof v === 'object') row += v[0] + ANIMAL_MAP[v[1]].name;
          else row += (isDen(r, c) ? 'O' : '.');
        }
        rows.push(row);
      }
      return rows.join('\n');
    }

    /** LLM 走子：返回 [r,c] 或 null（失败/不合法） */
    async function llmMove(pieces) {
      const text = await ctx.llm([
        { role: 'system', content: '你是斗兽棋高手。规则：动物等级 象8>狮7>虎6>豹5>狼4>狗3>猫2>鼠1，大吃小；鼠吃象；狮虎可沿直线跳过整条河；陷阱里的动物变最弱；你执红（上），目标是走进蓝方兽穴(第8行O)或吃光蓝方。' },
        { role: 'user', content: `当前棋盘（r=红你方，b=蓝对方，#陷阱，O兽穴）：
${boardStr()}
你的合法走法：${pieces.map(p => `(${p.r + 1},${p.c + 1})→${p.ms.map(m => `(${m[0] + 1},${m[1] + 1})`).join('/')}`).join('；')}
只输出一个最佳走法，格式：(起点行,起点列)→(终点行,终点列)，例如 (1,1)→(2,1)` },
      ], { temperature: 0.3, maxTokens: 40 });
      // 解析 "(r,c)→(r,c)"
      const m = text.match(/\((\d)\s*,\s*(\d)\)\s*[→>-]\s*\((\d)\s*,\s*(\d)\)/);
      if (!m) return null;
      const fr = Number(m[1]) - 1, fc = Number(m[2]) - 1, tr = Number(m[3]) - 1, tc = Number(m[4]) - 1;
      // 校验合法性
      const piece = pieces.find(p => p.r === fr && p.c === fc);
      if (!piece) return null;
      if (!piece.ms.some(([mr, mc]) => mr === tr && mc === tc)) return null;
      return [fr, fc, tr, tc];
    }

    async function aiMove() {
      const side = 'r';
      const pieces = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = board[r][c];
        if (v && typeof v === 'object' && v[0] === side) {
          const ms = legalMovesFor(r, c);
          if (ms.length) pieces.push({ r, c, ms });
        }
      }
      if (!pieces.length) { checkEnd(); return; }

      // 大模型模式：LLM 决策，失败/不合法回退本地
      if (mode === 'llm' && ctx.llm) {
        ctx.setStatus('大模型思考中…（失败自动回退本地）');
        let mv = null;
        try { mv = await llmMove(pieces); } catch (err) {
          ctx.setStatus('大模型走棋失败（' + String(err.message || err).slice(0, 50) + '）→ 本地接管');
        }
        if (mv) { doMove(mv[0], mv[1], mv[2], mv[3], true); return; }   // mv=[起点r,起点c,终点r,终点c]
        // 落到本地
      }

      let best = null, bestScore = -Infinity;
      for (const p of pieces) {
        for (const [nr, nc] of p.ms) {
          let score = 0;
          const target = at(nr, nc);
          // 吃子加分
          if (target) score += target[1] === 'e' ? 30 : ANIMAL_MAP[target[1]].rank * 4;
          // 走陷阱/兽穴
          if (isPit(nr, nc)) score += 3;
          if (isDen(nr, nc)) score += 50;
          // 简单：随机小扰动；中等：怕被吃减分；困难：偏好进攻
          if (diff === 'easy') score += Math.random() * 5;
          if (diff !== 'easy') {
            // 走后会不会被对方吃掉（保守）
            for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) {
              const v = board[rr][cc];
              if (v && typeof v === 'object' && v[0] === 'b' && canMove(rr, cc, nr, nc)) score -= 8;
            }
          }
          if (diff === 'hard') score += Math.random() * 2;
          if (score > bestScore) { bestScore = score; best = { r: p.r, c: p.c, nr, nc }; }
        }
      }
      if (!best) return;
      doMove(best.r, best.c, best.nr, best.nc, true);
    }

    /* ---------- 走子 ---------- */
    function doMove(r, c, nr, nc, isAI) {
      hist.push(snapshot());
      if (hist.length > 50) hist.shift();
      const me = board[r][c];
      const target = at(nr, nc);
      board[r][c] = null;
      board[nr][nc] = me;
      selected = null; legalMoves = [];
      turn = turn === 'b' ? 'r' : 'b';
      checkEnd();
      render();
      if (over) {
        if (winner === 'b') ctx.setStatus('你赢了！兽穴攻陷 🏆');
        else ctx.setStatus('AI 赢了，再来一把？');
        if (ctx.onGameEnd) ctx.onGameEnd(winner === 'b' ? 'player' : 'ai');
      } else {
        ctx.setStatus(isAI ? `${SIDE_NAME[me[0]]}走 ${animalName(me)}` : `该 ${SIDE_NAME[turn]} 了 · ${SIDE_NAME[turn]}(${SIDE[turn]})`);
        if (!isAI && turn === 'r') {
          aiThinking = true; render();
          setTimeout(() => { aiThinking = false; Promise.resolve(aiMove()).catch(err => { aiThinking = false; ctx.setStatus('AI 出错：' + String(err.message || err).slice(0, 50)); }); }, 350);
        }
      }
    }

    /* ---------- DOM ---------- */
    function buildDom() {
      root.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'an-root';
      wrap.innerHTML = `
        <div class="an-board"></div>
        <div class="an-legend">象8狮7虎6豹5狼4狗3猫2鼠1 · 鼠吃象 · 狮虎跳河 · 占兽穴即胜</div>
      `;
      root.appendChild(wrap);
      gridEl = wrap.querySelector('.an-board');
    }

    function render() {
      if (!gridEl) return;
      gridEl.innerHTML = '';
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const cell = document.createElement('div');
          cell.className = 'an-cell' + (isRiver(r, c) ? ' river' : '') + (isPit(r, c) ? ' pit' : '') + (isDen(r, c) ? ' den' : '');
          const v = board[r][c];
          if (v && typeof v === 'object') {
            const a = ANIMAL_MAP[v[1]];
            cell.innerHTML = `<span class="an-ic">${a.icon}</span><span class="an-nm ${v[0]}">${a.name}${a.rank}</span>`;
            cell.dataset.rc = r + ',' + c;
            cell.addEventListener('click', () => onCell(r, c));
            if (selected && selected[0] === r && selected[1] === c) cell.classList.add('sel');
            if (selected && legalMoves.some(([mr, mc]) => mr === r && mc === c)) cell.classList.add('mv');
          } else if (v === 'pit') {
            cell.textContent = '陷';
            cell.classList.add('pit-t');
          } else if (v === null && isDen(r, c)) {
            cell.textContent = '穴';
            cell.classList.add('den-t');
          } else if (v === null && selected && legalMoves.some(([mr, mc]) => mr === r && mc === c)) {
            cell.classList.add('mv');
            cell.addEventListener('click', () => onCell(r, c));
          }
          gridEl.appendChild(cell);
        }
      }
    }

    function onCell(r, c) {
      if (over || turn !== 'b' || aiThinking) return;
      const v = board[r][c];
      if (selected) {
        // 已在选子，点合法目标则走
        if (legalMoves.some(([mr, mc]) => mr === r && mc === c)) {
          doMove(selected[0], selected[1], r, c, false);
          return;
        }
        // 点自己棋子则重选
        if (v && typeof v === 'object' && v[0] === 'b') {
          selected = [r, c];
          legalMoves = legalMovesFor(r, c);
          render();
          return;
        }
        selected = null; legalMoves = [];
        render();
        return;
      }
      if (v && typeof v === 'object' && v[0] === 'b') {
        selected = [r, c];
        legalMoves = legalMovesFor(r, c);
        render();
      }
    }

    function reset() {
      board = INIT.map(row => row.map(cell => cell === 'pit' ? 'pit' : (cell ? cell.slice() : null)));
      turn = 'b'; over = false; winner = null; selected = null; legalMoves = []; hist = [];
      aiThinking = false;
      buildDom();
      render();
      ctx.setStatus(`斗兽棋 · 你(蓝)先走 · ${diff === 'easy' ? '简单' : diff === 'hard' ? '困难' : '中等'}AI`);
    }

    /* ---------- 注册 ---------- */
    return {
      mount(el, appCtx) {
        root = el; ctx = appCtx;
        reset();
        // 冒烟钩子：与其它游戏一致挂 window.__smokeState
        window.__smokeState = () => {
          const cnt = { b: 0, r: 0 };
          for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
            const v = board[r][c];
            if (v && typeof v === 'object') cnt[v[0]]++;
          }
          return { turn, over, winner, pieces: cnt, selected: !!selected, cells: document.querySelectorAll('.an-cell').length };
        };
      },
      destroy() {
        try { delete window.__smokeState; } catch (e) { window.__smokeState = null; }
        try { delete window.__anMove; } catch (e) { window.__anMove = null; }
        root.innerHTML = '';
      },

      onDiffChange(d) { if (d !== diff) { diff = d; reset(); } },
      onModeChange(m) { mode = m; },
      onNewGame() { reset(); },
      undo() {
        if (!hist.length || over || aiThinking) return false;
        restore(hist.pop());
        render();
        ctx.setStatus(`悔了一步 · 该 ${SIDE_NAME[turn]} 了`);
        return true;
      },
      _test: {
        canMove, legalMovesFor, board: () => board,
        // 测试用：注入自定义布局（避开 DOM）
        setBoard(b) { board = b; },
        setTurn(t) { turn = t; },
        getTurn: () => turn,
        // 核心规则引用（供单测验证吃子/跳河）
        isRiver, isPit, isDen, at, power,
      },
    };
  }

  window.GlassGames.register({
    id: 'animals',
    name: '斗兽棋',
    icon: '🐾',
    factory,
    flags: { hasAI: true },
  });
})();
