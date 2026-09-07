/* ============================================================
 * billiard.js — 人机对战台球（中式八球）
 *
 * 你(暖色 1-7) vs AI(冷色 9-15)，黑八定胜负。
 * 纯 Canvas + 手写 2D 物理（子步进碰撞排序，防穿模）。
 * 辅助线：瞄准线 / 进球预测 / 库边反弹 / 力度条 / 球组高亮。
 * 操作：按住桌面拖拽（远离目标方向）→ 松手击球。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 常量（逻辑坐标） ---------- */
  const TABLE_W = 800, TABLE_H = 400;      // 桌面内沿
  const CUSHION = 14;                       // 库边厚
  const R = 9;                              // 球半径
  const POCKET_R = 15;                      // 袋口半径
  const DECEL = 380;                        // 线性减速度 px/s²（满力 945 → 约 2.5s 停）
  const STOP_V = 6;                         // 停止阈值（/s）
  const MAX_POWER = 1050;                   // 满力初速
  const SUBSTEPS = 10;                      // 每帧子步数

  // 袋口（相对桌面内沿）
  const POCKETS = [
    { x: 0, y: 0 }, { x: TABLE_W / 2, y: 0 }, { x: TABLE_W, y: 0 },
    { x: 0, y: TABLE_H }, { x: TABLE_W / 2, y: TABLE_H }, { x: TABLE_W, y: TABLE_H },
  ];

  // 球色（低饱和摸鱼风）
  // 灰阶球色：几乎无色相，靠明度深浅区分（白球最亮→黑八最深；暖球=中亮灰 冷球=中暗灰）
  const COLORS = {
    0: 'rgba(200,198,192,',
    1: 'rgba(150,146,140,', 2: 'rgba(144,141,136,', 3: 'rgba(138,136,132,',
    4: 'rgba(134,132,130,', 5: 'rgba(128,127,126,', 6: 'rgba(134,132,129,',
    7: 'rgba(140,137,132,', 8: 'rgba(56,58,62,',
    9: 'rgba(118,120,124,', 10: 'rgba(112,116,118,', 11: 'rgba(108,112,118,',
    12: 'rgba(104,110,114,', 13: 'rgba(100,106,108,', 14: 'rgba(96,102,108,',
    15: 'rgba(92,98,104,',
  };

  function factory() {
    let root, ctx = null, diff = 'medium', mode = 'local';
    let canvas, c2d;
    let balls = [];              // {x,y,vx,vy,num,moving,potted}
    let cue = null;              // 白球引用
    let myGroup = null, aiGroup = null;   // 'solid'(1-7) / 'stripe'(9-15)，开球第一进定组
    let turn = 'player';         // player | ai
    let state = 'aim';           // aim | moving | placeCue | over
    let winner = null;
    let firstHit = null;         // 本杆首碰
    let pottedThisShot = [];     // 本杆落袋
    let shotCount = 0;
    let aiTimer = null;

    // 交互
    let dragging = false, dragStart = null, dragNow = null;

    // 视口
    let scale = 1, offX = 0, offY = 0;
    let resizeObs = null;

    /* ---------- 摆球 ---------- */
    function rackBalls() {
      balls = [];
      // 白球：左 1/4
      cue = { x: TABLE_W * 0.25, y: TABLE_H / 2, vx: 0, vy: 0, num: 0, potted: false };
      balls.push(cue);
      // 三角摆球：右侧 1/4，8 在第三排中间
      const order = [1, 9, 2, 10, 8, 3, 11, 7, 14, 4, 5, 13, 15, 6, 12];
      let oi = 0;
      const gap = R * 2 + 0.6;
      const startX = TABLE_W * 0.72;
      for (let row = 0; row < 5; row++) {
        for (let i = 0; i <= row; i++) {
          const x = startX + row * gap * 0.87;
          const y = TABLE_H / 2 + (i - row / 2) * gap;
          balls.push({ x, y, vx: 0, vy: 0, num: order[oi++], potted: false });
        }
      }
    }

    /* ---------- 物理 ---------- */
    function allStopped() {
      return balls.every(b => b.potted || (!b.vx && !b.vy) || (Math.abs(b.vx) + Math.abs(b.vy) < STOP_V));
    }

    // 球-球碰撞（等质量弹性）
    function collideBalls() {
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.potted) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.potted) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist < R * 2 && dist > 0) {
            const nx = dx / dist, ny = dy / dist;
            // 分离
            const overlap = (R * 2 - dist) / 2;
            a.x -= nx * overlap; a.y -= ny * overlap;
            b.x += nx * overlap; b.y += ny * overlap;
            // 法向速度交换（等质量）
            const va = a.vx * nx + a.vy * ny;
            const vb = b.vx * nx + b.vy * ny;
            if (va - vb > 0) {   // 只有接近时才交换
              const d = (va - vb) * 0.98;   // 弹性
              a.vx -= d * nx; a.vy -= d * ny;
              b.vx += d * nx; b.vy += d * ny;
              if (firstHit === null) {
                firstHit = (a.num === 0) ? b.num : (b.num === 0 ? a.num : firstHit);
                if (firstHit === null) firstHit = -1;   // 球球碰但都不是白球（罕见）
              }
            }
          }
        }
      }
    }

    // 库边反弹
    function cushionBounce(b) {
      const min = CUSHION + R, maxX = TABLE_W - R, maxY = TABLE_H - R;
      if (b.x < min && b.vx < 0) { b.x = min; b.vx *= -0.92; }
      if (b.x > maxX && b.vx > 0) { b.x = maxX; b.vx *= -0.92; }
      if (b.y < min && b.vy < 0) { b.y = min; b.vy *= -0.92; }
      if (b.y > maxY && b.vy > 0) { b.y = maxY; b.vy *= -0.92; }
    }

    // 进袋
    function checkPockets() {
      for (const b of balls) {
        if (b.potted) continue;
        for (const p of POCKETS) {
          const px = CUSHION + p.x, py = CUSHION + p.y;
          if (Math.hypot(b.x - px, b.y - py) < POCKET_R) {
            b.potted = true; b.vx = 0; b.vy = 0;
            pottedThisShot.push(b.num);
            break;
          }
        }
      }
    }

    // 一帧物理（子步进）
    function physicsFrame(dtMs) {
      const dt = dtMs / 1000;
      const sub = SUBSTEPS;
      const sdt = dt / sub;
      for (let s = 0; s < sub; s++) {
        let anyMoving = false;
        for (const b of balls) {
          if (b.potted) continue;
          if (b.vx || b.vy) {
            b.x += b.vx * sdt;
            b.y += b.vy * sdt;
            // 线性摩擦（滚动减速）
            const speed = Math.hypot(b.vx, b.vy);
            if (speed > 0) {
              const ns = Math.max(0, speed - DECEL * sdt);
              const k = ns / speed;
              b.vx *= k; b.vy *= k;
              if (ns < STOP_V) { b.vx = 0; b.vy = 0; }
              else anyMoving = true;
            }
            cushionBounce(b);
          }
        }
        collideBalls();
        checkPockets();
        if (!anyMoving) break;
      }
    }

    /* ---------- 规则（中式八球） ---------- */
    function groupOf(num) {
      if (num >= 1 && num <= 7) return 'solid';
      if (num >= 9 && num <= 15) return 'stripe';
      return null;   // 0 白 8 黑
    }
    function myRemaining(group) {
      return balls.filter(b => !b.potted && b.num !== 0 && b.num !== 8 && groupOf(b.num) === group).length;
    }

    // 一杆结算：返回 {foul, keepTurn, gameOver}
    function settleShot() {
      const cuePotted = pottedThisShot.includes(0);
      const eightPotted = pottedThisShot.includes(8);
      const objPotted = pottedThisShot.filter(n => n !== 0 && n !== 8);
      let foul = false, foulReason = '';

      // 白球落袋
      if (cuePotted) { foul = true; foulReason = '白球落袋'; }
      // 未碰任何球
      else if (firstHit === null || firstHit === -1) { foul = true; foulReason = '空杆未碰球'; }
      // 首碰非己方球（定组后）
      else if (myGroup) {
        const myG = turn === 'player' ? myGroup : aiGroup;
        if (groupOf(firstHit) !== myG && firstHit !== 8) {
          // 己方清完可先碰黑八
          if (!(myRemaining(myG) === 0)) { foul = true; foulReason = '首碰非己方球'; }
        }
      }

      // 黑八
      if (eightPotted) {
        const myG = turn === 'player' ? myGroup : aiGroup;
        if (!myGroup) {   // 没定组打进黑八（几乎不可能）→ 重摆黑八，算犯规
          foul = true;
          const eight = balls.find(b => b.num === 8);
          if (eight) { eight.potted = false; eight.x = TABLE_W * 0.72; eight.y = TABLE_H / 2; }
        } else if (cuePotted) {
          return finish(turn === 'player' ? 'ai' : 'player', '黑八与白球同落');
        } else if (myRemaining(myG) > 0) {
          return finish(turn === 'player' ? 'ai' : 'player', '提前打进黑八');
        } else {
          return finish(turn, '');
        }
      }

      // 定组：第一颗非白非黑进球（全局第一次）
      if (!myGroup && objPotted.length) {
        const g = groupOf(objPotted[0]);
        if (turn === 'player') { myGroup = g; aiGroup = g === 'solid' ? 'stripe' : 'solid'; }
        else { aiGroup = g; myGroup = g === 'solid' ? 'stripe' : 'solid'; }
      }

      // 继续权：进球且无犯规
      let keep = false;
      if (!foul && objPotted.length) {
        // 打进了己方球（或还没定组）→ 继续
        if (!myGroup) keep = true;
        else {
          const myG = turn === 'player' ? myGroup : aiGroup;
          keep = objPotted.some(n => groupOf(n) === myG);
        }
      }

      // 白球落袋 → 复位 + 对方自由球
      if (cuePotted) {
        cue.potted = false;
        cue.x = TABLE_W * 0.25; cue.y = TABLE_H / 2;
        // 找空位放白球
        repositionCue();
      }

      if (foul) {
        turn = turn === 'player' ? 'ai' : 'player';
        return { foul: true, foulReason, keepTurn: false, freeBall: true };
      }
      if (!keep) turn = turn === 'player' ? 'ai' : 'player';
      return { foul: false, keepTurn: keep, freeBall: false };
    }

    function repositionCue() {
      // 找一个不重叠的位置
      const tryPos = (x, y) => !balls.some(b => !b.potted && b.num !== 0 && Math.hypot(b.x - x, b.y - y) < R * 2.2);
      if (tryPos(cue.x, cue.y)) return;
      for (let r = 30; r < TABLE_W / 2; r += 15) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const x = TABLE_W * 0.25 + Math.cos(a) * r, y = TABLE_H / 2 + Math.sin(a) * r * 0.5;
          if (x > CUSHION + R && x < TABLE_W - R && y > CUSHION + R && y < TABLE_H - R && tryPos(x, y)) {
            cue.x = x; cue.y = y; return;
          }
        }
      }
    }

    function finish(w, reason) {
      state = 'over'; winner = w;
      if (ctx.onGameEnd) ctx.onGameEnd(w === 'player' ? 'player' : 'ai');
      return { gameOver: true, winner: w, reason };
    }

    /* ---------- 击球 ---------- */
    function shoot(dirX, dirY, power, byAI) {
      if (state !== 'aim') return;
      if (!byAI && turn !== 'player') return;
      const v = MAX_POWER * power;
      cue.vx = dirX * v; cue.vy = dirY * v;
      firstHit = null; pottedThisShot = [];
      state = 'moving';
      shotCount++;
    }

    // 移动结束后的结算入口
    function onShotEnd() {
      const r = settleShot();
      if (r.gameOver) { render(); updateStatus(); return; }
      state = 'aim';
      if (turn === 'ai') {
        render(); updateStatus();
        aiTimer = setTimeout(() => aiTakeShot(), 700);
      } else {
        render(); updateStatus(r);
      }
    }

    /* ---------- AI ---------- */
    function aiTakeShot() {
      if (state !== 'aim' || turn !== 'ai') return;
      const aiG = aiGroup;
      const targets = balls.filter(b => !b.potted && b.num !== 0 && (
        !aiG ? (b.num !== 8) : (groupOf(b.num) === aiG || (myRemaining(aiG) === 0 && b.num === 8))
      ));
      if (!targets.length) {   // 无目标：随便打
        const a = Math.random() * Math.PI * 2;
        shoot(Math.cos(a), Math.sin(a), 0.5, true);
        return;
      }

      const candidates = [];
      for (const t of targets) {
        for (const p of POCKETS) {
          const px = CUSHION + p.x, py = CUSHION + p.y;
          // ghost ball 位置
          const tdx = px - t.x, tdy = py - t.y;
          const td = Math.hypot(tdx, tdy);
          if (td < 1) continue;
          const gx = t.x - tdx / td * R * 2, gy = t.y - tdy / td * R * 2;
          // 白球到 ghost
          const cdx = gx - cue.x, cdy = gy - cue.y;
          const cd = Math.hypot(cdx, cdy);
          if (cd < R) continue;
          const dirX = cdx / cd, dirY = cdy / cd;
          // 切角：击球方向 vs 目标球走向
          const dot = dirX * (tdx / td) + dirY * (tdy / td);
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          if (angle > 1.35) continue;   // >77° 打不动
          // 遮挡：白球→ghost
          if (blocked(cue.x, cue.y, gx, gy, t.num)) continue;
          // 遮挡：target→pocket
          if (blocked(t.x, t.y, px, py, t.num)) continue;
          // 评分
          let score = 100 - angle * 50 - td * 0.06 - cd * 0.04;
          if (diff === 'easy') score += Math.random() * 60;
          if (diff === 'medium') score += Math.random() * 15;
          candidates.push({ dirX, dirY, angle, td, cd, score, t });
        }
      }

      if (!candidates.length) {
        // 没好球：朝最近己方球打
        const t = targets[Math.floor(Math.random() * targets.length)];
        const dx = t.x - cue.x, dy = t.y - cue.y;
        const d = Math.hypot(dx, dy) || 1;
        const pw = diff === 'easy' ? 0.35 + Math.random() * 0.3 : 0.55;
        shoot(dx / d, dy / d, pw, true);
        return;
      }
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      // 力度标定：距离越远力越大
      let pw = Math.min(0.95, 0.3 + (best.td + best.cd) / 900);
      if (diff === 'easy') pw *= 0.7 + Math.random() * 0.5;
      if (diff === 'medium') pw *= 0.85 + Math.random() * 0.25;
      shoot(best.dirX, best.dirY, Math.max(0.25, Math.min(1, pw)), true);
    }

    // 线段遮挡检测（线段上是否有其他球挡路）
    function blocked(x1, y1, x2, y2, excludeNum) {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1) return false;
      const ux = dx / len, uy = dy / len;
      for (const b of balls) {
        if (b.potted || b.num === 0 || b.num === excludeNum) continue;
        // 球心到线段距离
        const t = Math.max(0, Math.min(len, (b.x - x1) * ux + (b.y - y1) * uy));
        const cx = x1 + ux * t, cy = y1 + uy * t;
        if (Math.hypot(b.x - cx, b.y - cy) < R * 1.9) return true;
      }
      return false;
    }

    /* ---------- 辅助线 ---------- */
    function drawAimHelpers() {
      if (state !== 'aim' || turn !== 'player' || !dragging) return;
      const dx = dragStart.x - dragNow.x, dy = dragStart.y - dragNow.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) return;
      const dirX = dx / d, dirY = dy / d;
      const power = Math.min(1, d / 180);
      const c2 = c2d;
      c2.setLineDash([4, 4]);
      // ① 瞄准线：白球沿击球方向，找第一个碰撞点
      let hitBall = null, hitDist = Infinity, hitX = 0, hitY = 0;
      for (const b of balls) {
        if (b.potted || b.num === 0) continue;
        // 白球沿 dir 的射线与球圆（半径2R）相交
        const relX = b.x - cue.x, relY = b.y - cue.y;
        const proj = relX * dirX + relY * dirY;
        if (proj <= 0) continue;
        const perp = Math.abs(relX * dirY - relY * dirX);
        if (perp < R * 2) {
          const t = proj - Math.sqrt(R * R * 4 - perp * perp);
          if (t > 0 && t < hitDist) { hitDist = t; hitBall = b; }
        }
      }
      // 库边距离
      let wallDist = Infinity, wallAxis = null;
      if (dirX < 0) wallDist = Math.min(wallDist, (cue.x - (CUSHION + R)) / -dirX);
      if (dirX > 0) wallDist = Math.min(wallDist, ((TABLE_W - R) - cue.x) / dirX);
      if (dirY < 0) { const dd = (cue.y - (CUSHION + R)) / -dirY; if (dd < wallDist) { wallDist = dd; wallAxis = 'y'; } }
      if (dirY > 0) { const dd = ((TABLE_H - R) - cue.y) / dirY; if (dd < wallDist) { wallDist = dd; wallAxis = 'y'; } }
      if (dirX !== 0 && wallAxis === null) {
        const ddx = dirX < 0 ? (cue.x - (CUSHION + R)) / -dirX : ((TABLE_W - R) - cue.x) / dirX;
        if (ddx < wallDist) { wallDist = ddx; wallAxis = 'x'; }
      }

      const endX = hitBall ? cue.x + dirX * hitDist : cue.x + dirX * wallDist;
      const endY = hitBall ? cue.y + dirY * hitDist : cue.y + dirY * wallDist;
      c2.strokeStyle = 'rgba(255,255,255,0.32)';
      c2.beginPath(); c2.moveTo(cue.x, cue.y); c2.lineTo(endX, endY); c2.stroke();

      if (hitBall) {
        // ② 进球预测：目标球走向 = 白球方向在（目标球心-碰撞点）上的投影
        const nx = (hitBall.x - endX), ny = (hitBall.y - endY);
        const nd = Math.hypot(nx, ny) || 1;
        const tgX = nx / nd, tgY = ny / nd;
        // 找最近袋口判断能否进
        let bestP = null, bestAng = Infinity;
        for (const p of POCKETS) {
          const px = CUSHION + p.x, py = CUSHION + p.y;
          const pdx = px - hitBall.x, pdy = py - hitBall.y;
          const pd = Math.hypot(pdx, pdy);
          if (pd < 1) continue;
          const a = Math.acos(Math.max(-1, Math.min(1, tgX * pdx / pd + tgY * pdy / pd)));
          if (a < bestAng) { bestAng = a; bestP = { x: px, y: py, d: pd }; }
        }
        const canPot = bestP && bestAng < 0.35;
        c2.strokeStyle = canPot ? 'rgba(120,180,140,0.42)' : 'rgba(200,130,120,0.38)';
        const lineLen = canPot ? bestP.d : 60;
        c2.beginPath(); c2.moveTo(hitBall.x, hitBall.y);
        c2.lineTo(hitBall.x + tgX * lineLen, hitBall.y + tgY * lineLen); c2.stroke();
        if (canPot) {
          c2.setLineDash([]);
          c2.strokeStyle = 'rgba(120,180,140,0.5)';
          c2.beginPath(); c2.arc(bestP.x, bestP.y, POCKET_R, 0, Math.PI * 2); c2.stroke();
        }
        // ③ 白球分离方向（短）
        const sepX = dirX - tgX * (dirX * tgX + dirY * tgY);
        const sepY = dirY - tgY * (dirX * tgX + dirY * tgY);
        const sepD = Math.hypot(sepX, sepY);
        if (sepD > 0.05) {
          c2.strokeStyle = 'rgba(255,255,255,0.2)';
          c2.beginPath(); c2.moveTo(endX, endY);
          c2.lineTo(endX + sepX / sepD * 28, endY + sepY / sepD * 28); c2.stroke();
        }
      } else {
        // ③ 库边反弹预测（一次反射）
        c2.strokeStyle = 'rgba(255,255,255,0.16)';
        let rx = dirX, ry = dirY, px = endX, py = endY;
        if (wallAxis === 'x') rx = -rx; else ry = -ry;
        c2.beginPath(); c2.moveTo(px, py); c2.lineTo(px + rx * 70, py + ry * 70); c2.stroke();
      }
      c2.setLineDash([]);
      // ④ 力度条
      c2.fillStyle = power > 0.8 ? 'rgba(190,130,120,0.5)' : 'rgba(120,160,135,0.5)';
      c2.fillRect(CUSHION, TABLE_H + CUSHION + 4, (TABLE_W) * power, 5);
    }

    /* ---------- 渲染 ---------- */
    function layout() {
      if (!root || !canvas) return;
      const rect = root.getBoundingClientRect();
      if (!rect.width) return;
      const dpr = window.devicePixelRatio || 1;
      scale = Math.min(rect.width / (TABLE_W + CUSHION * 2), rect.height / (TABLE_H + CUSHION * 2 + 14));
      offX = (rect.width - (TABLE_W + CUSHION * 2) * scale) / 2;
      offY = (rect.height - (TABLE_H + CUSHION * 2 + 14) * scale) / 2;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
    }

    function render() {
      if (!c2d) return;
      // 读取透明/墨色滑块（与其他游戏联动）
      let ga = 0.45;
      try {
        const cs = getComputedStyle(root);
        ga = parseFloat(cs.getPropertyValue('--glass-alpha'));
        if (isNaN(ga)) ga = 0.45;
      } catch (e) {}
      const ballA = 0.45 + 0.45 * ga;          // 球体透明度联动
      const tableA = 0.45 + 0.4 * ga;          // 桌面透明度联动
      const c2 = c2d;
      const dpr = window.devicePixelRatio || 1;
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      c2.clearRect(0, 0, canvas.width, canvas.height);
      c2.save();
      c2.translate(offX, offY);
      c2.scale(scale, scale);
      // 桌面：灰墨绿（低饱和）
      c2.fillStyle = 'rgba(42,46,44,' + (tableA * 0.95) + ')';
      roundRect(c2, 0, 0, TABLE_W + CUSHION * 2, TABLE_H + CUSHION * 2, 10);
      c2.fill();
      c2.fillStyle = 'rgba(44,50,46,' + tableA + ')';
      c2.fillRect(CUSHION, CUSHION, TABLE_W, TABLE_H);
      // 袋口
      for (const p of POCKETS) {
        c2.fillStyle = 'rgba(24,26,28,0.9)';
        c2.beginPath(); c2.arc(CUSHION + p.x, CUSHION + p.y, POCKET_R, 0, Math.PI * 2); c2.fill();
      }
      // 置球点
      c2.fillStyle = 'rgba(255,255,255,0.15)';
      c2.beginPath(); c2.arc(CUSHION + TABLE_W * 0.72, CUSHION + TABLE_H / 2, 2.5, 0, Math.PI * 2); c2.fill();

      // 辅助线（球下层画）
      drawAimHelpers();

      // 球
      for (const b of balls) {
        if (b.potted) continue;
        const col = COLORS[b.num] || 'rgba(200,200,200,';
        // 球组高亮（辅助线⑤）
        const isMine = turn === 'player';
        const g = myGroup;
        let glow = false;
        if (state === 'aim' && turn === 'player' && g && groupOf(b.num) === g) glow = true;
        if (glow) {
          c2.strokeStyle = 'rgba(210,190,130,0.3)';
          c2.lineWidth = 2;
          c2.beginPath(); c2.arc(b.x, b.y, R + 3, 0, Math.PI * 2); c2.stroke();
          c2.lineWidth = 1;
        }
        c2.fillStyle = col + ballA + ')';
        c2.beginPath(); c2.arc(b.x, b.y, R, 0, Math.PI * 2); c2.fill();
        c2.strokeStyle = 'rgba(255,255,255,0.18)';
        c2.beginPath(); c2.arc(b.x, b.y, R, 0, Math.PI * 2); c2.stroke();
        // 号码
        if (b.num !== 0) {
          c2.fillStyle = 'rgba(255,255,255,0.55)';
          c2.font = 'bold 7px sans-serif';
          c2.textAlign = 'center'; c2.textBaseline = 'middle';
          c2.fillText(String(b.num), b.x, b.y + 0.5);
          // 花色条（条纹球 9-15 画白带）
          if (b.num >= 9) {
            c2.strokeStyle = 'rgba(255,255,255,0.28)';
            c2.beginPath(); c2.moveTo(b.x - R + 2, b.y); c2.lineTo(b.x + R - 2, b.y); c2.stroke();
          }
        } else {
          c2.fillStyle = 'rgba(120,120,120,0.4)';
          c2.beginPath(); c2.arc(b.x - 2.5, b.y - 2.5, 2, 0, Math.PI * 2); c2.fill();
        }
      }

      // 拉杆示意
      if (dragging && state === 'aim' && turn === 'player') {
        const dx = dragStart.x - dragNow.x, dy = dragStart.y - dragNow.y;
        const d = Math.hypot(dx, dy);
        if (d > 4) {
          const dirX = dx / d, dirY = dy / d;
          const power = Math.min(1, d / 180);
          c2.strokeStyle = 'rgba(180,160,110,0.7)';
          c2.lineWidth = 3;
          c2.beginPath();
          c2.moveTo(cue.x - dirX * (R + 4), cue.y - dirY * (R + 4));
          c2.lineTo(cue.x - dirX * (R + 4 + 50 * power), cue.y - dirY * (R + 4 + 50 * power));
          c2.stroke();
          c2.lineWidth = 1;
        }
      }

      // 自由球摆放模式提示
      if (state === 'placeCue') {
        c2.setLineDash([3, 3]);
        c2.strokeStyle = 'rgba(230,200,120,0.6)';
        c2.strokeRect(CUSHION, CUSHION, TABLE_W, TABLE_H);
        c2.setLineDash([]);
      }

      c2.restore();
    }

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    /* ---------- 坐标转换 ---------- */
    function toTable(e) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - offX) / scale - CUSHION;
      const y = (e.clientY - rect.top - offY) / scale - CUSHION;
      return { x, y };
    }

    /* ---------- 主循环 ---------- */
    let rafId = null, lastT = 0;
    function loop(t) {
      rafId = requestAnimationFrame(loop);
      const dt = Math.min(50, t - (lastT || t));
      lastT = t;
      if (state === 'moving') {
        physicsFrame(dt);
        if (allStopped()) {
          // 全停后结算
          balls.forEach(b => { if (!b.potted) { b.vx = 0; b.vy = 0; } });
          onShotEnd();
        }
      }
      render();
    }

    /* ---------- 交互 ---------- */
    function onDown(e) {
      if (state === 'placeCue') {
        const p = toTable(e);
        // 摆白球
        if (p.x > CUSHION + R && p.x < TABLE_W - R && p.y > CUSHION + R && p.y < TABLE_H - R
          && !balls.some(b => !b.potted && b.num !== 0 && Math.hypot(b.x - p.x, b.y - p.y) < R * 2.1)
          && !POCKETS.some(pk => Math.hypot(CUSHION + pk.x - p.x, CUSHION + pk.y - p.y) < POCKET_R + R)) {
          cue.x = p.x; cue.y = p.y;
          state = 'aim';
          updateStatus();
        }
        return;
      }
      if (state !== 'aim' || turn !== 'player') return;
      dragging = true;
      dragStart = toTable(e);
      dragNow = { ...dragStart };
    }
    function onMove(e) {
      if (!dragging) return;
      dragNow = toTable(e);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      const dx = dragStart.x - dragNow.x, dy = dragStart.y - dragNow.y;
      const d = Math.hypot(dx, dy);
      if (d > 12) {
        shoot(dx / d, dy / d, Math.min(1, d / 180));
      }
    }

    /* ---------- 状态栏 ---------- */
    function updateStatus(settle) {
      if (state === 'over') {
        ctx.setStatus(winner === 'player' ? '🏆 你赢了！' : 'AI 赢了，再来一把？');
        return;
      }
      const who = turn === 'player' ? '你' : 'AI';
      const gTxt = myGroup ? (turn === 'player' ? groupCn(myGroup) : groupCn(aiGroup)) : '未定组';
      const remain = myGroup ? myRemaining(turn === 'player' ? myGroup : aiGroup) : '';
      let s = `${who}击球 · ${gTxt}${remain !== '' ? ` 剩${remain}` : ''}`;
      if (settle && settle.foul) s += ` · ⚠犯规(${settle.foulReason}) 对方自由球`;
      if (state === 'placeCue') s += ' · 点击桌面任意空位放白球';
      else if (turn === 'player') s += ' · 按住拖拽瞄准，松手击球';
      ctx.setStatus(s);
    }
    function groupCn(g) { return g === 'solid' ? '全色(1-7)' : '条纹(9-15)'; }

    /* ---------- 生命周期 ---------- */
    function reset() {
      rackBalls();
      myGroup = null; aiGroup = null;
      turn = 'player'; state = 'aim'; winner = null;
      firstHit = null; pottedThisShot = []; shotCount = 0;
      dragging = false;
      if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
      if (!canvas) buildDom();
      render();
      updateStatus();
    }

    function buildDom() {
      root.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'bl-root';
      canvas = document.createElement('canvas');
      wrap.appendChild(canvas);
      root.appendChild(wrap);
      c2d = canvas.getContext('2d');
      canvas.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      resizeObs = new ResizeObserver(() => { layout(); render(); });
      resizeObs.observe(root);
      layout();
    }

    return {
      mount(el, appCtx) {
        root = el; ctx = appCtx;
        reset();
        rafId = requestAnimationFrame(loop);
        // 冒烟钩子
        window.__smokeState = () => ({
          state, turn, winner,
          myGroup, aiGroup,
          pieces: balls.filter(b => !b.potted).length,
          potted: balls.filter(b => b.potted && b.num !== 0).map(b => b.num),
          cuePotted: cue.potted,
          shotCount,
          remaining: myGroup ? { me: myRemaining(myGroup), ai: myRemaining(aiGroup) } : null,
        });
        window.__bShoot = (dx, dy, pw) => { shoot(dx, dy, pw); return 'ok'; };
        window.__bInfo = () => ({ balls: balls.filter(b => !b.potted).map(b => ({ n: b.num, x: Math.round(b.x), y: Math.round(b.y) })) });
      },
      destroy() {
        if (rafId) cancelAnimationFrame(rafId);
        if (aiTimer) clearTimeout(aiTimer);
        if (resizeObs) resizeObs.disconnect();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        try { delete window.__smokeState; } catch (e) { window.__smokeState = null; }
        try { delete window.__bShoot; } catch (e) { window.__bShoot = null; }
        try { delete window.__bInfo; } catch (e) { window.__bInfo = null; }
        root.innerHTML = '';
      },
      onDiffChange(d) { diff = d; },
      onModeChange(m) { mode = m; },
      onNewGame() { reset(); },
      undo() { return false; },   // 台球不做悔棋（物理连续状态复杂）
    };
  }

  window.GlassGames.register({
    id: 'billiard',
    name: '台球',
    icon: '🎱',
    factory,
    flags: { hasAI: true },
  });
})();
