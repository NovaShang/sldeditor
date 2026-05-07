# OneLineEditor 编辑器 UI 设计

> Figma vibe + 数据模型驱动的交互。
>
> 与 PRD §5（已定的总体布局/工具/键位）互补：本文专注**视觉基线**、**与数据模型对齐的交互细节**、**暗黑模式**、以及连通性可视化。

最后更新：2026-05-07

---

## 0. 设计原则（vibe 三句话）

1. **画布安静，外壳浮起**——主舞台只有线和被选中的蓝；所有 chrome（工具条/面板/视图工具）都是带 backdrop-blur 的玻璃浮层。
2. **直接操纵优先于面板操作**——能在画布上完成的事不进面板：开关在画布上点一下就开/合，端子拖出就连线，母线拖端点就拉伸。
3. **数据模型在哪里有"歧义"，UI 就在那里给出可视化**——并查集合并？hover 高亮全节点。Layout 是 auto 还是 manual？badge 区分。Routes 是否被手动改过？图标提示。

---

## 1. 视觉基线

| 维度 | 选择 |
|---|---|
| 主调（亮） | 浅灰底（`bg-background` ≈ #FAFAFA），画布纯白 |
| 主调（暗） | 接近 #1F1F1F 的中性灰，画布略浅以保持元件描边可见 |
| 强调色 | Figma blue：`#0D99FF`（选中、连线进行中、悬停高亮）；亮暗模式下保持同色相 |
| 次强调 | `#7C3AED`（紫，仅用于"手动覆盖"标记，少量） |
| 危险 | `#EF4444`（仅用于校验错误） |
| 字体 | Inter（UI），JetBrains Mono（ID/坐标读出） |
| 字号 | UI 12px / 标题 11px uppercase + tracking / 标签 10px |
| 圆角 | 浮层 12px，按钮 8px，输入 6px |
| 阴影 | 浮层 `shadow-sm`，悬停 `shadow-md`；不要重阴影 |
| 玻璃 | `backdrop-blur-md` + 半透明卡片底；`ole-glass` 类直接用 |
| 动效 | 150ms `cubic-bezier(0.2, 0, 0, 1)`；只动透明度/位移/缩放，不动尺寸 |
| 网格 | 默认 10px 浅灰点阵；缩放档位变化时换大小（避免极密/极稀） |
| 选中 | 2px `#0D99FF` 描边 + 1px 内描边；描边宽度 / scale，抗缩放 |

注：所有颜色 token 通过 CSS variables 暴露，不在 .tsx 里硬编码。亮/暗模式共享同一组 token 名，仅赋值不同。

---

## 2. 数据模型驱动的关键交互

> 这是和 PRD §5 的主要增量。每条都直接对应数据模型的一个设计决策。

### 2.1 端子是一等公民 → 端子可见可点

数据：`TerminalRef = "<elementId>.<pinName>"`，库定义 `terminals[].x/y/orientation`。

UI 表达：

- **默认**：端子不可见（画布安静）。
- **悬停元件**：所有端子淡入为 4px 灰圆。
- **悬停端子**：放大到 6px，描边 `#0D99FF`，光标变 crosshair；状态栏出现 `QF1.t1`（Figma 选中元素时左下角显示坐标的味道）。
- **Wire 工具激活**：所有端子永久 4px 可见（不需要悬停），鼓励连线。
- **未连接的端子** vs **已连接的端子**：未连接画空心圆，已连接画实心；一眼分辨"哪些还没接线"。

### 2.2 并查集连通性 → 同节点高亮 + 可选着色

数据：连通性由 `connections` 并查集生成 ConnectivityNode。一个节点 = 一组等价端子。

UI 表达三档：

1. **被动**：默认中性色，不可见的节点身份。
2. **悬停某端子/某段 wire**：全部该节点的端子和走线淡蓝高亮（200ms 渐入）。这就是 PRD §4.1 要的"连通性着色"的最低实现，**没有视觉污染**。
3. **主动**（顶部浮条上的 toggle "电气分组" 开关）：节点 ≥ 3 端子的高亮整段路径，用低饱和度 pastel（蓝/绿/橙/紫循环）。两端子节点保持中性色（绝大多数情况，强行染色没有信息量）。

为什么不全染色：Figma vibe 是"安静画布"，全节点染色更像 schematic capture 工具，过载。**信息量 ≠ 噪声**。

### 2.3 母线 tap → 沿母线任意位置插入挂接

数据：`Bus.tap?: TerminalRef[]`，多次引用 `B1.tap` 自动合并到同一节点。库里 busbar 是 stretchable line。

UI 表达：

- 选中 Wire 工具悬停母线时，母线沿线出现一条**幽灵 tap 提示线**（细蓝），指针处显示 `+` 标记，提示"在此处挂接"。
- 单击 → 起始 tap 点，被吸附到母线最近的网格点；继续移动 → 终点端子；再次单击完成。
- 拖一个元件**经过母线**：母线高亮，元件最近的一个端子被吸附"贴到"母线上；松手 → 自动加一条 `connections: [["B1.tap", "QF1.t1"]]`，**不需要用 Wire 工具**。
- 母线两端有 stretch handle（圆 + 双向箭头），拖动改 `Placement.span`；已挂接的 tap 沿母线按 `tap` 数组比例分布。

### 2.4 稀疏 layout → "Auto" 徽章

数据：`layout` 缺位 → auto-layout 填充。

UI 表达：

- 元件没在 `layout` 里出现过 → 选中时右侧属性面板的"位置"分组显示 `Auto-placed`（紫色细 chip），`x`/`y` 字段灰显。
- 一旦用户拖一下 → 立刻写入 `layout[id]`，chip 消失。
- 顶部菜单：`视图 → 重新布局所有 Auto 元件`（保留手动放置的不动）。这个菜单项只有当存在 auto 元件时才可点。

### 2.5 Routes 手动覆盖 → 拐点拖动 + manual 标记

数据：`routes[nodeId].manual?: boolean`，缺位 → 自动正交布线。

UI 表达：

- 选中一段 wire（其实是选中其 ConnectivityNode），中点和拐点出现可拖动的 small handle。
- 一旦用户拖动任一 handle → `routes[nodeId].path` 写入用户路径，`manual: true`，UI 在 wire 旁出现紫色细圆点标记（"手动"）。
- 右键 wire → `重置为自动布线` 一项，撤销手动标记。
- 这个紫色点只出现在选中态，平时不打扰。

### 2.6 状态糖（open/blown）→ 画布直接切换

数据：`Element.open?: boolean`、`Element.blown?: boolean`。

UI 表达：

- **不在画布上为开关多画一个按钮**——直接点击元件本体（在 Select 工具下，已选中状态时双击）。
- 视觉变化由库 SVG 控制：开关 SVG 提供 `open=true/false` 两种 path，编辑器在 render 时根据 `Element.open` 选用。
- 右侧属性面板有显式 toggle，多选时变成"分开/合上 全部"。
- **状态翻转不影响电气拓扑**：分闸的隔离开关两侧端子仍属同一 ConnectivityNode（与 IEC 61970 一致；将来拓扑分析才会"切开"）。这一点要在属性面板状态字段下方放一行小字提示，避免新人困惑。

### 2.7 元件库 → 拖放 + 键盘放置

数据：`Element.kind` 必须是 `LibraryEntry.id`，每个库符号是 `src/element-library/<id>.json` 一个文件，前端通过 `import.meta.glob('./*.json')` 自动发现。

UI 表达：

- 左侧元件库面板：折叠分组，分组下用**单列横排行**：定高定宽的图标盒（48×28，`preserveAspectRatio="xMidYMid meet"`，**不形变**）+ 右侧名字。分组顺序由内置元数据控制（busbar / switching / transformer / instrument-transformer / source / load / compensation / protection）。
- 不用 grid：电气符号宽高比差异极大（busbar 84:8 vs transformer 64:144），grid 会强行塞进方框毁掉形态识别。横排行让窄高、宽矮、近方各自按比例呈现。
- **拖放**：从 palette 拖到画布，ghost = 实际 SVG（半透明 50%），跟随光标；放下时**对齐到网格 + 自动选中**。
- **键盘放置**（Place 工具）：`P` 激活，`↑/↓` 切换当前 kind，单击连续放置；`Esc` 退出。
- **没有命令面板**——v0 显式不做（见 §6）。

### 2.8 大纲（左下） → 反向定位 + 内联重命名

数据：`elements[]`，每个有 `id`、可选 `name`、可选 `note`。

UI 表达：

- 列表按 `category` 分组（来自库），同组内按 `id` 排序。
- 行格式：`[icon] {name || id}` + 右侧灰显 `{id}`（双重显示，name 是给人看的，id 是给 LLM 看的）。
- 单击 → 选中元件并把视口 pan/zoom 到合适位置（**不强行 zoom-to-fit**，只在元件不在视口时才移动）。
- 双击 name → inline rename（编辑 `name` 字段）；按 `F2` 同效果。
- 右键 → 删除 / 复制 ID / 跳转到画布。
- 顶部搜索：按 id 或 name 模糊。

### 2.9 属性面板（右） → 跟随选区，按数据 schema 自动生成

数据：每个 `kind` 在库里定义默认参数集合；`Element.params` 只存覆盖默认值的字段。

UI 表达，分组从上到下：

| 分组 | 字段 | 来源 |
|---|---|---|
| **身份** | id（只读、可复制）/ name（inline）/ note（textarea） | `Element.id/name/note` |
| **类型** | kind 显示为图标 + 名（不可改；改 kind 通过"替换为..."操作） | `Element.kind` |
| **参数** | 字段从库 schema 动态生成（数字/字符串/枚举）；占位符为默认值 | `Element.params` |
| **状态** | open / blown 等布尔（仅当 kind 适用时出现） | `Element.open` 等 |
| **位置** | x / y（数字输入）/ rot（4 个图标按钮）/ mirror（toggle）/ span（仅 stretchable） | `Placement` |
| **连接** | 该元件每个端子下方列出"→ {对端 ref / 节点名}"，点击跳转 | 反向索引 `terminalToNode` |

多选时：交集字段值；不一致字段显示`——多个值——`。提交时机见 PRD §5.5。

**不在属性面板里**的：颜色（库决定）、SVG path（不可改）、ConnectivityNode ID（除非用户主动命名）。

### 2.10 节点命名（罕见但要支持）

数据：`NamedConnection.node?: NodeId / .name?: string`。

UI 表达：

- 选中一段 wire（即一个节点）→ 属性面板出现"电气节点"分组（普通 wire 没有这一栏，避免噪声）。
- 默认显示 `自动节点 {n_xxx}`，下面有"命名此节点"按钮。
- 命名后 → JSON 中那条相关连接升级为 `NamedConnection` 形式；节点显式可被 `routes[nodeId]` 等引用。

---

## 3. 暗黑模式

### 3.1 总则

亮/暗用同一组 CSS variables，仅赋值不同。已经在 `src/styles.css` 里通过 `:root` 与 `.dark` 双声明分别赋值；切换通过给 `<html>` 加/去 `.dark` 类完成。

切换入口在顶部浮条最右侧（Sun / Moon 图标），状态持久化到 `localStorage['ole-theme']`。**默认跟随系统 `prefers-color-scheme`**，并持续监听 OS 切换；用户显式 toggle 后才"接管"，此后系统改动不再影响。

### 3.2 画布在暗黑下的注意

- 画布底色 ≠ 全黑，用接近 `oklch(0.18 0 0)` 的近黑灰，避免与电力符号的"黑底白线"传统视觉混淆。
- 网格点用更亮的灰 `oklch(0.25 0 0)`，保持轻微存在感。
- **元件 SVG 描边**目前来自 QElectroTech `.elmt`，硬编码 `stroke="black"`——暗黑下不可见。**渲染时 normalize**：渲染层把 `stroke="black"`（含大小写、`#000`、`#000000`、`rgb(0,0,0)` 等）替换为 `currentColor`，再让父元素 `color` 跟随主题（亮 → 黑，暗 → 接近白）。这一步在画布渲染层（v0 后续提交）做，不污染 JSON。
- 文字标签同理走 `currentColor`。

### 3.3 强调色与状态色

| 用途 | 亮 | 暗 |
|---|---|---|
| 选中描边 | `#0D99FF` | `#3BB0FF`（提亮 1 档，暗底下更跳） |
| Hover halo | 蓝 4px 模糊 18% | 蓝 4px 模糊 28%（暗底需要更高不透明度才能看见） |
| 手动覆盖紫 | `#7C3AED` | `#A78BFA`（提亮） |
| 错误红 | `#EF4444` | `#F87171` |
| 节点 pastel | 浅色 | 略提亮 + 略降饱和（避免 neon 感） |

### 3.4 玻璃面板

- 亮模式：`color-mix(card 80%, transparent)` + `backdrop-blur-md`
- 暗模式：同样配方，但 card 本身偏黑——视觉上是"半透明深色"

### 3.5 不做的事

- 不做"自动跟随系统"以外的更细粒度（比如夜间时段切换）。
- 不做明暗以外的第三主题（高对比模式之类，v1+）。
- 元件库 JSON 文件里的 `svg` 字段**不修改**；颜色 normalization 只发生在渲染管线，保持 JSON 与 QET 上游差异最小。

---

## 4. 选中、命中、悬停（细节）

| 状态 | 视觉 |
|---|---|
| Idle | 元件中性色，无 chrome |
| Hover element | 整体淡蓝 halo（4px 模糊） |
| Hover terminal | 端子放大 + crosshair，状态栏显示 `<id>.<pin>` |
| Hover wire | 该 ConnectivityNode 全部高亮淡蓝 |
| Selected single | 蓝描边 + 旋转 handle（顶部）+ 镜像 handle（侧）；属性面板亮起 |
| Selected multi | 同上，handle 在 bbox 上；属性面板字段交集 |
| Drag in progress | 元素半透明 80%；smart guides（红色 1px 线）出现于对齐时 |
| Wire drawing | 起点端子高亮，光标到候选终点之间画**临时正交折线**；候选终点用 12px 蓝光圈包围 |
| Connection conflict | wire 工具点了同一节点的两个端子 → 终点圈变橙，tooltip "已在同一节点" |
| Validation error | 错误元件描边变红 + 角上小红点 |

### 4.1 智能对齐线（Figma 招牌）

拖动元件时，**当前元件的 hotspot 与其他元件的 hotspot 处于同一垂直/水平线时，画一条 1px 红线 + 距离读数**。垂直/水平/中心三种对齐都做。这是 vibe 的关键，**不要省**。

吸附阈值：3px。

### 4.2 状态栏（左下角，可选）

10px 字号，玻璃浮条：`QF1.t1   x: 240, y: 180   节点 n3 (3 端子)   旋转 90°`。

只在 hover/选中时显示，平时收起。

---

## 5. 两个端到端关键交互流

### 5.1 从零画一张单母线（约 60 秒）

1. 打开 → 画布空，左侧元件库就绪。
2. 从元件库**拖** `母线段` 到画布 → 自动选中。
3. 拖右端 stretch handle → 拉到合适长度。
4. 从元件库拖三次 `断路器` 到母线上方 → 释放时自动 tap 到母线，端子均匀分布。
5. 按 `W` → wire 工具；从每个 breaker 下端子拉到一个 `负荷` → done。
6. `Cmd+S` → JSON 下载。

整个流程**没有打开过任何对话框**，没有右键菜单，没有"确认"按钮。

### 5.2 三端子合并到一个节点（教学示例）

用户演示如何让两条线合并：

1. 已有 `["QF1.t2", "T1.t1"]`。
2. 用 wire 工具从 `QF2.t2` 拖到 `T1.t1`（已经在节点上）。
3. 释放瞬间：`T1.t1` 短暂泛绿（"merged"动画 200ms），新连接出现，节点 hover 高亮范围扩展到 3 个端子。
4. 用户没看到任何 "ConnectivityNode" 字眼。**模型上发生了 union-find 合并；UI 只用一次绿色脉冲表达"合并了"**。

---

## 6. 不在 v0 范围

为了保 vibe 不"功能膨胀"，以下明确 v0 不做：

- **JSON 检视器抽屉**：v0 通过文件菜单导出/导入 JSON 即可；做内嵌实时同步抽屉性价比低
- **命令面板（Cmd+K）**：v0 直接拖放 + 工具按钮 + 快捷键够用，模糊匹配框收益不大
- **专业级渲染**：电压等级颜色、双线母线、复杂端子标号
- **图框 / 标题栏 / 图例**（v1）
- **协作光标 / 评论 / @ 提及**（v2+）
- **AI 内嵌对话窗口**（v1+）
- **移动/触屏手势**

---

## 7. 与现有代码的衔接

| 已有文件 | v0 改造方向 |
|---|---|
| `src/components/EditorShell.tsx` | 不变（左 + 中 + 右三栏框架） |
| `src/components/LeftPanel.tsx` | 把硬编码 `PALETTE_GROUPS` 换为读取 `import.meta.glob('../element-library/*.json')`；项数据来自 `LibraryEntry` |
| `src/components/RightPanel.tsx` | 写出 §2.9 的分组结构；空状态保留 |
| `src/components/FloatingToolbar.tsx` | 工具集已对齐 PRD §5.2，先做 `select / pan / wire / busbar / place` 五件套 |
| `src/components/TopBar.tsx` | 加暗黑模式切换、电气分组 toggle |
| `src/components/ViewToolbar.tsx` | 缩放百分比、网格、适配视图 |
| `src/components/CanvasPlaceholder.tsx` | 替换为 `<CanvasSvg>`，承载渲染层；渲染时把 SVG 描边 normalize 为 `currentColor` |
| 新增 | `src/canvas/` —— SVG 渲染、命中、工具系统；`src/store/` —— Zustand store；`src/compiler/` —— DiagramFile ↔ InternalModel；`src/hooks/use-theme.ts` —— 暗黑模式 |

---

## 8. 一句话设计宣言

> **画布像 Figma，数据像 CIM，主题随手切。** 各做对，不打架。
