/* 胡牌判定单元测试：node tools/test-mahjong-win.js
 * 牌编码：0-8 万1-9，9-17 条1-9，18-26 筒1-9，27 红中(赖子) */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = fs.readFileSync(path.join(__dirname, '../renderer/games/mahjong.js'), 'utf8');
const sandbox = { window: {}, console };
sandbox.window.GlassGames = { register() {} };
vm.createContext(sandbox);
vm.runInContext(file, sandbox);
const canWin = sandbox.window.__mjCanWin;

// 简写：万 m1..m9 = 0-8，条 s1..s9 = 9-17，筒 p1..p9 = 18-26，中 z = 27
const m = n => n - 1;              // 万
const s = n => 8 + n;              // 条
const p = n => 17 + n;             // 筒
const z = 27;                      // 赖子

const cases = [
  // [名称, 暗牌, 副露数, 期望]
  ['标准 4刻+将（无赖子）', [m(1),m(1),m(1), m(5),m(5),m(5), s(3),s(3),s(3), p(7),p(7),p(7), m(9),m(9)], 0, true],
  ['标准 顺子+刻子混（无赖子）', [m(1),m(2),m(3), m(5),m(5),m(5), s(3),s(4),s(5), p(7),p(8),p(9), m(9),m(9)], 0, true],
  ['差一张（不成胡）', [m(1),m(2),m(4), m(5),m(5),m(5), s(3),s(4),s(5), p(7),p(8),p(9), m(9),m(9)], 0, false],
  ['赖子补刻子（1赖子+2真）', [m(1),m(1),z, m(5),m(5),m(5), s(3),s(3),s(3), p(7),p(7),p(7), m(9),m(9)], 0, true],
  ['赖子补顺子中间张', [m(1),z,m(3), m(5),m(5),m(5), s(3),s(3),s(3), p(7),p(7),p(7), m(9),m(9)], 0, true],
  ['2赖子做将', [m(1),m(1),m(1), m(5),m(5),m(5), s(3),s(3),s(3), p(7),p(7),p(7), z,z], 0, true],
  ['4赖子全补', [m(1),m(1),z, m(5),m(5),z, s(3),s(3),z, p(7),p(7),p(7), z,z], 0, true],
  ['赖子不能跨花色凑顺（应失败）', [m(9),z,s(1), m(1),m(1), m(5),m(5),m(5), s(3),s(3),s(3), p(7),p(7),p(7)], 0, false],
  ['赖子确实能同花色凑顺（对照）', [m(1),z,m(3), m(1),m(1), m(5),m(5),m(5), s(3),s(3),s(3), p(7),p(7),p(7)], 0, true],
  ['1副露：暗牌 11 张成 3副+将', [m(1),m(1),m(1), s(3),s(4),s(5), p(7),p(8),p(9), m(9),m(9)], 1, true],
  ['1副露但暗牌张数不对', [m(1),m(1),m(1), s(3),s(4),s(5), p(7),p(8),p(9), m(9)], 1, false],
  ['3副露：暗牌 5 张成 1副+将', [m(1),m(1),m(1), m(9),m(9)], 3, true],
  ['4副露：暗牌 2 张只要将', [m(9),m(9)], 4, true],
  ['4副露：暗牌 2 张不是将', [m(9),m(8)], 4, false],
  ['七对可胡（合肥规则支持）', [m(1),m(1),m(3),m(3),m(5),m(5),m(7),m(7),m(9),m(9),s(1),s(1),s(3),s(3)], 0, true],
  ['龙七对可胡（含4张同牌）', [m(1),m(1),m(1),m(1),s(2),s(2),p(3),p(3),s(4),s(4),p(5),p(5),m(6),m(6)], 0, true],
];

let pass = 0, fail = 0;
for (const [name, tiles, melds, want] of cases) {
  const got = canWin(tiles, melds);
  const ok = got === want;
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  期望=' + want + ' 实际=' + got); }
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
