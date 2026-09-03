/* ============================================================
 * mahjong.js — 合肥红中赖子麻将（112 张）
 *
 * 规则（MVP，按用户确认）：
 *   - 牌张：万/条/筒 各 1-9 ×4 = 108 + 红中（赖子）×4 = 112 张
 *   - 红中 = 赖子百搭，可替代任意牌凑顺子 / 刻子 / 将
 *   - 无吃：只能碰 / 杠 / 胡（赖子不可被碰杠）
 *   - 胡型：4 副（顺子或刻子）+ 1 将，可自摸也可点炮
 *   - 杠：明杠（3 张 + 别人打的）、暗杠（手里 4 张），杠后补牌（可杠上开花）
 *   - 难度：影响 AI 出牌质量与碰杠意愿（简单=不碰不杠 / 中等=启发式 / 困难=更激进）
 *
 * 牌编码：0-8 万1-9，9-17 条1-9，18-26 筒1-9，27 红中（赖子）
 * ============================================================ */
(function () {
  'use strict';

  const LAIZI = 27;
  const SUIT_CN = ['万', '条', '筒'];
  const SEAT_NAME = ['你', '下家', '对面', '上家'];

  function tileLabel(t) {
    if (t === LAIZI) return '中';
    const s = Math.floor(t / 9), r = t % 9;
    return (r + 1) + SUIT_CN[s];
  }
  function tileSuit(t) { return t === LAIZI ? -1 : Math.floor(t / 9); }
  function isLaizi(t) { return t === LAIZI; }

  /* ---------- 计数 ---------- */
  function countTiles(tiles) {
    const c = new Array(27).fill(0);
    let lz = 0;
    for (const t of tiles) { if (t === LAIZI) lz++; else c[t]++; }
    return { c, lz };
  }
  function countOf(tiles, t) { let n = 0; for (const x of tiles) if (x === t) n++; return n; }

  /* ---------- 胡牌判定（含赖子百搭，回溯拆解） ---------- */
  /** 用 c[] 真牌 + lz 张赖子 拆出 need 副（顺/刻），全部用完才算成功 */
  function decompose(c, lz, need) {
    if (need === 0) {
      for (let i = 0; i < 27; i++) if (c[i] > 0) return false;
      return true;                       // 赖子已用完（手牌张数守恒保证）
    }
    let i = 0;
    while (i < 27 && c[i] === 0) i++;
    if (i >= 27) return lz >= need * 3;  // 只剩赖子：3 张凑一刻

    // 1) 以 i 做刻子（可用 0~2 张赖子补）
    for (let use = 0; use <= 2 && use <= lz; use++) {
      const real = 3 - use;
      if (c[i] >= real) {
        c[i] -= real;
        const ok = decompose(c, lz - use, need - 1);
        c[i] += real;
        if (ok) return true;
      }
    }
    // 2) 以 i 做顺子起点（i, i+1, i+2 同花色）
    const rank = i % 9;
    if (rank <= 6) {
      const has1 = c[i + 1] > 0, has2 = c[i + 2] > 0;
      const needLz = (has1 ? 0 : 1) + (has2 ? 0 : 1);
      if (needLz <= lz) {
        c[i]--; if (has1) c[i + 1]--; if (has2) c[i + 2]--;
        const ok = decompose(c, lz - needLz, need - 1);
        c[i]++; if (has1) c[i + 1]++; if (has2) c[i + 2]++;
        if (ok) return true;
      }
    }
    return false;
  }

  /** 暗牌 tiles（含刚摸的那张）+ 已有 meldCount 副 → 是否成胡 */
  function canWinTiles(tiles, meldCount) {
    const need = 4 - meldCount;
    if (tiles.length !== need * 3 + 2) return false;
    const { c, lz } = countTiles(tiles);
    // 试每种真牌做将
    for (let p = 0; p < 27; p++) {
      if (c[p] >= 2) {
        c[p] -= 2;
        const ok = decompose(c, lz, need);
        c[p] += 2;
        if (ok) return true;
      }
    }
    // 用 2 张赖子做将
    if (lz >= 2 && decompose(c, lz - 2, need)) return true;
    return false;
  }

  function meldTiles(p) { return p.melds.reduce((n, m) => n + (m.type === 'gang' ? 4 : 3), 0); }
  function isWin(p) { return canWinTiles(p.concealed, p.melds.length); }
  function canHuOn(p, tile) {
    p.concealed.push(tile);
    const ok = isWin(p);
    p.concealed.pop();
    return ok;
  }

  /* ============ 游戏工厂 ============ */
  function factory() {
    let root, ctx = null, diff = 'medium', mode = 'local';
    let wall = [], players = [], turnIdx = 0, banker = 0;
    let phase = 'idle';          // idle | turn | claim | over
    let drawn = null;            // 刚摸到的牌 { seat, tile }
    let pending = null;          // 玩家待决策的碰/杠/胡
    let claimQueue = [], claimTile = -1, claimFrom = -1;
    let winner = -1, winTile = -1, selfDrawWin = false;
    let undoStack = [];
    let els = {};
    let onHandClick = null;
    let claimDeadline = 0, claimTick = null;   // 碰/杠倒计时自动过
    let roundInCircle = 0;                    // 第几局（一圈 4 局，东南西北轮庄）
    let stats = { games: 0, win: 0, selfDraw: 0, total: 0 };   // 本地统计
    let score = [0, 0, 0, 0];                     // 累计积分（一圈内各家）

    /* ---------- 建牌墙 / 发牌 ---------- */
    function buildWall() {
      const w = [];
      for (let t = 0; t < 27; t++) for (let k = 0; k < 4; k++) w.push(t);
      for (let k = 0; k < 4; k++) w.push(LAIZI);
      for (let i = w.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = w[i]; w[i] = w[j]; w[j] = tmp;
      }
      return w;
    }

    function sortHand(p) {
      p.concealed.sort((a, b) => a - b);
      // 刚摸的牌放最右边（传统摆法）
      if (drawn && drawn.seat === p.seat) {
        const i = p.concealed.lastIndexOf(drawn.tile);
        if (i >= 0) { p.concealed.splice(i, 1); p.concealed.push(drawn.tile); }
      }
    }

    /** 本地统计：localStorage 持久化（重启保留） */
    function loadStats() {
      try {
        const raw = localStorage.getItem('glassmj-stats');
        if (raw) { const o = JSON.parse(raw); if (o.games != null) stats = o; }
      } catch (e) {}
      return stats;
    }
    function saveStats() {
      try { localStorage.setItem('glassmj-stats', JSON.stringify(stats)); } catch (e) {}
    }

    function newGame() {
      wall = buildWall();
      players = [0, 1, 2, 3].map(i => ({
        seat: i, bot: i !== 0, concealed: [], melds: [], discards: [],
      }));
      for (let k = 0; k < 13; k++) {
        for (let i = 0; i < 4; i++) players[(banker + i) % 4].concealed.push(wall.pop());
      }
      players[banker].concealed.push(wall.pop());   // 庄家 14 张
      players.forEach(sortHand);
      turnIdx = banker; winner = -1; winTile = -1; selfDrawWin = false;
      // 一圈四局轮庄：东南西北各家轮流坐庄，第 5 局起回到第 0 庄家
      if (roundInCircle >= 4) roundInCircle = 0;
      banker = roundInCircle % 4;
      roundInCircle++;
      pending = null; claimQueue = []; drawn = null; undoStack = [];
      // 必须先清掉上一局的 over，否则 beginTurn 开头的守卫会直接 return，新局卡死
      phase = 'idle';
      clearClaimTick();
      render();
      beginTurn(false);
    }

    /* ---------- 状态快照（悔棋用） ---------- */
    function snapshot() {
      return JSON.stringify({
        wall, players, turnIdx, banker, phase,
        drawn, pending, claimQueue, claimTile, claimFrom,
        winner, winTile, selfDrawWin,
      });
    }
    function restore(s) {
      const o = JSON.parse(s);
      wall = o.wall; players = o.players; turnIdx = o.turnIdx; banker = o.banker;
      phase = o.phase; drawn = o.drawn; pending = o.pending;
      claimQueue = o.claimQueue; claimTile = o.claimTile; claimFrom = o.claimFrom;
      winner = o.winner; winTile = o.winTile; selfDrawWin = o.selfDrawWin;
    }

    /* ---------- 回合流程 ---------- */
    function beginTurn(mustDraw) {
      if (phase === 'over') return;
      const p = players[turnIdx];
      if (mustDraw) {
        if (!wall.length) return endGame(-1);       // 流局
        const t = wall.pop();
        p.concealed.push(t);
        drawn = { seat: p.seat, tile: t };
        if (!p.bot) sortHand(p);
        if (isWin(p)) return endGame(p.seat, t, true);   // 自摸
      } else {
        drawn = null;
      }
      phase = 'turn';
      render();
      if (p.bot) setTimeout(() => botDiscard(p), 420);
      else {
        // 暗杠：回合开始、非刚玩成副露时，手牌有 4 张同真牌可暗杠
        const g4 = findQuad(p);
        if (g4 >= 0) ctx.setStatus(g4 === LAIZI ? '手牌里有 4 张红中！可以暗杠' : `手牌有 4 张${tileLabel(g4)}！可以暗杠`);
        else {
          const t = listTenpai(players[0]);
          ctx.setStatus(t.length
            ? `你听牌！可胡 ${t.map(x => tileLabel(x.t)).join(' ')} 共 ${t.reduce((n, x) => n + x.n, 0)} 张`
            : '轮到你了，点一张打出去');
        }
      }
    }

    /** 手牌里是否有 4 张同真牌（暗杠候选），返回牌，没有返回 -1 */
    function findQuad(p) {
      const { c } = countTiles(p.concealed);
      for (let i = 0; i < 27; i++) if (c[i] >= 4) return i;
      return -1;
    }


    /** 暗杠：从手牌拿出 4 张同真牌入副露，摸一张 */
    function doAnGang(tile) {
      if (phase !== 'turn' || turnIdx !== 0) return;
      const p = players[0];
      const quad = [];
      p.concealed.forEach((x, i) => { if (x === tile) quad.push(i); });
      if (quad.length < 4) return;
      for (let i = quad.length - 1; i >= 0; i--) p.concealed.splice(quad[i], 1);
      p.melds.push({ type: 'gang', tile, from: 0, dark: true });
      showToast(`你暗杠 ${tileLabel(tile)}`);
      if (wall.length) {
        const t = wall.pop();
        p.concealed.push(t);
        drawn = { seat: 0, tile: t };
        sortHand(p);
        if (isWin(p)) return endGame(0, t, true);   // 杠上开花
      }
      phase = 'turn';
      render();
      ctx.setStatus('你杠了，摸了一张，点一张打出去');
    }

    /** 补杠：之前碰过的牌，手里又摸到第 4 张 */
    function doBuGang(m) {
      const p = players[0];
      const idx = p.concealed.indexOf(m.tile);
      if (idx < 0) return;
      p.concealed.splice(idx, 1);
      m.bugang = true;
      showToast(`你补杠 ${tileLabel(m.tile)}`);
      if (wall.length) {
        const t = wall.pop();
        p.concealed.push(t);
        drawn = { seat: 0, tile: t };
        sortHand(p);
        if (isWin(p)) return endGame(0, t, true);
      }
      phase = 'turn';
      render();
      ctx.setStatus('你补杠了，摸了一张，点一张打出去');
    }

    /* ---------- AI ---------- */
    function chooseDiscard(p) {
      const c = new Array(28).fill(0);
      for (const t of p.concealed) c[t]++;
      const scored = [];
      p.concealed.forEach((t, i) => {
        if (t === LAIZI) { scored.push({ i, s: -1e9 }); return; }  // 赖子=万能牌，分数最低=最不舍得打
        let s = 0;
        s -= c[t] * 10;                       // 同张越多越不舍得
        const r = t % 9;
        if (r > 0 && c[t - 1] > 0) s -= 5;    // 有邻张
        if (r < 8 && c[t + 1] > 0) s -= 5;
        if (r > 1 && c[t - 2] > 0) s -= 2;    // 有隔张（可成顺）
        if (r < 7 && c[t + 2] > 0) s -= 2;
        if (diff === 'hard') {
          if (r === 0 || r === 8) s -= 1;     // 困难：更愿意留幺九以外的中张
        }
        scored.push({ i, s });
      });
      // 评分语义：分数越低 = 牌越有价值（越不该打）；要打的是分数最高的那张
      scored.sort((a, b) => a.s - b.s);
      let pick = scored[scored.length - 1];
      if (diff === 'easy' && scored.length > 2 && Math.random() < 0.5) pick = scored[scored.length - 2];
      return pick.i;
    }

    function botWantsClaim(p, tile, type) {
      if (diff === 'easy') return false;            // 简单 AI 不碰不杠
      if (type === 'gang') return true;
      const { c, lz } = countTiles(p.concealed);
      let pairs = 0, trips = 0;
      for (let i = 0; i < 27; i++) { if (c[i] >= 3) trips++; else if (c[i] === 2) pairs++; }
      return (trips + pairs + lz) >= 2 || p.melds.length >= 1;
    }

    /** 大模型模式：让 LLM 决定 AI 出哪张（失败/解析不出回退本地启发式） */
    function recentDiscards(n) {
      const arr = [];
      for (let s2 = 0; s2 < 4; s2++) for (const t of players[s2].discards) arr.push(tileLabel(t));
      return arr.slice(-(n || 10)).join(' ') || '无';
    }

    async function llmChooseDiscard(p) {
      const hand = p.concealed.map(tileLabel).join(' ');
      const meldStr = p.melds.length
        ? p.melds.map(m => (m.type === 'gang' ? '杠' : '碰') + tileLabel(m.tile)).join('，')
        : '无';
      const text = await ctx.llm([
        { role: 'system', content: '你是红中麻将高手。规则：牌只有万/条/筒(各1-9)和红中；红中是赖子百搭，绝不能打出去；没有吃，只能碰杠；胡型=4副(顺子或刻子)+1对将。策略：优先保留对子、刻子、同花色连张，拆孤张，快听牌时留安全牌。' },
        { role: 'user', content: `你的手牌：${hand}\n已副露：${meldStr}\n最近各家出牌：${recentDiscards()}\n牌墙剩余：${wall.length} 张\n只输出一张你要打出的牌名（例如：5条），不要任何解释。` },
      ], { temperature: 0.3, maxTokens: 20 });
      // 解析：在回复里找一张真实存在于手牌的牌（绝不允许打赖子）
      for (const t of p.concealed) {
        if (t === LAIZI) continue;
        if (text.indexOf(tileLabel(t)) >= 0) return p.concealed.indexOf(t);
      }
      return -1;
    }

    function botDiscard(p) {
      if (phase !== 'turn' || turnIdx !== p.seat) return;
      // 暗杠：手里有 4 张真牌
      if (diff !== 'easy') {
        const { c } = countTiles(p.concealed);
        for (let i = 0; i < 27; i++) {
          if (c[i] >= 4) {
            for (let k = 0; k < 4; k++) p.concealed.splice(p.concealed.indexOf(i), 1);
            p.melds.push({ type: 'gang', tile: i, from: p.seat, dark: true });
            if (wall.length) { const t = wall.pop(); p.concealed.push(t); drawn = { seat: p.seat, tile: t }; }
            if (isWin(p)) return endGame(p.seat, drawn ? drawn.tile : -1, true);
            render();
            setTimeout(() => botDiscard(p), 420);
            return;
          }
        }
      }
      // 大模型模式：AI 出牌走 LLM（未配置/失败/解析不出 → 回退本地启发式）
      if (mode === 'llm' && p.bot && ctx.llm) {
        ctx.setStatus(`${SEAT_NAME[p.seat]}思考中…`);
        llmChooseDiscard(p).then(idx => {
          if (phase !== 'turn' || turnIdx !== p.seat) return;
          doDiscard(p, idx >= 0 ? idx : chooseDiscard(p));
        }).catch(() => {
          if (phase !== 'turn' || turnIdx !== p.seat) return;
          doDiscard(p, chooseDiscard(p));
        });
        return;
      }
      doDiscard(p, chooseDiscard(p));
    }

    /* ---------- DOM ---------- */
    function buildDom() {
      root.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'mj-root';
      wrap.innerHTML = `
        <div class="mj-opps">
          <div class="mj-opp" data-s="3"></div>
          <div class="mj-opp" data-s="2"></div>
          <div class="mj-opp" data-s="1"></div>
        </div>
        <div class="mj-pool"></div>
        <div class="mj-meta"></div>
        <div class="mj-mymeid"></div>
        <div class="mj-hand"></div>
        <div class="mj-actions"></div>
        <div class="mj-toast" hidden></div>
        <div class="mj-huview" hidden></div>
      `;
      root.appendChild(wrap);
      els = {
        wrap,
        opps: Array.prototype.slice.call(wrap.querySelectorAll('.mj-opp')),
        pool: wrap.querySelector('.mj-pool'),
        meta: wrap.querySelector('.mj-meta'),
        mymeld: wrap.querySelector('.mj-mymeid'),
        hand: wrap.querySelector('.mj-hand'),
        actions: wrap.querySelector('.mj-actions'),
        toast: wrap.querySelector('.mj-toast'),
        huview: wrap.querySelector('.mj-huview'),
      };
    }

    function tileEl(t, cls) {
      const d = document.createElement('div');
      d.className = 'mj-tile' + (cls ? ' ' + cls : '') + ' ' + (t === LAIZI ? 'lz' : 's' + tileSuit(t));
      d.textContent = tileLabel(t);
      return d;
    }

    /** 出牌飞行动画：从 fromEl 飞到牌河最后一张，220ms */
    function flyTile(t, fromEl) {
      if (!els.wrap || !fromEl || !els.lastPoolTile) return;
      const wrapRect = els.wrap.getBoundingClientRect();
      const fr = fromEl.getBoundingClientRect();
      const tr = els.lastPoolTile.getBoundingClientRect();
      const c = tileEl(t, 'fly');
      c.style.left = (fr.left - wrapRect.left + fr.width / 2) + 'px';
      c.style.top = (fr.top - wrapRect.top + fr.height / 2) + 'px';
      els.wrap.appendChild(c);
      const dx = tr.left - fr.left, dy = tr.top - fr.top;
      requestAnimationFrame(() => {
        c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        c.style.opacity = '0.4';
      });
      setTimeout(() => { try { c.remove(); } catch (e) {} }, 240);
    }
    function oppElFor(seat) {
      return els.opps[seat === 3 ? 0 : seat === 2 ? 1 : 2] || null;
    }

    /** 碰/杠倒计时：6s 不点自动「过」 */
    function clearClaimTick() {
      if (claimTick) { clearInterval(claimTick); claimTick = null; }
    }
    function startClaimTick() {
      clearClaimTick();
      claimDeadline = Date.now() + 6000;
      claimTick = setInterval(() => {
        const left = Math.max(0, Math.ceil((claimDeadline - Date.now()) / 1000));
        const btn = els.actions ? els.actions.querySelector('.mj-btn.no') : null;
        if (btn) btn.textContent = '过 (' + left + 's)';
        if (Date.now() >= claimDeadline) {
          clearClaimTick();
          humanClaim(false);            // 超时自动过
        }
      }, 250);
    }

    function render() {
      if (!els.wrap) return;
      // 对手
      [3, 2, 1].forEach((s, i) => {
        const p = players[s], el = els.opps[i];
        if (!el) return;
        el.className = 'mj-opp' + (turnIdx === s && phase !== 'over' ? ' active' : '');
        let h = `<div class="nm">${SEAT_NAME[s]}</div>
                 <div class="cnt">${p.concealed.length + meldTiles(p)}张</div>`;
        if (p.melds.length) {
          h += '<div class="mj-melds">' + p.melds.map(m =>
            `<span class="mj-chip">${m.type === 'gang' ? '杠' : '碰'}${tileLabel(m.tile)}</span>`).join('') + '</div>';
        }
        if (p.discards.length) {
          h += `<div class="last">出 ${tileLabel(p.discards[p.discards.length - 1])}</div>`;
        }
        el.innerHTML = h;
      });
      // 牌河（最后一张高亮"刚打出"）
      els.pool.innerHTML = '';
      const pool = [];
      for (let s = 0; s < 4; s++) for (const t of players[s].discards) pool.push({ s, t });
      pool.forEach((x, i) => {
        const isLast = i === pool.length - 1 && phase !== 'over';
        const d = tileEl(x.t, 'sm' + (x.s === 0 ? ' mine' : '') + (isLast ? ' fresh' : ''));
        els.pool.appendChild(d);
      });
      els.lastPoolTile = pool.length ? els.pool.lastChild : null;
      // 元信息
      const circleTxt = ['东', '南', '西', '北'][(roundInCircle - 1) % 4] || '东';
      els.meta.textContent = `牌墙 ${wall.length} · 赖子 中 · 第${Math.ceil(roundInCircle / 4)}圈·${circleTxt}家坐庄 · 难度 ${diff === 'easy' ? '简单' : diff === 'hard' ? '困难' : '中等'} · 你 ${stats.win}胜/${stats.games}局 (自摸${stats.selfDraw}) · 积分 你${score[0] > 0 ? '+' : ''}${score[0]}`;
      // 我的副露（真实牌张，不再是文字 chip）
      els.mymeld.innerHTML = '';
      const me0 = players[0];
      if (me0.melds.length) {
        const wrap2 = document.createElement('div');
        wrap2.className = 'mj-melds';
        me0.melds.forEach(m => {
          const g = document.createElement('div');
          g.className = 'mj-mset';
          const label = document.createElement('span');
          label.className = 'mj-settag ' + (m.type === 'gang' ? 'g' : 'p');
          label.textContent = m.type === 'gang' ? '杠' : '碰';
          g.appendChild(label);
          const n = m.type === 'gang' ? 3 : 2;
          for (let k = 0; k < n; k++) g.appendChild(tileEl(m.tile, 'mini'));
          g.appendChild(tileEl(m.tile, 'mini rot'));   // 横牌标来源
          wrap2.appendChild(g);
        });
        els.mymeld.appendChild(wrap2);
      }
      // 手牌：按花色分区（万/条/筒/赖子，组内升序），刚摸的牌放最右
      els.hand.innerHTML = '';
      const me = players[0];
      const canDiscard = phase === 'turn' && turnIdx === 0;
      const drawnIdx = (drawn && drawn.seat === 0) ? me.concealed.length - 1 : -1;
      const groups = [[], [], [], []];          // 0万 1条 2筒 3赖子
      me.concealed.forEach((t, i) => {
        if (i === drawnIdx) return;              // 刚摸的牌单独放最右
        groups[t === LAIZI ? 3 : Math.floor(t / 9)].push({ t, i });
      });
      groups.forEach(g => g.sort((a, b) => a.t - b.t));
      const mkTile = (t, i, cls) => {
        const d = tileEl(t, cls + (canDiscard ? ' pick' : ''));
        if (canDiscard) {
          d.addEventListener('click', () => {
            undoStack.push(snapshot());
            if (undoStack.length > 20) undoStack.shift();
            doDiscard(me, i, d);
          });
        }
        return d;
      };
      groups.forEach((g, gi) => {
        if (!g.length) return;
        const grp = document.createElement('div');
        grp.className = 'mj-grp';
        g.forEach(({ t, i }) => grp.appendChild(mkTile(t, i, '')));
        els.hand.appendChild(grp);
      });
      // 刚摸的牌：放最右（标准摆法）
      if (drawnIdx >= 0) {
        els.hand.appendChild(mkTile(me.concealed[drawnIdx], drawnIdx, 'drawn'));
      }
      // 操作按钮（优先级：胡 > 杠 > 碰 > 过；碰/杠可用时都能点）
      els.actions.innerHTML = '';
      // 暗杠：玩家回合内、手牌有 4 张同真牌
      if (phase === 'turn' && turnIdx === 0) {
        const g4 = findQuad(players[0]);
        if (g4 >= 0) {
          const b = document.createElement('button');
          b.className = 'mj-btn gang';
          b.textContent = '暗杠' + tileLabel(g4);
          b.addEventListener('click', () => doAnGang(g4));
          els.actions.appendChild(b);
        }
      }
      // 补杠：玩家回合内、碰过的牌手牌有第 4 张
      if (phase === 'turn' && turnIdx === 0) {
        players[0].melds.forEach(m => {
          if (m.type === 'gang' || m.bugang) return;
          if (players[0].concealed.indexOf(m.tile) >= 0) {
            const b = document.createElement('button');
            b.className = 'mj-btn gang';
            b.textContent = '补杠' + tileLabel(m.tile);
            b.addEventListener('click', () => doBuGang(m));
            els.actions.appendChild(b);
          }
        });
      }
      if (phase === 'claim' && pending) {
        const mk = (txt, cls, fn) => {
          const b = document.createElement('button');
          b.className = 'mj-btn ' + cls;
          b.textContent = txt;
          b.addEventListener('click', fn);
          els.actions.appendChild(b);
          return b;
        };
        if (pending.type === 'gang') mk('杠', 'gang', () => humanClaim(true));
        else mk('碰', 'peng', () => humanClaim(true));
        mk('过', 'no', () => humanClaim(false));
      } else if (phase === 'over') {
        const b = document.createElement('button');
        b.className = 'mj-btn no';
        b.textContent = '再来一局';
        b.addEventListener('click', () => newGame());
        els.actions.appendChild(b);
      }
    }

    /** 碰/杠 toast 动画（1600ms 自动消失） */
    let toastTimer = null;
    function showToast(txt) {
      if (!els.toast) return;
      els.toast.textContent = txt;
      els.toast.hidden = false;
      els.toast.classList.remove('anim');
      void els.toast.offsetWidth;          // 重启动画
      els.toast.classList.add('anim');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { els.toast.hidden = true; }, 1600);
    }

    /** 胡牌定格：半透明遮罩，摊开胡家手牌+副露，标"自摸/点炮/杠上开花"，2600ms 自动散场 */
    let huTimer = null;
    function showHuView(seat, tile, self) {
      if (!els.huview) return;
      const p = players[seat];
      // 合肥规则只准自摸：点炮分支不会触发（保留兜底）
      const how = self
        ? (p.melds.some(m => m.type === 'gang' && m.from === p.seat) ? '杠上开花' : '自摸')
        : '点炮';
      const handStr = p.concealed.map(tileLabel).join(' ');
      const meldStr = p.melds.map(m => (m.type === 'gang' ? '杠' : '碰') + tileLabel(m.tile)).join(' ') || '无';
      const fan = calcFan(p, !!self);
      const pts = self ? fan.fan * 3 : 0;   // 自摸：3 家各付 fan 分
      els.huview.innerHTML = `
        <div class="mj-hucard">
          <div class="mj-hutitle">${SEAT_NAME[seat]}胡了 · ${how} · ${fan.fan}番</div>
          <div class="mj-huline"><span class="lb">胡牌</span><b>${tileLabel(tile)}</b></div>
          <div class="mj-huline"><span class="lb">手牌</span><span class="tiles">${handStr}</span></div>
          <div class="mj-huline"><span class="lb">副露</span><span class="tiles">${meldStr}</span></div>
          <div class="mj-huline"><span class="lb">番型</span><span class="tiles">${fan.names.join(' + ')}</span></div>
          <div class="mj-huline"><span class="lb">得分</span><span class="tiles">+${pts}</span></div>
        </div>`;
      els.huview.hidden = false;
      clearTimeout(huTimer);
      huTimer = setTimeout(() => { els.huview.hidden = true; }, 2600);
    }

    /** 完整计番（合肥红中赖子常用番型）：返回 { names:[], fan } */
    function calcFan(p, self) {
      const names = [];
      let fan = 1;                                  // 平胡打底
      const all = p.concealed.concat(p.melds.map(m => m.tile));
      // 清一色：所有牌（含副露）同花色或赖子
      const suits = new Set(all.filter(t => t !== LAIZI).map(t => Math.floor(t / 9)));
      if (suits.size === 1) { names.push('清一色'); fan += 4; }
      // 碰碰胡：4 副全是刻子（副露全碰/杠 + 暗牌全刻/赖子补）
      const { c, lz } = countTiles(p.concealed);
      let lz2 = lz, trips = 0, i = 0;
      while (i < 27) {
        if (c[i] >= 3) { trips++; c[i] -= 3; }
        else if (lz2 >= 3 - c[i] && c[i] > 0) { trips++; lz2 -= 3 - c[i]; c[i] = 0; }
        i++;
      }
      if (lz2 >= 2) trips++;                        // 赖子将也算刻类
      const meldTrips = p.melds.length;
      if (trips + meldTrips >= 4) { names.push('碰碰胡'); fan += 2; }
      // 七对：无副露且暗牌 14 张分成 7 对（赖子可补）
      if (!p.melds.length && p.concealed.length === 14) {
        const { c: c7, lz: lz7 } = countTiles(p.concealed);
        let pairs = 0, lz7b = lz7;
        for (let k = 0; k < 27; k++) {
          if (c7[k] >= 2) { pairs += Math.floor(c7[k] / 2); c7[k] %= 2; }
          if (c7[k] === 1 && lz7b >= 1) { pairs++; lz7b--; }
        }
        if (lz7b >= 2) pairs++;
        if (pairs >= 7) { names.push('七对'); fan += 4; }
      }
      // 杠上开花：自摸且刚杠过
      if (self && p.melds.some(m => m.type === 'gang')) { names.push('杠上开花'); fan += 2; }
      return { names: names.length ? names : ['平胡'], fan };
    }

    /** 分数结算：自摸时其他 3 家各付 fan 分，输家赢家增减 */
    function settle(seat, fan) {
      for (let s = 0; s < 4; s++) {
        if (s === seat) score[s] += fan * 3;
        else score[s] -= fan;
      }
    }
  function doDiscard(p, idx, fromEl) {
      if (phase !== 'turn') return;
      phase = 'discarding';            // 出牌锁：防止 240ms 空窗内重复出牌（快速连点/脚本轮询）
      const t = p.concealed.splice(idx, 1)[0];
      p.discards.push(t);
      drawn = null;
      if (!p.bot) sortHand(p);
      render();
      flyTile(t, fromEl || (p.bot ? oppElFor(p.seat) : null));
      setTimeout(() => checkClaims(p.seat, t), 240);
    }

    /** 出牌后：按 杠 > 碰 询问各家（合肥红中规则：只允许自摸胡，点炮不能胡） */
    function checkClaims(fromSeat, tile) {
      claimTile = tile; claimFrom = fromSeat;
      const order = [1, 2, 3].map(k => (fromSeat + k) % 4);

      // 杠 / 碰（赖子不可碰杠）
      const opts = [];
      if (tile !== LAIZI) {
        for (const s of order) {
          const n = countOf(players[s].concealed, tile);
          if (n >= 3) opts.push({ seat: s, type: 'gang' });
          else if (n >= 2) opts.push({ seat: s, type: 'peng' });
        }
      }
      opts.sort((a, b) => (a.type === 'gang' ? 0 : 1) - (b.type === 'gang' ? 0 : 1));
      claimQueue = opts;
      processClaimQueue();
    }

    function processClaimQueue() {
      while (claimQueue.length) {
        const o = claimQueue.shift();
        if (o.seat === 0) {
          phase = 'claim';
          pending = { tile: claimTile, from: claimFrom, type: o.type };
          render();
          ctx.setStatus(`可以「${o.type === 'gang' ? '杠' : '碰'}」${tileLabel(claimTile)}，要吗？`);
          startClaimTick();
          return;
        }
        if (botWantsClaim(players[o.seat], claimTile, o.type)) {
          return applyMeld(players[o.seat], claimTile, o.type, claimFrom);
        }
      }
      nextTurn(claimFrom);
    }

    function applyMeld(p, tile, type, fromSeat) {
      const from = players[fromSeat];
      if (from.discards.length) from.discards.pop();     // 从牌河拿走
      const n = type === 'gang' ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const idx = p.concealed.indexOf(tile);
        if (idx >= 0) p.concealed.splice(idx, 1);
      }
      p.melds.push({ type, tile, from: fromSeat });
      turnIdx = p.seat;
      pending = null;
      // 碰/杠 toast（谁碰了什么，一眼可见）
      showToast(`${SEAT_NAME[p.seat]}${type === 'gang' ? '杠' : '碰'} ${tileLabel(tile)}`);

      if (type === 'gang' && wall.length) {
        const t = wall.pop();
        p.concealed.push(t);
        drawn = { seat: p.seat, tile: t };
        if (!p.bot) sortHand(p);
        if (isWin(p)) return endGame(p.seat, t, true);   // 杠上开花
      }
      phase = 'turn';
      render();
      if (p.bot) setTimeout(() => botDiscard(p), 420);
      else ctx.setStatus('点一张牌打出去');
    }

    function humanClaim(yes) {
      if (phase !== 'claim' || !pending) return;
      clearClaimTick();
      const p = players[0], o = pending;
      pending = null;
      if (yes) {
        applyMeld(p, o.tile, o.type, o.from);
      } else {
        phase = 'turn';
        processClaimQueue();     // 继续问后面的 AI
      }
    }

    function nextTurn(fromSeat) {
      turnIdx = (fromSeat + 1) % 4;
      beginTurn(true);
    }

    function endGame(seat, tile, self) {
      phase = 'over'; winner = seat; winTile = tile == null ? -1 : tile; selfDrawWin = !!self;
      // 统计：胜率 / 自摸数（流局不计局数）
      if (seat >= 0) {
        stats.games++;
        if (seat === 0) { stats.win++; if (self) stats.selfDraw++; }
        stats.total++;
        saveStats();
        // 分数结算：自摸时各家付 fan 分
        const fan = calcFan(players[seat], !!self);
        settle(seat, fan.fan);
      }
      render();
      if (seat === -1) ctx.setStatus('流局了（牌墙摸完），点新局再来');
      else {
        showHuView(seat, tile, self);      // 胡牌定格：摊牌 + 番型
        const circleDone = roundInCircle >= 3;
        if (seat === 0) ctx.setStatus((self ? '自摸！你胡了' : '你胡了！') + (circleDone ? '（一圈打完，点新局开始新圈）' : '（低调收好）'));
        else ctx.setStatus(`${SEAT_NAME[seat]}胡了，再来一把？` + (circleDone ? '（一圈打完）' : ''));
      }
      if (ctx.onGameEnd) ctx.onGameEnd(seat === 0 ? 'player' : 'ai');
    }

    return {
      mount(el, appCtx) {
        root = el; ctx = appCtx;
        buildDom();
        loadStats();
        newGame();
        window.__smokeState = () => ({
          phase, turn: turnIdx, wall: wall.length, winner,
          hands: players.map(p => p.concealed.length),
          melds: players.map(p => p.melds.length),
          pool: players.reduce((n, p) => n + p.discards.length, 0),
          poolLaizi: players.reduce((n, p) => n + p.discards.filter(t => t === LAIZI).length, 0),
          canDiscard: phase === 'turn' && turnIdx === 0,
          pending: pending ? pending.type : '',
          myMelds: players[0].melds.length,
          toast: els.toast ? !els.toast.hidden : false,
          huView: els.huview ? !els.huview.hidden : false,
          fresh: !!document.querySelector('.mj-tile.fresh'),
          tenpai: listTenpai(players[0]).length,
          canAnGang: findQuad(players[0]) >= 0,
          canBuGang: players[0].melds.some(m => m.type === 'peng' && !m.bugang
            && players[0].concealed.indexOf(m.tile) >= 0),
          round: roundInCircle,
          stats: { ...stats },
          score: score.slice(),
        });
        window.__mjDiscard = (i) => {
          if (phase !== 'turn' || turnIdx !== 0) return 'not-your-turn';
          const idx = Math.min(i == null ? 0 : i, players[0].concealed.length - 1);
          undoStack.push(snapshot());
          doDiscard(players[0], idx);
          return 'ok';
        };
        window.__mjClaim = (yes) => { humanClaim(!!yes); return 'ok'; };
        // 冒烟：玩家暗杠 / 补杠
        window.__mjAnGang = () => {
          const g4 = findQuad(players[0]);
          if (g4 < 0) return 'no-quad';
          doAnGang(g4);
          return 'ok';
        };
        window.__mjBuGang = () => {
          const m = players[0].melds.find(x => x.type === 'peng' && !x.bugang
            && players[0].concealed.indexOf(x.tile) >= 0);
          if (!m) return 'no-bugang';
          doBuGang(m);
          return 'ok';
        };
        // 冒烟/模拟用：开新局
        window.__mjNewGame = () => { newGame(); return 'ok'; };
        // 冒烟用：让玩家座位也按 AI 策略出牌（验证胡牌/碰杠链路真的会触发）
        window.__mjPlayAsBot = () => {
          if (phase !== 'turn' || turnIdx !== 0) return 'not-your-turn';
          undoStack.push(snapshot());
          if (undoStack.length > 20) undoStack.shift();
          doDiscard(players[0], chooseDiscard(players[0]));
          return 'ok';
        };
      },
      destroy() {
        try { delete window.__smokeState; } catch (e) { window.__smokeState = null; }
        try { delete window.__mjDiscard; } catch (e) { window.__mjDiscard = null; }
        try { delete window.__mjClaim; } catch (e) { window.__mjClaim = null; }
      },
      onModeChange(m) { mode = m; },
      // 注意：activateGame 每次切游戏都会调一次 onDiffChange，
      // 这里绝不能重开回合（会多发一张牌破坏张数守恒），只在难度真变了才重开一局
      onDiffChange(d) {
        if (d === diff) return;
        diff = d;
        if (players.length) newGame();
      },
      onNewGame() { newGame(); },
      undo() {
        if (!undoStack.length) return false;
        restore(undoStack.pop());
        render();
        ctx.setStatus('悔了一步（收回刚打出的牌）');
        return true;
      },
    };
  }

  // 测试钩子：供 Node 单测与冒烟脚本校验胡牌判定
  window.__mjCanWin = canWinTiles;
    /** 听牌检测：遍历 27 种真牌 + 赖子，替换/加进手牌能胡的和数量 */
  function listTenpai(p) {
    const need = 4 - p.melds.length;
    const results = {};
    const base = p.concealed.slice();
    // 摸牌后阶段：已有 14 张 base，试打一张再看
    const tryHand = (hand, add) => {
      const h = hand.slice();
      if (add != null) h.push(add);    // add 可能是 0（1万），不能用 if(add)
      if (h.length !== need * 3 + 2) return;
      if (canWinTiles(h, p.melds.length)) {
        const t = add == null ? -1 : add;
        if (!results[t]) results[t] = 0;
        results[t] += 1;
      }
    };
    if (base.length === need * 3 + 2) {
      // 一轮之初 13+摸1=14：试打任意一张，若还能胡 -> 听
      for (const t of base) {
        const rest = base.filter(x => x !== t);
        if (rest.length !== need * 3 + 1) continue;
        for (let a = 0; a < 27; a++) tryHand(rest, a);
        tryHand(rest, LAIZI);
      }
    } else {
      for (let a = 0; a < 27; a++) tryHand(base, a);
      tryHand(base, LAIZI);
    }
    return Object.keys(results).map(k => ({
      t: Number(k),
      n: results[k],
    })).filter(x => x.t >= 0);
  }

  // 听牌检测钩子：直接给手牌数组 + 副露数，返回可胡列表
  window.__mjTenpai = (hand, meldCount) => {
    const fake = { concealed: hand.slice(), melds: new Array(meldCount || 0).fill({}) };
    return listTenpai(fake);
  };

  window.GlassGames.register({
    id: 'mahjong',
    name: '红中麻将',
    icon: '🀄',
    factory,
    flags: { hasAI: true },   // 3 个 AI 对手；大模型模式下 AI 出牌走 LLM
  });
})();
