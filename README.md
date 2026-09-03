# 摸鱼玻璃小局 (Glass Games)

> 🧊 桌面透明玻璃摸鱼小游戏集 —— Apple 毛玻璃悬浮卡片 · 五子棋 / 象棋 · 本地 AI + 大模型双模式 · Alt+G 一键隐身

复刻自 [Countdown-to-Off-work-Browser](https://github.com/2436136932/Countdown-to-Off-work-Browser) 的「透明玻璃 + 摸鱼游戏」玩法，做成独立桌面应用（Electron），真·桌面透明窗口，玻璃后面透出的是你的桌面。

## 功能

- **真透明玻璃卡片**：无边框透明窗口 + `backdrop-filter` 毛玻璃，26px 大圆角
- **空心棋子**：棋子内部全透明（用 `destination-out` 擦除，露出桌面），只剩细环 + 字。棋盘线穿透棋子内部显示，不形成色块，摸鱼终极隐身
- **透明度 0~100% 无级滑块**：玻璃越透明，棋子同步变淡（保底可见），上班摸鱼一键隐身
- **墨色浓度 0~100% 滑块**（颜色淡到不能淡）：单独控制棋子/棋盘线/楚河汉界的**颜色浓度**。0% = 全灰（彻底融进背景，对比度归零），100% = 用足底色。**默认 45%** 极低对比，摸鱼级隐身
- **幽灵模式**（极限隐身）：鼠标移开 0.7s 后整卡 opacity 降到 **3.5%**，只剩一点点星位残影；鼠标进来立刻恢复清晰。底部 👻 按钮或 **Alt+H** 切换，默认开启
- **五子棋 / 象棋**：Canvas 绘制，棋子/棋盘/选中/上一步痕迹全部走"低对比 + 随玻璃透明度向中性灰收敛"公式，永远不抢眼
- **悔棋**：撤销玩家+AI 最近各一步，回到玩家回合（AI 思考中禁止悔棋）
- **本地 AI + 大模型双模式**：
  - 本地：五子棋棋型评估 / 象棋 negamax 搜索（复用原项目 xiangqi.js 引擎）
  - 大模型：任意 OpenAI 兼容接口（DeepSeek / New API / Kimi…），走棋失败自动回退本地
- **三档难度**：简单 / 中等 / 困难
- **摸鱼隐身四件套**：① Alt+G 全局呼出/隐藏 ② 鼠标移开自动淡化（0.7s 触发）③ 赢棋不高亮（低调收好）④ 标题栏伪装「工作台 · 本周排期表.xlsx」
- **拖拽移动 + 右下角缩放 + 位置记忆**（重启还原）
- **托盘常驻**：关闭=隐藏，不占任务栏

## 启动

### 方式一：双击即玩（推荐 · 无需任何编译器）

到 `dist/摸鱼玻璃小局/` 目录，**双击 `双击启动.bat`** 即可开玩，整个文件夹拷到任何 Windows 电脑都能跑（无需 Node.js / npm）。269 MB 包含完整 Electron 运行时。

> 绿色版已内置「双击启动.bat」+ 完整运行时 + 应用源码（`resources/app/`）。  
> 整个文件夹随便拷、随便发，重装系统也能跑。

### 方式二：开发模式

```bash
npm install
npm start
# 或：双击根目录的「启动摸鱼小局.bat」
```

**快捷键**：
- `Alt+G` 呼出 / 隐藏（全局有效）
- `Alt+H` 切换幽灵模式（全局有效）

## 新增一个游戏（可拓展核心）

1. 在 `renderer/games/` 下新建 `mygame.js`：

```js
(function () {
  window.GlassGames.register({
    id: 'mygame',          // 唯一 id
    name: '我的游戏',       // 悬停提示
    icon: '🎲',            // 顶栏图标
    factory() {
      return {
        mount(root, ctx)  { /* root: 挂载点; ctx: setStatus/llm/settings/onGameEnd */ },
        destroy()         { /* 清理事件/定时器 */ },
        onDiffChange(d)   {},
        onModeChange(m)   {},
        onNewGame()       {},
      };
    },
  });
})();
```

2. 在 `renderer/index.html` 加一行 `<script src="games/mygame.js"></script>`

完成——顶栏图标自动出现，难度/模式/新局按钮自动接入，无需改核心代码。

## 目录结构

```
glass-games/
├── main.js                  # 主进程：透明窗口/托盘/快捷键/LLM 网关/设置持久化
├── preload.js               # IPC 安全桥
├── renderer/
│   ├── index.html           # 壳页面（伪装标题栏）
│   ├── glass.css            # 玻璃视觉核心（backdrop-filter + 透明度联动）
│   ├── core/
│   │   ├── registry.js      # 游戏注册表（可拓展核心）
│   │   └── app.js           # 壳逻辑：拖拽/缩放/滑块/隐身/游戏切换
│   ├── games/
│   │   ├── gomoku.js        # 五子棋插件
│   │   └── xiangqi-game.js  # 象棋插件
│   └── vendor/
│       └── xiangqi.js       # 象棋引擎（复用原项目，UMD 可单测）
└── 启动摸鱼小局.bat
```

## LLM 配置

点工具条右上角 ⚙，填 OpenAI 兼容接口：

- **Base URL**：如 `https://api.deepseek.com/v1`，或你自建 New API 地址
- **API Key**：`sk-...`
- **模型名**：手输，或点 ▾ 从拉取的列表中选
- **获取模型**：填好 URL+Key 后点此按钮，自动 GET `/v1/models` 拉取可用模型列表 → **自绘下拉面板自动展开**，全量显示所有模型（带对话/多模态/向量等分类标签），点选即填入；输入框也支持手输列表外的模型名。点面板外或按 Esc 收起，▾ 随时再展开

> 实现说明：刻意不用原生 `<datalist>`——Chromium 会按输入框字符过滤 option，导致"明明拉到几十个模型却只显示 1 个"。自绘面板全量渲染，无过滤。

设置存本地 JSON（`%APPDATA%/glass-games/glass-games-settings.json`），不上传任何数据。

**开发者**：可用 `node tools/mock-models.js` 起一个本地 mock `/v1/models`（返回 7 个假模型）来验证下拉面板，配合冒烟环境变量 `GLASS_SMOKE_LLM_URL` / `GLASS_SMOKE_LLM_KEY`。

## 透明度 + 墨色 + 幽灵模式（三档滑块联动）

底部两条滑块 + 一个按钮：

| 滑块/按钮 | 作用 | 默认 |
|---|---|---|
| **透明 ↔ 实体** | 控制玻璃底色 + 棋子 alpha | 45% |
| **墨色 ↔ 鲜明** | 控制棋子/棋盘**颜色浓度**（不透明度之外的"对比度"） | 45% |
| **👻 幽灵模式** | 鼠标移开 0.7s 后整卡 opacity 3.5% | 开 |

**双滑块如何叠加**：`实际插值强度 k = --stone-alpha * --stone-ink`，颜色从 `中性灰 [168,172,180]` 向底色收敛。

| 滑块组合 | 视觉 | 适用 |
|---|---|---|
| 透明 0% + 墨色 任意 | 棋盘线/棋子 2% 灰，alpha 0.03 | 极限隐身（棋盘完全消失） |
| **透明 45% + 墨色 45%**（默认） | 玻璃淡雅，棋盘线 20% 灰，棋子柔和中灰/低饱和红 | 日常摸鱼档（能看见、别人不一定注意） |
| 透明 100% + 墨色 0% | 玻璃实，棋子全灰环 | 颜色对比度归零（参见 `07-墨色0%全灰实体.png`） |
| 透明 100% + 墨色 100% | 玻璃实，棋子高对比（深灰/鲜红） | 玩正经棋 |

**关键修复**：之前光降 alpha（透明度）效果不够——深色棋子在浅玻璃上仍是"灰色污点"色块。墨色滑块直接降**颜色饱和度 + 明度差**，让棋子融进背景。`mix([base], k)` 公式：
```js
const NEUTRAL = [168, 172, 180];
return Math.round(NEUTRAL[i] + (base[i] - NEUTRAL[i]) * k)   // RGB 各通道
```

**幽灵模式**叠加在两滑块之上：鼠标移开 0.7s 后整卡 opacity 再额外降到 3.5%，鼠标进来立刻恢复。

实现要点：
- CSS 变量 + `getComputedStyle` 读取，棋子在 canvas draw 前用 `globalAlpha` 全权控制（fillStyle 不再带冗余 alpha）
- 滑块拖动 → CSS 变量变化 → **手动调** `window.__ggDraw__()` 强制重画（CSS 变量不触发 canvas）
- 幽灵模式用 `--card-op` 变量 + `#card.ghost / .faded / .ghost.faded` 三态 opacity
- 鼠标移开淡化延迟 1200ms → 700ms（更灵敏）

## 已知环境问题

远程桌面 / 部分虚拟桌面下 GPU 进程可能崩溃，项目已内置 `in-process-gpu` / `no-sandbox` / 禁止后台降级等兼容开关（见 main.js），透明与毛玻璃效果不受影响。

## 自动化验证（GLASS_SMOKE）

设置环境变量 `GLASS_SMOKE=1` 启动，应用会自动：
1. 等待游戏挂载 → 读取页面内部状态（游戏列表 / tab 数 / canvas 数 / 状态栏文案）
2. 切到象棋 tab 截图
3. 切回五子棋 → 在天元落子 → 等 1.5s → 检查 AI 是否落子
4. 截图保存到 `GLASS_SMOKE_DIR`，**必须是 Windows 真实路径**（`/tmp` 会被解析成 `D:\tmp` 而失败）
5. 自动退出

```bash
# 绿色版冒烟（推荐路径写法）
mkdir C:\Users\admin\AppData\Local\Temp\glass-smoke
cd "dist/摸鱼玻璃小局"
set GLASS_SMOKE=1
set GLASS_SMOKE_DIR=C:\Users\admin\AppData\Local\Temp\glass-smoke
摸鱼玻璃小局.exe
```

**最新一次冒烟真实输出**（2026-09-02 绿色版）：
```
[SMOKE] gomoku   {"games":"gomoku,xiangqi","active":"gomoku","tabs":2,"canvas":1,"status":"你执黑先行，点棋盘落子"}
[SMOKE] xiangqi  {"games":"gomoku,xiangqi","active":"xiangqi","tabs":2,"canvas":1,"status":"你执红先行，点棋子再点落点"}
[SMOKE] gomoku click=clicked
[SMOKE] after-move status=轮到你（黑）                  ← AI 落子并交回控制权
[SMOKE] alpha=0 status=轮到你（黑）                      ← 滑块 0%，棋子变淡
[SMOKE] undo status=已悔棋到开局，点棋盘落子             ← 悔棋清空
[SMOKE] ghost card-class=ghost faded
[SMOKE] ghost card-opacity=0.035                       ← 幽灵模式极限隐身生效
```

截图见 `docs/screenshots/`：
- `01-五子棋-空盘.png`（默认 45% 透明 + 45% 墨色，棋盘线 20% 浅灰、棋子柔和中灰）
- `02-象棋-32子.png`（默认 45% 透明 + 45% 墨色，红子是低饱和砖粉，黑子是灰蓝，不再是鲜红/近黑）
- `03-五子棋-落子后AI回应.png`（关键：玩家黑子 + AI 白子同时存在，状态栏"轮到你（黑）"）
- `04-五子棋-滑块0%棋子隐形.png`（透明滑块拉到 0%，棋子淡到几乎不可见，棋盘线几乎无）
- `05-悔棋后空盘.png`（点「悔棋」撤销玩家+AI 两步，棋盘完全清空，状态栏"已悔棋到开局"）
- `06-幽灵模式摸鱼档.png`（0% + 幽灵 + 移开，opacity 3.5%，只剩 5 个星位残影）
- `07-墨色0%全灰实体.png`（玻璃拉满 100% 实体 + 墨色 0%，棋子全部浅灰环，颜色对比度归零）
- `08-象棋-空心棋子-棋盘线穿透.png`（象棋底座完全透明，棋盘线穿过棋子内部）

## UI 透明度联动（v3 升级）

为解决"按钮和棋子太显眼"，所有 UI 元素颜色都通过 CSS 变量联动 `--glass-alpha`：

| 元素 | 65% 时 | 0% 时 |
|---|---|---|
| 玻璃面板 | 淡雅半透 | 几乎隐形 |
| 棋子 | 实体可见 | 几乎隐形 |
| 顶栏/工具条按钮背景 | 浅灰 | 几乎不可见 |
| 非激活按钮文字 | 36% 透明黑 | 12% 透明黑 |
| 激活按钮 | 浅蓝字 + 浅蓝底 | 几乎隐形 |
| 标题栏 logo | 浅蓝渐变 | 几乎不可见 |

`renderer/glass.css` 中的 `--ui-bg / --ui-text / --ui-text-dim / --ui-active-bg / --ui-active-text / --ui-logo-from/to` 都是 `calc(… * var(--glass-alpha))` 表达式。

## 棋盘抖动修复（v3）

**根因**：状态栏文字切换（"你执黑先行"→"AI 思考中…"→"轮到你（黑）"）撑高几像素 → stage flex 高度变小 → ResizeObserver 触发 layout → `canvas.width = …` 赋值即清屏 → 重画。

**修复**：
- `#statusbar` 固定 `height: 22px` + `overflow: hidden`，文字变化不撑开 stage
- `layout()` 加 **2px 尺寸阈值**：尺寸变化小于 2px 时只 `setTransform` + `draw`，不重设 `canvas.width`（避免清屏）

> 截图里背景发黑是透明窗口截图时桌面区域为空，**实际运行透出的是你的桌面壁纸**。

