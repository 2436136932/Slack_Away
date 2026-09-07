/* 台球 AI 自对弈模拟：node tools/test-billiard-sim.js [局数] [难度]
 * 随机打玩家杆 + AI 内部决策，跑完整局验证规则/轮转/胜负 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const GAMES = Number(process.argv[2] || 5);
const DIFF = process.argv[3] || 'medium';

function makeSandbox() {
  let rafCb = null, clock = 0;
  const sb = {
    window: {}, console, setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
    requestAnimationFrame: (fn) => { rafCb = fn; return 1; }, cancelAnimationFrame() {},
    document: {
      createElement: () => ({ innerHTML: '', style: {}, appendChild() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, toggle() {}, remove() {} }, getContext: () => null, getBoundingClientRect: () => ({ width: 828, height: 428, left: 0, top: 0 }), observe() {}, disconnect() {}, width: 0, height: 0, dataset: {} }),
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    },
    ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  };
  sb.window.GlassGames = { register(d) { sb.__def = d; } };
  sb.window.addEventListener = () => {};
  sb.window.removeEventListener = () => {};
  sb.__step = (ms) => { clock += ms; const cb = rafCb; rafCb = null; if (cb) { cb(clock); return true; } return false; };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/games/billiard.js'), 'utf8'), sb);
  return sb;
}

let finished = 0, playerWin = 0, aiWin = 0, stuck = 0;
const winners = [];
for (let g = 1; g <= GAMES; g++) {
  const sb = makeSandbox();
  const inst = sb.__def.factory();
  inst.onDiffChange(DIFF);
  const el = { innerHTML: '', appendChild() {}, querySelector() { return null; }, addEventListener() {}, getBoundingClientRect: () => ({ width: 828, height: 428, left: 0, top: 0 }), observe() {}, disconnect() {} };
  inst.mount(el, { setStatus() {}, onGameEnd() {} });

  let shots = 0, hung = false;
  for (let g2 = 0; g2 < 500; g2++) {
    const st = sb.window.__smokeState();
    if (st.state === 'over') break;
    if (st.state === 'aim' && st.turn === 'player') {
      const a = Math.random() * Math.PI * 2;
      sb.window.__bShoot(Math.cos(a), Math.sin(a), 0.4 + Math.random() * 0.5);
      shots++;
    }
    let f = 0;
    while (f < 600) {
      if (!sb.__step(16)) break;
      f++;
      const s2 = sb.window.__smokeState();
      if (s2.state === 'aim' || s2.state === 'over') break;
    }
    // 卡死检测：200 轮外层没进展
    if (g2 > 200 && sb.window.__smokeState().state === 'aim' && shots === shots) {
      // turn==='ai' 且 AI 不打 = 卡死
      if (sb.window.__smokeState().turn === 'ai') {
        // 再给 AI 一次机会（onShotEnd 里 setTimeout 已同步触发，若还卡说明真死锁）
        hung = true;
        break;
      }
    }
  }
  const fin = sb.window.__smokeState();
  if (fin.state === 'over') {
    finished++;
    if (fin.winner === 'player') playerWin++; else aiWin++;
    winners.push(fin.winner === 'player' ? '玩家' : 'AI');
  } else if (hung) {
    stuck++;
    winners.push('卡死');
  } else {
    winners.push('未完(' + fin.state + '/' + fin.turn + '/杆' + shots + ')');
  }
  console.log(`第${g}局: 杆数=${shots} 状态=${fin.state} 胜者=${fin.winner || '-'} 定组=${fin.myGroup || '-'} 落袋=${JSON.stringify(fin.potted)} 剩余=${JSON.stringify(fin.remaining)}`);
}
console.log(`\n${DIFF}: 完成 ${finished}/${GAMES} · 玩家胜 ${playerWin} / AI胜 ${aiWin} / 卡死 ${stuck}`);
console.log('明细: ' + winners.join(' | '));
process.exit(stuck > GAMES / 2 ? 1 : 0);
