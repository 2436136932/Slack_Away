/* 听牌检测单元测试：node tools/test-mahjong-tenpai.js
 * 牌编码：0-8万 9-17条 18-26筒 27红中(赖子) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const file = fs.readFileSync(path.join(__dirname, '../renderer/games/mahjong.js'), 'utf8');
const sandbox = { window: {}, console, document: { querySelector: () => null } };
sandbox.window.GlassGames = { register() {} };
vm.createContext(sandbox);
vm.runInContext(file, sandbox);
const tenpai = sandbox.window.__mjTenpai;
const m = n => n - 1, s = n => 8 + n, p = n => 17 + n;
const sort = a => a.slice().sort((x, y) => x.t - y.t);
const lbl = x => (x.t === 27 ? '红中' : ['万', '条', '筒'][Math.floor(x.t / 9)] + ((x.t % 9) + 1)) + '(' + x.n + ')';

/* 13 张经典听牌：123 456 789 111 + 5万 → 只胡 5万（或红中补将） */
const h1 = [m(1),m(2),m(3), m(4),m(5),m(6), m(7),m(8),m(9), m(1),m(1),m(1), m(5)];
/* 13 张 + 赖子：123 456 789 111 + 红中 → 任意牌都能胡（赖子配将） */
const h2 = [m(1),m(2),m(3), m(4),m(5),m(6), m(7),m(8),m(9), m(1),m(1),m(1), 27];
/* 14 张已成型：111 123 456 789 99 → 一定听牌（打掉一张即听） */
const h3 = [m(1),m(1),m(1), m(1),m(2),m(3), m(4),m(5),m(6), m(7),m(8),m(9), m(9),m(9)];
/* 14 张孤张垃圾 → 不听 */
const h4 = [m(1),m(5),m(9), s(2),s(6),s(9), p(3),p(7),p(9), m(2),m(4),m(6),m(8),m(7)];

const cases = [
  ['13张听5万 -> 只胡 5万/红中', h1, 0, [m(5), 27]],
  ['13张+赖子 -> 听牌(非空且≥5种)', h2, 0, null],
  ['14张已成型 -> 一定听牌(非空)', h3, 0, null],
  ['14张垃圾 -> 不听(空)', h4, 0, []],
];

let pass = 0, fail = 0;
for (const [name, hand, melds, want] of cases) {
  const got = sort(tenpai(hand, melds));
  const gotLbl = got.map(lbl).join(' ');
  let ok;
  if (want === null) {
    ok = got.length > 0;
    if (name.includes('≥5')) ok = got.length >= 5;
  } else {
    const wantVals = (want || []).slice().sort((a, b) => a - b);
    const gotVals = got.map(x => x.t);
    ok = JSON.stringify(gotVals) === JSON.stringify(wantVals);
  }
  if (ok) { pass++; console.log('  PASS  ' + name + ' -> ' + gotLbl); }
  else { fail++; console.log('  FAIL  ' + name + '  期望=' + JSON.stringify(want) + ' 实际=[ ' + gotLbl + ' ]'); }
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
