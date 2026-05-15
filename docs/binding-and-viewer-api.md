# OneLineEditor 数据绑定 + Viewer API 设计

> 把 SLD 编辑器从「设计时画图」延展到「运行时数据可视化」, 同时保持组件本身**不**变成完整 SCADA 平台。

最后更新: 2026-05-09

---

## 0. 设计目标

把组件拆成两端:

- **`<OneLineEditor />`** — 设计时, 现状基础上增加绑定/槽位作者面板
- **`<OneLineViewer />`** — 运行时, 只读, 接收 host 提供的数据源 + 自定义槽位

服务对象:

1. 第一方: voltreality 等自家产品, 拿 viewer 嵌运维仪表盘
2. 第二方: 任何想做轻量 SCADA / DER dashboard / IIoT HMI 的 React 应用

设计原则 (不可妥协):

1. **编辑器不持有数据源**。所有 tag 取值由 host 通过 `TagSource` 提供。库**不**打包驱动 (Modbus/OPC UA/MQTT/IEC 61850 等)。
2. **绑定是元数据**, 序列化在 DiagramFile 里, 不是运行时 React 状态。
3. **映射 DSL 是 JSON, 不是脚本引擎**。表达力够覆盖 95% 的 HMI 动画, 不够的让 host 通过自定义槽位实现。
4. **Slot 是结构化扩展点, 不是插件系统**。Editor 端声明 slot 名, host 端按 slot 名实现, 无运行时模块加载、无沙箱。
5. **告警 / 趋势 / 命令 / RBAC / 多画面导航 = host 职责**。Editor 提供 hook, host 实现行为。

---

## 1. DiagramFile 扩展

新增三个可选顶层字段, 不破坏现有 v1 schema:

```jsonc
{
  "version": "1",
  "elements": [...],
  "connections": [...],
  "layout": {...},
  "routes": {...},

  // 新增 ⬇
  "tags": [...],         // 数据点 schema 声明 (可选, 仅作辅助索引)
  "bindings": [...],     // 元素属性 → tag 的绑定
  "slots": [...]         // 槽位实例 (元素附加位 / 全局位)
}
```

加载没有这三个字段的纯设计图: 视图正常, 没有动画。
加载带 bindings 的图: editor 仍可编辑结构 + 绑定; viewer 渲染动画。

### 1.1 Tags — 数据点声明

```ts
type Tag = {
  path: string;          // "QF1.state" | "site/feeder3/current" — host 决定语义
  type: TagType;         // 'bool' | 'int' | 'float' | 'string' | 'enum'
  unit?: string;         // 'A' | 'kV' | 'MW' — 仅用于显示
  enum?: string[];       // type='enum' 时合法值
  range?: [number, number];   // 默认映射的输入范围参考
  description?: string;
};
```

设计取舍:

- `path` 是字符串, **由 host 定义命名空间**。Editor **不**强制和 element id 对齐 — 这给不同 host 留空间 (e.g. voltreality 可能用 `substation/bay1/QF1.state`, prosumer 可能用 `mqtt/home/breaker1`)。
- `tags` 数组对 editor 是**可选的辅助索引** — 提供给作者属性面板做下拉选择和类型校验; 但 binding 即使引用了 `tags` 里没列出的 path 也合法 (host 决定运行时是否能解析)。

### 1.2 Bindings — 属性绑定

```ts
type Binding = {
  // 谁的什么属性
  target: ElementId;
  prop: string;              // 'state.open' | 'fill' | 'label.text' | 'visible' | 'alarm' | 'value'

  // 绑哪个 tag (单 tag 简写 vs 多 tag)
  tag?: string;
  tags?: string[];

  // 怎么映射 (无 mapping 时 = 直接赋值 tag.v 给 prop)
  mapping?: Mapping;
};

type Mapping =
  | { type: 'pass' }
  | { type: 'discrete'; cases: { when: TagValueLike; out: any }[]; default?: any }
  | { type: 'linear'; from: [number, number]; to: [number, number]; clamp?: boolean }
  | { type: 'threshold'; bands: { lt?: number; gte?: number; out: any }[] }
  | { type: 'expr'; js: string };  // 紧急逃生口, 默认禁用
```

`expr` 故意是**最后选项**, viewer **默认不评估** (`allowExpr: false`)。原因:

- 安全: 不评估任意 JS
- 可移植: 绑定应能跨 host / 跨语言运行时工作
- 长期: 大多数"复杂逻辑"应该被打回 host 的 slot 而不是埋在 binding 里

### 1.3 Bindable props — 谁能被绑

每个 library entry 显式声明它哪些属性可被绑:

```jsonc
// src/element-library/breaker.json
{
  "id": "breaker",
  "terminals": [...],
  "params": [...],
  "state": [{"name": "open", "type": "bool", "default": false}],

  "bindable": [
    { "prop": "state.open",  "type": "bool",   "animates": ["fill", "icon"] },
    { "prop": "label.text",  "type": "string" },
    { "prop": "visible",     "type": "bool" },
    { "prop": "alarm",       "type": "enum",   "enum": ["none", "warn", "fault"] },
    { "prop": "value",       "type": "float",  "unit": "A" }
  ]
}
```

Editor 的属性面板根据这个清单生成「Bind…」按钮。Library 不显式声明 `bindable` 时, 默认开放 `state.*` / `visible` / `label.text` 三类。

---

## 2. Slots — 把"剩下的 SCADA 功能"外包给 host

绑定能解决 80% 的可视化, 但**告警弹窗 / 趋势按钮 / 设备详情对话框 / 命令面板 / 第三方组件**这些超出绑定的, 用 slot 解决。

### 2.1 三类 slot

**A. 元素附加槽 (per-element)** — 跟随元素位置, 渲染在画布坐标系内:

```jsonc
"slots": [
  {
    "id": "QF1-trend",
    "kind": "element-overlay",
    "host": "QF1",
    "anchor": "right-of",       // top-of | right-of | center | over
    "size": [80, 24],
    "renderer": "trend-button"  // host 实现这个 renderer
  }
]
```

**B. 全局浮动槽 (chrome)** — 渲染在 viewer 容器边缘, 不跟画布缩放:

```jsonc
{ "id": "alarm-bar",   "kind": "chrome", "anchor": "top",   "renderer": "alarm-bar" }
{ "id": "side-panel",  "kind": "chrome", "anchor": "right", "renderer": "details" }
```

**C. 交互回调 (隐式 slot)** — 不渲染, 接收事件:

```ts
viewerProps.onElementClick(elementId, event)
viewerProps.onElementContextMenu(elementId, event)
viewerProps.onCommand?(elementId, command)  // host 决定是否暴露
```

这三类配合, 覆盖几乎所有 HMI 交互场景, **不增加任何核心组件复杂度**。

### 2.2 Slot 渲染器契约

```ts
type SlotRenderer = (ctx: SlotContext) => React.ReactNode;

type SlotContext = {
  slot: Slot;
  // 元素附加槽才有
  element?: ResolvedElement;
  position?: { x: number; y: number; width: number; height: number };
  // 当前 tag 值快照 (与 element 相关的所有绑定 tag, 已解析)
  tags: Record<string, TagValue>;
  // 触发 host 行为, 比如 "我想要一个对话框"
  fire: (action: string, payload?: any) => void;
};
```

Host 在 viewer props 里提供 `slots: Record<string, SlotRenderer>`。Slot id 在 DiagramFile 里, 渲染器名在 host 代码里, 通过 `renderer` 字段对应。

### 2.3 为什么用 slot 而不是 plugin

| 方案 | 优 | 劣 |
|---|---|---|
| **Slot (本设计)** | React-native, 类型安全, 无运行时加载 | 编辑时槽位需要在 DiagramFile 里声明 |
| Plugin (动态模块) | 用户可不动主代码扩展 | 沙箱、版本、安全、性能问题; 跟 React 生态不契合 |
| 全局事件总线 | 灵活 | 失去结构、调试痛苦 |

slot 等价于 React/Vue 长期验证过的 "named slots" 模式 — 显式、声明式、无副作用。

---

## 3. TagSource — host 提供数据

```ts
interface TagSource {
  // 同步读: viewer 渲染时调一次, 没有值返回 undefined
  read(path: string): TagValue | undefined;

  // 订阅: viewer mount 时按可见 tag 集合调用一次, unmount 时取消
  subscribe(
    paths: string[],
    onChange: (path: string, val: TagValue) => void
  ): () => void;
}

type TagValue = {
  v: number | string | boolean | null;
  t?: number;                                          // timestamp ms
  q?: 'good' | 'bad' | 'uncertain' | 'stale';         // OPC UA quality 简化版
};
```

Host 实现可以是 WebSocket / MQTT.js / SSE / polling REST, 编辑器不关心。

`q` 字段让 viewer 自动给「坏数据」打灰; binding mapping 默认行为是 `q !== 'good'` 时不应用映射, 保留元素的设计时外观 + 一个角标提示。

---

## 4. 组件 API

### 4.1 OneLineViewer

```tsx
<OneLineViewer
  diagram={diagram}              // DiagramFile, 必需
  tags={tagSource}               // TagSource, 可选 — 没有时所有绑定 = undefined
  slots={slotRegistry}           // Record<string, SlotRenderer>, 可选

  onElementClick={(id, ev) => ...}
  onElementContextMenu={(id, ev) => ...}
  onCommand={(id, cmd) => ...}

  theme="auto" | "light" | "dark"
  locale="en" | "zh"

  // 受控 viewport
  viewport={{ pan, zoom }}
  onViewportChange={...}

  // 性能旋钮
  updateThrottleMs={100}         // tag 变化合批, 默认 100ms

  // 安全开关
  allowExpr={false}              // 是否评估 mapping.type='expr', 默认 false
/>
```

### 4.2 OneLineEditor (扩展)

现有 props 不变。新增:

```tsx
<OneLineEditor
  diagram={...}

  // 绑定作者模式
  bindings={{
    enabled: true,
    tagBrowser?: TagBrowser,       // host 实现的 tag 选择器
  }}

  // 槽位作者模式
  slots={{
    available: ['trend-button', 'alarm-badge', 'details-panel'],
    renderPreview?: SlotRenderer,  // 编辑时预览实际渲染
  }}
/>
```

`TagBrowser` 是 host-pluggable 的: 不同后端 tag 命名空间长得不一样, 让 host 自己提供选择器更现实。Editor 默认提供一个简单的"输入字符串 path"作为 fallback。

### 4.3 共享 Hooks (导出给 host)

```ts
// 在 viewer 树里读 tag, 自动订阅 + cleanup
useTagValue(path: string): TagValue | undefined

// 读元素 + 它所有绑定 tag 的当前值 + 已解析的 props
useBoundElement(elementId: string): {
  element: ResolvedElement;
  tags: Record<string, TagValue>;
  computedProps: Record<string, any>;
}

// 读连通性着色 (de-energized 段) — 把分段开关 state 折叠成节点状态
useEnergizedNodes(): Set<NodeId>
```

---

## 5. 渲染 pipeline 增量

现有编译流水线 (data-model.md §8) 加两步:

```
... 6. Route 补齐 ...
    │
    ▼
┌─────────────────────────────────────┐
│ 7. Binding 解析 (仅 viewer 加载)     │
│   - 校验 binding.target 存在          │
│   - 校验 prop 在 element 的           │
│     bindable 清单内                    │
│   - 编译 mapping 为 (val) => out      │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 8. Tag 订阅集合计算                   │
│   - 收集所有 binding 引用的 tag        │
│   - 一次性 subscribe(paths)           │
└─────────────────────────────────────┘
```

Editor 不跑第 7、8 步, 但**保留** binding 字段不丢 (round-trip 保真)。

---

## 6. 边界 — 这个组件**不**做的事

明确划线, 防止滑坡:

| 做 | 不做 |
|---|---|
| 离散 / 连续 / 阈值映射 | 表达式语言 / 脚本运行时 |
| Slot 注入 host 组件 | 插件系统 / 动态模块加载 |
| `onCommand` 回调 | 命令权限 / 审计 / 二次确认对话框 |
| `q='bad'` 灰显 | 告警子系统 (历史 / 确认 / 升级) |
| `useTagValue` 订阅 | tag 历史存储 |
| `theme="dark"` | ISA-101 灰度优先合规 (host 主题包做) |
| 多画面跳转 = slot.fire('navigate', id) | 路由 / 页面栈 / 模板系统 |

如果 host 需要这些, host 在 viewer 外面包一层就好。

---

## 7. 完整例子: 在 voltreality 里嵌一个变电站监控页

```tsx
import { OneLineViewer, type TagSource } from 'sldeditor/viewer'

const tagSource: TagSource = {
  read: (path) => store.getCurrent(path),
  subscribe: (paths, onChange) => {
    const ws = openWebSocket('/api/tags', paths)
    ws.onmessage = (m) => onChange(m.path, m.value)
    return () => ws.close()
  },
}

const slots = {
  'trend-button': ({ element }) => (
    <Button onClick={() => openTrend(element.id)}>📈</Button>
  ),
  'alarm-bar':    () => <AlarmBar />,
  'details-panel': ({ element }) => <DetailsPane id={element.id} />,
}

<OneLineViewer
  diagram={substationDiagram}
  tags={tagSource}
  slots={slots}
  onElementClick={(id) => setSelected(id)}
  onCommand={(id, cmd) => dispatchControl(id, cmd)}
/>
```

Host 提供 5 件事: WS 连接、趋势按钮、告警条、详情面板、命令分发。Editor / viewer 一行业务代码都没写。

---

## 8. 演进路线

### 阶段 1 — MVP (让 voltreality 用起来)

- DiagramFile 扩展 `tags` / `bindings`, schema + serializer + round-trip 测试
- LibraryEntry 增加 `bindable[]`, 主流元件先填几个 (`breaker.state.open`, `transformer.value`, `load.value`, `busbar.energized`)
- `<OneLineViewer />` 拆出来; 实现 `pass` / `discrete` 两种 mapping
- TagSource 接口 + `useTagValue`
- Editor 端绑定面板最小可用版

### 阶段 2 — 服务外部 SCADA-like 用户

- `linear` / `threshold` mapping
- Element-overlay slot
- Chrome slot
- `onCommand` 回调
- `useEnergizedNodes` 拓扑着色
- 文档 + 三个 reference host (一个 MQTT, 一个 OPC UA via WebSocket bridge, 一个 mock)

### 阶段 3 — 打磨

- `expr` mapping (默认 off, 显式开启)
- `TagBrowser` 抽象 + 几个 host 参考实现
- 性能: throttled re-render, 可选 canvas fallback (>500 元素场景)

---

## 9. 与其他文档的关系

- 本文档定义 binding/viewer/slot, 是 `prd.md` §6.3 ("拓扑与图形 1:N 分离") 之上的**可视化层**, 不改变拓扑模型
- `data-model.md` §13 v2+ 计划里的"状态层独立 (量测、告警绑定)"由本文档具体化
- AI agent (smartsld) 工具表未来增加 `bind_element_prop` 类工具时, 走的就是本文档的 Binding schema
