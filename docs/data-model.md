# OneLineEditor 数据模型设计

> 一次系统图的 JSON 表达。**对 LLM 友好**与**支撑在线编辑器**双重约束下的折衷方案。

最后更新：2026-05-06

---

## 0. 设计张力

| 关注 | LLM 想要 | 编辑器想要 |
|---|---|---|
| 结构 | 稀疏、内联、就地可读 | 归一化、按 ID 索引、可打 patch |
| 引用 | 字符串名（`QF1.b`）、零样板 | 稳定 ID、整型偏移 |
| 语义 | 写"什么连什么"，不写"节点 n3" | 显式 ConnectivityNode、显式 wire path |
| 坐标 | 不写最好，写也只写关键的 | 全量坐标，渲染要用 |
| 默认值 | 全部省略，看库 | 解析后展开，渲染要用 |
| 错误 | 自然语言定位 | 字段路径定位 |

设计目标：**JSON 文件是单一事实源**——既是 LLM 的输入/输出，也是编辑器的存档；中间态归一化到运行时模型由 compiler 完成。

不变量：

1. JSON 是面向"作者"（人或 LLM）的语言，**接近"我想表达什么"**，远离"渲染需要什么"。
2. 编辑器把 JSON 编译成内部模型；导出时再序列化回 JSON，往返保真（不丢字段、不无端打乱、不写编译产物回去）。
3. 一切电气连通性通过 `connections` 的并查集隐式表达；wire 仅是视觉路径。

---

## 1. 顶层结构（DiagramFile）

```jsonc
{
  "version": "1",
  "meta": {
    "title": "220kV典型变电站",
    "description": "1#主变 + 双母线接线",
    "author": "...",
    "createdAt": "2026-05-06T10:00:00Z",
    "updatedAt": "2026-05-06T10:00:00Z"
  },

  // 设备实例：一切可见物（含母线、接地、注释）
  "elements": [ /* Element[] */ ],

  // 电气连通性：n-元组并查集，每行 = "这些端子在同一电气节点上"
  "connections": [ /* TerminalRef[][] */ ],

  // 视觉布局：可选 + 稀疏，缺位由 auto-layout 填充
  "layout": { /* Record<ElementId, Placement> */ },

  // 视觉走线：可选，覆盖默认正交路由
  "routes": { /* Record<NodeId, Route> */ },

  // 为 v1+ 多图预留；v0 只用顶层 elements/connections/layout
  "diagrams": []
}
```

只有 `version` 和 `elements` 是必需的；其他全部可选。

---

## 2. Element：库引用 + 实例参数

每个设备实例由"库种类（`kind`）+ 实例字段"构成。库定义引脚名、默认参数、SVG 模板和语义；JSON 里**绝不**内联 SVG。

```jsonc
{
  "id": "QF1",                     // 人可读 ID，全局唯一
  "kind": "breaker",               // 引用库种类
  "name": "201",                   // 显示名（可省，默认= id）
  "note": "出线断路器，2024-Q3 更换",  // 自由文本，LLM 上下文
  "params": { "Un": 220, "In": 2000 }, // 仅写覆盖默认的字段
  "open": false                    // 部分种类才有的状态简写
}
```

### 2.1 端子寻址：`<id>.<pin>`

端子通过点号语法字符串引用：

- `QF1.a` / `QF1.b`：双端口设备的两端
- `T1.hv` / `T1.lv`：双绕组变压器
- `T2.hv` / `T2.mv` / `T2.lv`：三绕组变压器
- `GND1.t`：单端设备
- `B1.tap`：母线（虚拟"任何一处"端子，见 §4）

引脚名由库定义；编译期校验。**不允许引用不存在的引脚**。

### 2.2 内置 `kind` 清单（v0）

| 类别 | kind | 引脚 | 状态字段 |
|---|---|---|---|
| 母线/接地 | `bus` | `tap`（多挂接） | — |
|  | `earth` | `t` | — |
| 开关 | `breaker` | `a`, `b` | `open: bool` |
|  | `disconnector` | `a`, `b` | `open: bool` |
|  | `earth_switch` | `a`, `b` | `open: bool` |
|  | `load_switch` | `a`, `b` | `open: bool` |
|  | `fuse` | `a`, `b` | `blown: bool` |
| 变压器 | `transformer2w` | `hv`, `lv` | — |
|  | `transformer3w` | `hv`, `mv`, `lv` | — |
|  | `autotransformer` | `hv`, `lv`, `tap` | — |
| 互感器 | `ct` | `p1`, `p2` | — |
|  | `vt` | `p`, `n` | — |
| 源/负荷 | `generator` | `t` | — |
|  | `sync_motor` | `t` | — |
|  | `induction_motor` | `t` | — |
|  | `infinite_bus` | `t` | — |
|  | `load` | `t` | — |
|  | `battery` | `t` | — |
| 无功/保护 | `shunt_reactor` | `t` | — |
|  | `series_reactor` | `a`, `b` | — |
|  | `shunt_capacitor` | `t` | — |
|  | `surge_arrester` | `t` | — |
| 标注 | `note` | — | — |
|  | `label` | — | — |

**为什么内置 kind 是字符串而不是 enum？** LLM 写 `"breaker"` 比写 `"BREAKER_1"` 自然；新增 kind 不破坏旧文件；shadcn 的设计语言一致。

### 2.3 自定义/扩展元件（v1+）

```jsonc
{ "id": "X1", "kind": "custom", "libraryRef": "user/contactor_3p", "params": {} }
```

`libraryRef` 指向库管理器中的条目；JSON 文件本身不携带 SVG。

---

## 3. Connection：n-元组并查集

电气连通性是图中最容易让 LLM 写错的部分。设计上做两个让步：

### 3.1 不要求 LLM 命名 ConnectivityNode

LLM 写：

```jsonc
"connections": [
  ["QF1.b", "T1.hv"],
  ["T1.lv", "GND1.t"]
]
```

不需要写 `{id: "n1", terminals: [...]}`。Compiler 用并查集（Union-Find）把所有共享端子的连接合并成 ConnectivityNode，并自动分配稳定 ID（`n1, n2, ...`，按首次出现顺序）。

### 3.2 n-元组而不是只有"边"

一行可以是任意元数：

```jsonc
"connections": [
  ["QF1.b", "QF2.b", "T1.hv"]   // 三个端子在同一节点上
]
```

这等价于三条二元连接，但更紧凑、语义更直接（"这三个连一起"）。

### 3.3 传递性自动合并

```jsonc
"connections": [
  ["QF1.b", "T1.hv"],
  ["QF1.b", "T2.hv"]    // 共享 QF1.b
]
// 编译后：{ QF1.b, T1.hv, T2.hv } 都在同一节点
```

LLM 不需要"重写其中一行"来表达合并，**写多了不会错**，**写顺序无关**——这是对 LLM 的关键友好。

### 3.4 显式节点（仅当需要标注）

罕见情况下需要给节点起名（如挂量测、加注释）：

```jsonc
"connections": [
  { "node": "n_main", "terminals": ["QF1.b", "T1.hv"], "name": "主变高压侧" }
]
```

Compiler 把命名节点和匿名连接统一处理；命名节点保留其名字。

### 3.5 接地的两种写法

显式：

```jsonc
"elements": [{ "id": "GND1", "kind": "earth" }],
"connections": [["T1.lv", "GND1.t"]]
```

简写（v1+，编辑器隐式补一个 earth 元件）：

```jsonc
"connections": [["T1.lv", "@earth"]]
```

v0 只支持显式。

---

## 4. Bus：把"母线"压进同一抽象

母线在电气上是一个 ConnectivityNode；在视觉上是一根可拉伸的线，沿线分布多个挂接点。

设计：**Bus 是普通 Element，引脚只有 `tap`，但 `tap` 在 connections 里可以出现多次**——并查集会把所有 `B1.tap` 引用合并到同一节点上。

```jsonc
{ "id": "B1", "kind": "bus", "name": "220kV-I", "params": { "Un": 220 } }

"connections": [
  ["B1.tap", "QS1.a"],
  ["B1.tap", "QS3.a"],
  ["B1.tap", "QS5.a"]
]
```

**便捷糖**：在 Bus 元件上写 `tap` 数组，等价于上面三行：

```jsonc
{
  "id": "B1", "kind": "bus", "name": "220kV-I",
  "tap": ["QS1.a", "QS3.a", "QS5.a"]   // = 三条连接的简写
}
```

`tap` 字段还指示**视觉挂接顺序**（左到右）；auto-layout 用它给母线定方向、给设备排版面。

> 数据模型上 Bus 没有特殊待遇，渲染层才有特殊待遇——这正是我们想要的。

---

## 5. Layout：可选 + 稀疏 + 自动补齐

```jsonc
"layout": {
  "B1": { "at": [200, 100], "rot": 0, "span": 600 },
  "QF1": { "at": [300, 200] }
  // 其余元件未列出 → auto-layout 自动放置
}
```

| 字段 | 说明 |
|---|---|
| `at: [x, y]` | 元件 hotspot 在画布上的坐标 |
| `rot: 0\|90\|180\|270` | 90° 步进旋转，默认 0 |
| `mirror: bool` | 镜像，默认 false |
| `span: number` | 仅 `bus` 等可拉伸元件，单位与坐标一致 |

**LLM 可以完全省略 `layout`**——拿一个空 layout 给编辑器，编辑器自动布局；用户拖一下，layout 填上对应元件的坐标。

### 5.1 Auto-layout 策略（v0）

- 按 `connections` 构建邻接图，做拓扑排序
- 母线优先：`bus` 元件水平摆放，按 `tap` 顺序在其下方均匀分布相连设备
- 串联设备链按拓扑顺序竖直摆放
- 网格吸附（默认 10px）

不追求美观，只保证"能看"。手动微调后由 `layout` 字段覆盖。

---

## 6. Routes：视觉走线（可选）

```jsonc
"routes": {
  "n3": { "path": [[100,200],[150,200],[150,260]], "manual": true }
}
```

- `routes[nodeId]` 缺失 → 编译期自动正交布线
- `manual: true` 表示用户手动编辑过，序列化时保留
- 节点 ID 要么是用户命名（`n_main`），要么是 compiler 生成的稳定 ID（按 connections 出现顺序）

**保真问题**：compiler 生成的节点 ID 在你*重新编辑* `connections` 后可能漂移。对策：序列化前做一次"节点 ID 稳定化"——根据节点内端子集合计算 hash，只要端子集合不变 ID 就不变。详见 §10。

---

## 7. TypeScript 类型

```ts
// ===== 顶层 =====
export type DiagramFile = {
  version: "1";
  meta?: Meta;
  elements: Element[];
  connections?: Connection[];
  layout?: Record<ElementId, Placement>;
  routes?: Record<NodeId, Route>;
  diagrams?: SubDiagram[]; // v1+
};

export type Meta = {
  title?: string;
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
};

// ===== ID & Ref =====
export type ElementId = string;             // "QF1"
export type PinName = string;               // "a" | "b" | "hv" | ...
export type TerminalRef = `${ElementId}.${PinName}`;
export type NodeId = string;                // "n1", "n_main"

// ===== Element =====
type ElementCommon = {
  id: ElementId;
  name?: string;
  note?: string;
  params?: Record<string, number | string | boolean>;
};

export type Element =
  | (ElementCommon & { kind: "bus"; tap?: TerminalRef[] })
  | (ElementCommon & { kind: "earth" })
  | (ElementCommon & { kind: "breaker"; open?: boolean })
  | (ElementCommon & { kind: "disconnector"; open?: boolean })
  | (ElementCommon & { kind: "earth_switch"; open?: boolean })
  | (ElementCommon & { kind: "load_switch"; open?: boolean })
  | (ElementCommon & { kind: "fuse"; blown?: boolean })
  | (ElementCommon & { kind: "transformer2w" })
  | (ElementCommon & { kind: "transformer3w" })
  | (ElementCommon & { kind: "autotransformer" })
  | (ElementCommon & { kind: "ct" })
  | (ElementCommon & { kind: "vt" })
  | (ElementCommon & { kind: "generator" })
  | (ElementCommon & { kind: "sync_motor" })
  | (ElementCommon & { kind: "induction_motor" })
  | (ElementCommon & { kind: "infinite_bus" })
  | (ElementCommon & { kind: "load" })
  | (ElementCommon & { kind: "battery" })
  | (ElementCommon & { kind: "shunt_reactor" })
  | (ElementCommon & { kind: "series_reactor" })
  | (ElementCommon & { kind: "shunt_capacitor" })
  | (ElementCommon & { kind: "surge_arrester" })
  | (ElementCommon & { kind: "note"; text: string })
  | (ElementCommon & { kind: "label"; text: string })
  | (ElementCommon & { kind: "custom"; libraryRef: string });

// ===== Connection =====
export type Connection =
  | TerminalRef[]
  | { node?: NodeId; name?: string; terminals: TerminalRef[] };

// ===== Layout =====
export type Placement = {
  at: [number, number];
  rot?: 0 | 90 | 180 | 270;
  mirror?: boolean;
  span?: number;
};

// ===== Route =====
export type Route = {
  path: [number, number][];
  manual?: boolean;
};
```

---

## 8. 编译流水线

```
DiagramFile (JSON)
    │
    ▼
┌──────────────────────────────────┐
│ 1. Parse + Schema 校验          │
│   - 字段类型/必填                 │
│   - 未知字段保留（往返保真）       │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│ 2. 引用校验                      │
│   - element id 唯一               │
│   - terminalRef 元件存在 + 引脚存在│
│   - layout key 引用真元件          │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│ 3. 库展开                        │
│   - kind → 引脚清单/默认参数/SVG  │
│   - params 与库 schema 校验        │
│   - 用户自定义元件加载             │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│ 4. ConnectivityNode 计算         │
│   - bus.tap → 等价连接展开        │
│   - 并查集合并所有 connections    │
│   - 稳定 ID（端子集合 hash）       │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│ 5. Layout 补齐                   │
│   - 缺失元件 → auto-layout        │
│   - 端子坐标 = 库 localPos 经     │
│     旋转/镜像/平移变换             │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│ 6. Route 补齐                    │
│   - 缺失节点 → 正交布线           │
│   - 手动 path 原样保留             │
└──────────────────────────────────┘
    │
    ▼
InternalModel（Zustand store）
    │
    ▼ （编辑变更）
    │
    ▼
┌──────────────────────────────────┐
│ Serializer                       │
│   - 剔除编译产物                  │
│   - 默认参数省略                  │
│   - 字段顺序稳定（diff 友好）     │
│   - 未知字段原样回写              │
└──────────────────────────────────┘
    │
    ▼
DiagramFile (JSON)
```

### 8.1 InternalModel（运行时）

不直接序列化的中间态，按 ID 索引：

```ts
type InternalModel = {
  elements: Map<ElementId, ResolvedElement>;
  terminals: Map<TerminalRef, TerminalGeometry>;
  nodes: Map<NodeId, ConnectivityNode>;
  layout: Map<ElementId, Placement>;
  routes: Map<NodeId, Route>;

  // 反向索引
  terminalToNode: Map<TerminalRef, NodeId>;
  elementToTerminals: Map<ElementId, TerminalRef[]>;
};

type ResolvedElement = Element & { libraryDef: LibraryDef };
type ConnectivityNode = { id: NodeId; name?: string; terminals: Set<TerminalRef> };
```

每次画布操作 → 派发 Action → reducer 更新 InternalModel + 同步局部更新 DiagramFile。**DiagramFile 始终是 source of truth**——撤销/重做基于 DiagramFile 的 patch 栈，能省内存且天然保证 round-trip 一致。

---

## 9. 校验规则（compile error）

错误信息要让人和 LLM 都能定位：

| 错误码 | 信息模板 |
|---|---|
| `E001` | `元件 ID 重复："${id}"（出现于 elements[${i}], elements[${j}]）` |
| `E002` | `connections[${i}] 引用了不存在的元件 "${ref.elementId}"` |
| `E003` | `元件 "${id}" (kind=${kind}) 没有引脚 "${pin}"，可用引脚：${available.join(", ")}` |
| `E004` | `layout key "${id}" 引用了不存在的元件` |
| `E005` | `params "${field}" 类型错误：期望 ${expected}, 实际 ${actual}` |
| `W001` | `元件 "${id}" 没有任何连接（孤立元件）` |
| `W002` | `connections[${i}] 只包含一个端子（无效连接，已忽略）` |

报告里附 JSON Pointer 路径（如 `/connections/3/1`），编辑器侧能一键定位。

---

## 10. 序列化与往返保真

### 10.1 字段顺序

序列化产出固定顺序：`version → meta → elements → connections → layout → routes`。`elements[]` 内：`id → kind → name → note → params → 状态字段 → tap`。便于 git diff 和人眼审。

### 10.2 默认值省略

- `rot: 0` 不写；`mirror: false` 不写
- `params` 中等于库默认值的字段不写
- 空 `meta`、空 `layout`、空 `routes` 整体省略

### 10.3 节点 ID 稳定化

Compiler 生成的 NodeId 默认是 `n${hash(sorted_terminals)}`，端子集合不变 ID 就不变；用户给的命名节点保留原名。**仅当**用户引用过节点（在 `routes` 或 `connections.node` 字段里），节点 ID 才会序列化；否则匿名节点不写出。

### 10.4 未知字段保留

为了未来兼容，所有未识别的字段在 InternalModel 上挂一个 `__extra` 影子区域，序列化时原样写回。

### 10.5 import → export 不变性测试

```
identity(json) := serialize(compile(json))
对所有合法 json：normalize(json) === normalize(identity(json))
```

normalize = 默认值省略 + 字段排序。CI 里跑一组 fixtures 保证。

---

## 11. 完整示例

### 11.1 最小可运行：单台变压器接地

```json
{
  "version": "1",
  "elements": [
    { "id": "T1", "kind": "transformer2w", "name": "1#主变" },
    { "id": "GND1", "kind": "earth" }
  ],
  "connections": [
    ["T1.lv", "GND1.t"]
  ]
}
```

### 11.2 单母线接线（一进两出）

```json
{
  "version": "1",
  "meta": { "title": "10kV 单母线" },
  "elements": [
    { "id": "B1", "kind": "bus", "name": "10kV-I", "params": { "Un": 10 },
      "tap": ["QS_in.b", "QF1.a", "QF2.a"] },

    { "id": "L_in",   "kind": "infinite_bus", "name": "进线" },
    { "id": "QS_in",  "kind": "disconnector", "name": "01" },

    { "id": "QF1", "kind": "breaker",       "name": "101" },
    { "id": "QS1", "kind": "disconnector",  "name": "101-1" },
    { "id": "L1",  "kind": "load",          "name": "馈线1" },

    { "id": "QF2", "kind": "breaker",       "name": "102" },
    { "id": "QS2", "kind": "disconnector",  "name": "102-1" },
    { "id": "L2",  "kind": "load",          "name": "馈线2" }
  ],
  "connections": [
    ["L_in.t", "QS_in.a"],
    ["QF1.b", "QS1.a"], ["QS1.b", "L1.t"],
    ["QF2.b", "QS2.a"], ["QS2.b", "L2.t"]
  ]
}
```

注：母线的三处挂接通过 `B1.tap` 简写表达，不需要重复写在 `connections` 中。

### 11.3 完整一点：220kV 双母线 + 主变

```json
{
  "version": "1",
  "meta": { "title": "220kV 双母线 + 1#主变 240MVA" },
  "elements": [
    { "id": "BI",  "kind": "bus", "name": "220kV-I",  "params": {"Un": 220},
      "tap": ["QS_LI.b", "QS_T1.b"] },
    { "id": "BII", "kind": "bus", "name": "220kV-II", "params": {"Un": 220},
      "tap": ["QS_LII.b"] },

    { "id": "L1",     "kind": "infinite_bus",  "name": "线路1" },
    { "id": "QS_L1",  "kind": "disconnector",  "name": "L1-0" },
    { "id": "QF_L1",  "kind": "breaker",       "name": "L1-Q" },
    { "id": "QS_LI",  "kind": "disconnector",  "name": "L1-1" },
    { "id": "QS_LII", "kind": "disconnector",  "name": "L1-2", "open": true },

    { "id": "QS_T1",  "kind": "disconnector",  "name": "T1-1" },
    { "id": "QF_T1",  "kind": "breaker",       "name": "T1-Q" },
    { "id": "T1",     "kind": "transformer2w", "name": "1#主变",
      "params": { "S": 240, "ratio": "220/110" } },
    { "id": "GND_T1", "kind": "earth" }
  ],
  "connections": [
    ["L1.t", "QS_L1.a"],
    ["QS_L1.b", "QF_L1.a"],
    ["QF_L1.b", "QS_LI.a", "QS_LII.a"],

    ["QS_T1.a", "QF_T1.b"],
    ["QF_T1.a", "T1.hv"],
    ["T1.lv", "GND_T1.t"]
  ]
}
```

观察：

- 进线后的 `QF_L1.b` 同时连接 `QS_LI.a` 和 `QS_LII.a`，写成一个三元组——这是双母线进线的"母联前端"语义，并查集会把它视作一个节点。
- `QS_LII.open: true` 表示该刀闸断开，但**电气拓扑仍把两侧端子归为同一节点**。状态只影响潮流/着色，不改变拓扑。这一原则与 IEC 61970 一致。
- 没有写 `layout`，全部交给 auto-layout。

---

## 12. 与 PRD §6 草案的差异

| PRD §6.2 草案 | 本设计 | 理由 |
|---|---|---|
| 顶层独立 `terminals` 数组 | 端子内联在元件库定义，引用用 `<id>.<pin>` 字符串 | 减少 LLM 需要维护的索引 |
| 顶层独立 `connectivityNodes` 数组 | `connections` 并查集 → 编译期生成 nodes | LLM 不必命名节点；写多次自动合并 |
| `wires[].path` 与 ConnectivityNode 强绑定 | `routes[nodeId]` 可选，默认 auto-route | 解耦；视觉变更不污染拓扑 |
| `diagram.objects` 嵌套 | 顶层 `layout` 平铺 | 减少嵌套层级，diff 友好 |
| `state` 嵌套对象 | `open`/`blown` 等扁平布尔 | 写起来短，常见状态优先 |

§6.3 的四条核心原则**全部保留**：

1. ✅ Terminal 是一等公民（通过 `id.pin` 字符串）
2. ✅ ConnectivityNode 显式建模（编译后显式）
3. ✅ 拓扑与图形 1:N 分离（`elements/connections` vs `layout/routes`）
4. ✅ ID 用人可读字符串

---

## 13. 演进路线

### v0（当前）

- 单图、扁平 elements/connections/layout
- 内置 kind 库
- auto-layout 简易实现
- 序列化往返保真测试

### v1

- 模板/宏：`{ "use": "single_bus", "feeders": [...] }` 编译期展开
- 多图（`diagrams: SubDiagram[]`），同一拓扑多视图
- `@earth` 简写
- 用户自定义元件库（`kind: "custom"`）
- JSON Schema 文件（IDE 补全 + LLM 系统提示）

### v2+

- 命名空间 / 子图组合（substation → feeder → bay）
- 状态层独立（量测、告警绑定）
- 协作/版本（CRDT，复用现有 patch 模型）

---

## 附录 A：JSON Schema 提供方式

`schema/oneline-v1.schema.json` 在 v1 阶段产出，支持：

- VS Code / Cursor 等 IDE 自动补全
- 作为 LLM 系统提示的一部分（**显著提升 LLM 输出合法率**）
- CLI 校验：`oneline validate diagram.json`

## 附录 B：LLM 提示工程要点

为最大化 LLM 写得对的概率，系统提示中包含：

1. 内置 kind 表（§2.2）
2. 引脚清单（不要让 LLM 猜引脚名）
3. "用 `connections` 的 n-元组隐式表达连通性，不要发明节点 ID" 的明确指令
4. "省略 `layout` 让编辑器自动布局" 的指令
5. 1-2 个完整示例（§11）

不要让 LLM 写 SVG、写坐标、写 ConnectivityNode ID——这些都是它最容易翻车的地方。
