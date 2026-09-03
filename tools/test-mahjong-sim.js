/* 麻将全流程模拟测试：node tools/test-mahjong-sim.js
 * 用 vm 桩掉 DOM，完整跑 4 家 AI 对局，定位运行时错误 / 验证胡牌率 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 最小 DOM 桩 ---------- */
function stubEl() {
  const el = {
    className: '', innerHTML: '', textContent: '', hidden: false,
    style: { setProperty() {}, display: '' },
    dataset: {},
    children: [],
    firstChild: { textContent: '' },
    offsetWidth: 26, offsetHeight: 36, offsetLeft: 0, offsetTop: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); },
    setAttribute() {},
    querySelector() { return stubEl(); },
    querySelectorAll() { return [stubEl(), stubEl(), stubEl()]; },
    closest() { return null; },
    dispatchEvent() {},
  };
  return el;
}

const file = fs.readFileSync(path.join(__dirname, '../renderer/games/mahjong.js'), 'utf8');
const sandbox = {
  window: {},
  console,
  setTimeout: (fn) => { fn(); return 0; },       // 同步执行定时器
  clearTimeout() {},
  document: {
    createElement: () => stubEl(),
    createElementNS: () => stubEl(),
    querySelector: () => null,           // __smokeState 里查 .mj-tile.fresh
  },
  Math, JSON, Array, Number, String, Object,
};
let registered = null;
sandbox.window.GlassGames = { register(d) { registered = d; } };
vm.createContext(sandbox);
vm.runInContext(file, sandbox);

// 挂载游戏（模拟 mount）
const inst = registered.factory();
inst.mount(stubEl(), { setStatus() {}, onGameEnd() {} });

const canWin = sandbox.window.__mjCanWin;
const st = () => sandbox.window.__smokeState();   // vm 内直接拿对象
const play = () => sandbox.window.__mjPlayAsBot();
const claim = (y) => sandbox.window.__mjClaim(y);

/* ---------- 跑 N 局 ---------- */
const GAMES = Number(process.argv[2]) || 20;
let huCount = 0, drewCount = 0, errors = 0, laiziThrown = 0;
const huBySeat = [0, 0, 0, 0];

for (let g = 1; g <= GAMES; g++) {
  try {
    let last = null, steps = 0;
    for (; steps < 4000; steps++) {
      last = st();
      if (last.phase === 'over') break;
      if (last.canDiscard) play();
      else if (last.pending) claim(true);
    }
    if (last.winner >= 0) { huCount++; huBySeat[last.winner]++; }
    else drewCount++;
    if (last.poolLaizi > 0) laiziThrown += last.poolLaizi;
    console.log(`第${g}局 steps=${steps} 胡家=${last.winner} 牌墙剩=${last.wall} 副露=${JSON.stringify(last.melds)} 牌河红中=${last.poolLaizi}`);
    // 开下一局
    if (g < GAMES) sandbox.window.__mjNewGame && sandbox.window.__mjNewGame();
  } catch (e) {
    errors++;
    console.log(`第${g}局 抛错: ${e.message}\n${e.stack.split('\n').slice(0, 4).join('\n')}`);
    break;
  }
}
console.log(`\n结果: ${GAMES} 局 → 胡 ${huCount} / 流局 ${drewCount} / 出错 ${errors} / 牌河红中 ${laiziThrown}（应为 0）`);
console.log(`胡家分布 [你/下家/对面/上家]: ${JSON.stringify(huBySeat)}`);
process.exit(errors ? 1 : 0);
