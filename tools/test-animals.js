/* 斗兽棋规则单测：node tools/test-animals.js
 * 通过 vm 加载 animals.js，用 _test 钩子注入可控布局验证核心规则 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const file = fs.readFileSync(path.join(__dirname, '../renderer/games/animals.js'), 'utf8');
const sandbox = { window: {}, console, setTimeout, document: { createElement: () => ({}), querySelector: () => null } };
sandbox.window.GlassGames = { register(d) { sandbox.__def = d; } };
vm.createContext(sandbox);
vm.runInContext(file, sandbox);
const inst = sandbox.__def.factory();
const T = inst._test;
const { canMove, legalMovesFor, setBoard, setTurn } = T;

let pass = 0, fail = 0;
function t(name, ok) { if (ok) pass++; else { fail++; console.log('  FAIL ' + name); } }

function empty() { return Array.from({ length: 8 }, () => new Array(8).fill(null)); }
function put(board, r, c, side, id) { board[r][c] = [side, id]; }
function putPit(board, r, c) { board[r][c] = 'pit'; }

// 1. 象吃猫
{
  const b = empty(); put(b, 4, 4, 'b', 'e'); put(b, 4, 3, 'r', 'c'); setBoard(b); setTurn('b');
  t('象吃猫', canMove(4, 4, 4, 3) === true);
}
// 2. 猫不能吃象
{
  const b = empty(); put(b, 4, 4, 'b', 'c'); put(b, 4, 3, 'r', 'e'); setBoard(b); setTurn('b');
  t('猫不能吃象', canMove(4, 4, 4, 3) === false);
}
// 3. 鼠吃象
{
  const b = empty(); put(b, 4, 4, 'b', 'r'); put(b, 4, 3, 'r', 'e'); setBoard(b); setTurn('b');
  t('鼠吃象', canMove(4, 4, 4, 3) === true);
}
// 4. 象不能吃鼠
{
  const b = empty(); put(b, 4, 4, 'b', 'e'); put(b, 4, 3, 'r', 'r'); setBoard(b); setTurn('b');
  t('象不能吃鼠', canMove(4, 4, 4, 3) === false);
}
// 5. 同级不能互吃
{
  const b = empty(); put(b, 4, 4, 'b', 'c'); put(b, 4, 3, 'r', 'c'); setBoard(b); setTurn('b');
  t('同级不能互吃', canMove(4, 4, 4, 3) === false);
}
// 6. 陷阱里象被鼠吃
{
  const b = empty(); put(b, 4, 4, 'b', 'e'); putPit(b, 4, 4); put(b, 4, 3, 'r', 'r'); setBoard(b); setTurn('r');
  t('陷阱象被鼠吃', canMove(4, 3, 4, 4) === true);
}
// 7. 陷阱里象被猫吃（陷阱变1）
{
  const b = empty(); put(b, 4, 4, 'b', 'e'); putPit(b, 4, 4); put(b, 4, 3, 'r', 'c'); setBoard(b); setTurn('r');
  t('陷阱象被猫吃', canMove(4, 3, 4, 4) === true);
}
// 8. 鼠不能进河
{
  const b = empty(); put(b, 3, 4, 'b', 'r'); setBoard(b); setTurn('b');
  t('鼠不能进河', canMove(3, 4, 2, 4) === false && canMove(3, 4, 4, 4) === true);
}
// 9. 非鼠可进河
{
  const b = empty(); put(b, 3, 4, 'b', 'c'); setBoard(b); setTurn('b');
  t('猫可进河', canMove(3, 4, 2, 4) === true);
}
// 10. 狮跳过河 / 不能跳非河
{
  const b = empty(); put(b, 7, 1, 'b', 's'); setBoard(b); setTurn('b');
  t('狮不能跳非河', canMove(7, 1, 4, 1) === false);
  const b2 = empty(); put(b2, 6, 1, 'b', 's'); setBoard(b2); setTurn('b');
  t('狮跳过河', canMove(6, 1, 4, 1) === true);
}
// 11. 猫不能跳河
{
  const b = empty(); put(b, 6, 1, 'b', 'c'); setBoard(b); setTurn('b');
  t('猫不能跳河', canMove(6, 1, 4, 1) === false);
}
// 12. 不能进己方兽穴
{
  const b = empty(); put(b, 6, 3, 'b', 'c'); setBoard(b); setTurn('b');
  t('不能进己方兽穴', canMove(6, 3, 7, 3) === false);
}
// 13. 可进对方兽穴
{
  const b = empty(); put(b, 1, 3, 'b', 'c'); setBoard(b); setTurn('b');
  t('可进对方兽穴', canMove(1, 3, 0, 3) === true);
}
// 14. 空板中间子的走法数=4
{
  const b = empty(); put(b, 4, 4, 'b', 'c'); setBoard(b); setTurn('b');
  t('猫4方向走法数=4', legalMovesFor(4, 4).length === 4);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
