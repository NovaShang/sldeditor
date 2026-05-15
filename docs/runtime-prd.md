# OneLineEditor 运行时模块 PRD (v0)

> 把 sldeditor 从「设计时单线图编辑器」扩展为「设计时编辑器 + 运行时数据可视化层」。本文档**不**是技术 spec, 不规定实现 — 只回答"做什么、不做什么、为什么这条线划在这里"。

最后更新: 2026-05-09
配套文档: `docs/binding-and-viewer-api.md` (技术 API), `docs/data-model.md` (数据模型), `docs/prd.md` (编辑器 v0 PRD)

---

## 1. 背景与定位

### 1.1 现状

sldeditor v0 (见 `docs/prd.md`) 已经是一个能用的设计时编辑器: 拖元件、连线、属性编辑、导出 JSON / SVG / PNG / DXF。**输出物是一张静态图**。

### 1.2 真实需求

电气单线图在生产环境里 90% 的使用场景**不是**画图本身, 而是把画好的图当成**实时状态的可视化底图**:

- 变电站运维: 在单线图上看断路器实时位置、电流、电压、告警
- 微电网监控: 看电池 SOC, 光伏出力, 负载分布
- 数据中心配电: 看每条馈线的负载率、PDU 状态
- 工业园区: 看主进线、母线段、各车间用电

这是 SCADA HMI (Human-Machine Interface) 长期占据的范畴。商业产品 (Ignition / WinCC / Wonderware) 都附带 HMI 设计器, 但**它们的 HMI 编辑器普遍是 1990 年代的 UX, 单价 $10k+ 起, 不可嵌入第三方应用**。

### 1.3 这个模块要做的事

在不变成 SCADA 平台的前提下, 把 sldeditor 扩展成一个**可嵌入任何 React 应用、能加载实时数据的电气图组件**:

- 设计时: editor 让作者**配置**数据绑定和可扩展槽位 (零代码)
- 运行时: viewer 让 host 应用**接入数据源 + 注入场景特定组件**, 把图变活

### 1.4 一句话定位

> 我们做电气单线图领域的 **`react-flow` + `mapbox-gl`**: 一个 React 应用想要"既能让用户编辑、又能跑实时数据可视化"的电气图组件, 就嵌我们。
>
> 我们**不**做电气领域的 **Ignition / WinCC**: 完整 SCADA 平台 (告警 / 趋势 / 命令 / 历史 / 用户 / 协议) 是 host 应用的事。

---

## 2. 目标与非目标

### 2.1 目标 (v0 / 本模块 MVP)

- **数据源中立**: 组件本身不知道也不关心数据从哪来; host 实现一个 `TagSource` 接口接 Modbus / OPC UA / MQTT / WebSocket / HTTP / 任何东西
- **绑定声明式**: "断路器颜色随 QF1.State 变化" 是写在 DiagramFile JSON 里的元数据, 不是代码; 作者在 GUI 里配置, 文件可序列化、可版本化、可被 AI agent 读写
- **可扩展**: host 应用通过命名 slot 注入任意 React 组件, 把告警栏 / 趋势按钮 / 详情面板 / 命令对话框这些场景特化的东西**留给 host**
- **零依赖污染**: 组件不打包通信驱动、不打包图表库、不打包告警系统; bundle 体积仍然轻
- **设计时与运行时同源**: 同一个 DiagramFile 在 editor 里编辑, 在 viewer 里上数据; 不分裂成两套模型
- **LLM 友好**: 绑定 schema 简单到 LLM 一发即对, 让 smartsld AI agent 未来能"帮我把所有断路器加上 state 绑定"

### 2.2 非目标 (这一节就是边界)

❌ **不做协议驱动**
- Modbus / OPC UA / IEC 61850 / DNP3 / 60870-5 / Profinet / EtherNet/IP — 加起来几十万行, 各自有合规边界, 不进组件
- host 实现 TagSource 是组件唯一指定接口

❌ **不做告警子系统**
- 告警等级、确认、升级、通知、邮件 / 短信 / 电话外呼、值班排班 — host 实现, 通过 chrome slot 渲染告警栏
- 组件只负责"绑定到 alarm 属性的元素表现出告警样式"

❌ **不做历史 / 趋势 / 时序数据**
- 历史存哪 (InfluxDB / Timescale / VictoriaMetrics / 厂家私有) 是 host 决定; 时间轴交互、聚合、压缩各家不同
- 组件只负责"点了某个元素时通过 slot 让 host 显示一个趋势按钮"

❌ **不做命令下发的全流程**
- 权限校验、二次确认、操作记录、审计日志、回滚 — 跨企业差异巨大
- 组件只负责"用户在画布上做了某动作 → 派发 `onCommand(elementId, command)` 给 host", 之后 host 自己处理

❌ **不做用户 / 角色 / 权限**
- 谁能看 / 谁能改 / 谁能下令是 host 业务规则
- 组件提供 read-only 模式开关, 仅此而已

❌ **不做多画面导航 / 路由**
- 一个 SCADA 应用通常有 overview → 站 → 间隔 → 设备多层页面; 这是 host 应用的路由职责
- 组件提供 `fire('navigate', target)` slot 信号, host 接进自己的 router

❌ **不做仿真 / 潮流 / 短路 / 稳定计算**
- 这是 PSS/E / ETAP / DigSILENT 的领地, 与可视化解耦

❌ **不做合规级 HMI 视觉标准**
- ISA-101 高性能 HMI (灰度优先, 颜色保留给异常)、IEC 61850 单线图视觉规范、NUREG-0700 (核安全)
- 组件提供主题接口, host 想合规就发布合规主题包

❌ **不做大规模实时性能优化** (v0 范围)
- 高频 (10ms 级) / 大量元件 (>500) 的 canvas 渲染留给 v1+
- v0 SVG 渲染上限定为"几百元素 / 100ms 更新节流"

❌ **不做编辑器 / viewer 之外的 runtime 形态**
- 不做 native (Tauri / Electron 包裹除外)、不做服务端渲染 HMI、不做手机 app SDK
- 只有 React DOM 一个目标

---

## 3. 用户与场景

### 3.1 主用户: **应用开发者** (developer-as-user)

不是终端运维, 不是画图的电气工程师, 而是**在自己的 React 应用里需要"既能编辑、又能跑实时"电气图的开发者**。

具体细分:

| 用户类型 | 场景 | 嵌入位置 |
|---|---|---|
| 自家产品 (voltreality) | 变电站 / 设施电气运维 | 主仪表盘 |
| DER 资产管理 SaaS | 光伏 + 储能 + 微电网监控 | 资产详情页 |
| 工业 IoT 平台 (HighByte / Litmus / Crosser) | 给客户的可视化卡片 | 内嵌组件 |
| 系统集成商 (SI) | 一次性给客户做定制 dashboard | 项目代码 |
| Home Assistant / Node-RED 社区 | 家用 / 商用电气可视化插件 | 自定义卡片 |
| 教学软件 | 电气工程在线课件 / 实验平台 | 课程页 |

这五类的共同点: 他们都是**程序员**, 会写 React 代码, 但**不想从零造一个 SLD 编辑器**, 也**不想从零造一个 SCADA HMI**。

### 3.2 间接用户: **图作者 / 系统集成方**

不写代码但用 editor 画图、配绑定、摆槽位。例子:
- 设计院的工程师, 给项目交付一份带绑定的 DiagramFile
- DevOps / IT, 给自家公司画各机房配电图并接监控
- 集成商的实施工程师, 给客户现场配 HMI

editor 的作者面板 (Bind… 按钮 / 槽位添加) 必须做到**这群人零代码**就能配通用情况。

### 3.3 间接用户: **LLM agent**

smartsld 的 AI agent 未来会:
- 读 DiagramFile, 看到没绑定的元素 → "建议给 QF1 的 state.open 加绑定"
- 用户说"把所有断路器都接到 modbus 数据点 X" → agent 调工具批量加 binding
- 用户说"在每个变压器旁加趋势按钮" → agent 调工具批量加 slot

binding/slot 的 schema 必须**简单到 LLM 一发即对**。

### 3.4 非用户

- **运维操作员** — 他们看的是 host app, 我们对他们透明
- **设备制造商 / OT 设备 SDK** — 我们不卖给设备厂
- **仿真分析师** — 我们不做计算

---

## 4. 功能范围

### 4.1 阶段 1 (MVP — voltreality 能用为止)

**数据模型扩展**
- DiagramFile 增加 `tags` (可选 schema 索引) / `bindings` (元素属性绑定) 两个顶层字段
- LibraryEntry 增加 `bindable[]`, 主流元件先填 `state.*` / `visible` / `label.text`
- `pass` (直传) + `discrete` (离散映射) 两种 mapping; 其余 mapping 类型留到阶段 2
- TagValue 数据结构 `{ v, q?, t? }`

**Viewer 组件**
- `<OneLineViewer />` 从 `<OneLineEditor />` 中拆出来, 只读
- 接收 `diagram + tags (TagSource) + onElementClick` 三件最小集
- 自动 100ms 节流合批渲染 tag 更新
- `quality !== 'good'` 时元素打灰 + 角标

**Editor 作者面板**
- 元素属性面板增加「Bind…」按钮
- 文本输入式 tag path 选择 (无 TagBrowser 时的 fallback)
- discrete 映射的简单一对一表格 UI
- DiagramFile 序列化 / 反序列化保真测试 (binding 字段 round-trip)

**文档**
- 一个完整的 reference host (mock 数据 + 前 5 类绑定 + 截图)
- 接入文档: "在 30 行内把 viewer 嵌到你的 React app 里"

### 4.2 阶段 2 (服务外部 host 用户)

- `linear` / `threshold` 两种 mapping
- 三类 slot (element-overlay / chrome / 隐式回调) 全实现
- `onCommand` 回调 + 推荐 slot 命名约定 (alarm-bar / details-panel / trend-button / ...)
- `useEnergizedNodes()` 拓扑染色 hook
- 槽位作者面板 (在 element 上加 slot)
- 三个 reference host: MQTT (Home Assistant 风格)、OPC UA via WS bridge (工业风格)、纯 mock (教学风格)

### 4.3 阶段 3+ (未来)

- `expr` mapping (默认禁用, 显式开启) 或一个安全子集
- `TagBrowser` 抽象 + 几个 host 参考实现 (扁平 / 树形 / 标签)
- 多 tag binding (单元素状态依赖多个 tag 综合)
- 性能: 节流策略可调、canvas fallback (>500 元素)
- DiagramFile schema 是否升 v2 (取决于 v1+v2 是否能 forward-compat)

---

## 5. 边界 — 谁负责什么

这是这份 PRD 的**核心**。任何分歧都回到这张表。

| 关注点 | 组件负责 | Host 应用负责 |
|---|---|---|
| **数据获取** | 调 `TagSource.subscribe(paths, onChange)` | 实现 `TagSource` (任何协议、任何后端、任何缓存策略) |
| **数据缓存 / 重连 / 降级** | 不管 | 全管 |
| **UI 显示数据** | 把 binding + mapping 应用到元素属性 | — |
| **数据 quality** | 默认 stale/bad 灰显 + 角标 | 可选自定义主题覆盖 |
| **告警系统** | 提供绑定到 alarm 属性的样式 | 完整告警栏 / 历史 / 确认 / 升级 (chrome slot) |
| **趋势 / 历史** | 暴露 element 点击事件 + slot | 数据存储 / 查询 / 时间轴 / 图表 (overlay slot 或 chrome slot) |
| **命令下发 UI** | 派发 `onCommand(id, cmd)` 信号 | 二次确认 / 权限 / 审计 / 失败重试 |
| **权限 / RBAC** | 提供 `readOnly` 全局开关 | 谁能看 / 改 / 操作的全部业务逻辑 |
| **多画面导航** | slot 通过 `fire('navigate', id)` 发信号 | 路由 / 页面栈 / 面包屑 |
| **协议驱动** | 不做 | Modbus / OPC UA / IEC 61850 / MQTT / 自研 |
| **历史时序存储** | 不做 | InfluxDB / Timescale / 私有 historian |
| **拓扑分析** | `useEnergizedNodes()` (基于已知 state) | 潮流 / 短路 / 稳定 (留给专业仿真) |
| **主题** | 内置 light/dark | 可选自定义主题 (e.g. ISA-101 灰度) |
| **国际化** | en / zh | 添加其他语言 |

判定原则: **凡是「跨客户、跨场景差异巨大」的, 一律 host 负责**。组件只做「电气可视化的共性部分」。

---

## 6. 接口契约 (高层)

详细 API 在 `binding-and-viewer-api.md`。本节只列**有几条契约**, 这是边界的形式化:

| # | 契约 | 方向 | 谁定义 | 谁实现 |
|---|---|---|---|---|
| 1 | **DiagramFile** | 持久态 | 组件 | 双方读写 |
| 2 | **TagSource** | host → 组件 (数据) | 组件 | host |
| 3 | **SlotRenderer** | host → 组件 (UI) | 组件 | host |
| 4 | **Event Callbacks** (`onElementClick` / `onCommand` / ...) | 组件 → host (事件) | 组件 | host |

**总共四条契约组成全部边界**。任何"组件应该再多做一点"的提案, 必须能被这四条之一表达, 否则就是越界。

---

## 7. 价值论证 — 为什么这条线划在这里

### 7.1 对组件本身

- bundle 保持轻 (估算 gzipped <300KB), 任何 React 应用敢嵌
- 不背 SCADA 平台的合规 / 安全 / 性能 / 协议生态包袱, 维护可持续
- 边界清晰, 长期不会"功能蔓延成 mini-Ignition"

### 7.2 对 host 应用

- host 不被绑死: 告警 / 趋势 / 命令完全自己做, 不需要绕过组件实现
- host 已有的工具复用: 自家 telemetry 后端 / 历史库 / 告警系统都直接接进来
- 自带的零代码作者面板让 host 不用做"图编辑器" — 这是省下来的几个月工作量

### 7.3 对 DiagramFile 生态

- 一份图 + 绑定可在不同 host 之间移植 (host 切换时, 重写 TagSource, 不重写图)
- 可被 LLM agent 读写, 让 AI 自动化配置成为可能
- 可作为长期可读、可版本化、可 diff 的"电气可视化资产"

### 7.4 市场层面

- React 生态里**目前没有**像样的开源"电气可视化嵌入组件" — 这个定位是真空地带 (`react-flow` 是通用流程图, draw.io / mxGraph 古老不 React-native, Ignition 不可嵌入)
- 服务对象 (B2B 应用开发者) 单点价值高, 即便量不大也能形成 reputation 和招聘信号
- 与 sldeditor (设计时编辑器) 是同一组件分阶段功能, 不需要分仓 / 分品牌

### 7.5 这条线划错了会怎么样

如果边界向内收 (不做绑定 / viewer): 错过运维场景, sldeditor 永远只是设计工具, 真实使用率有上限。

如果边界向外扩 (做告警 / 趋势 / 命令权限): 组件变成 mini-SCADA, 维护成本爆炸, host 反而不能用 (要么用我的版本要么 fork)。这是 React Flow Pro 的反面教材。

**当前这条线划法是「能做的最大可视化共性 ∩ 能不做的最广 host 差异性」的交集**。

---

## 8. 风险与未决事项

### 8.1 主要风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| TagSource 抽象掉了协议特性 (e.g. OPC UA structured types), host 表达不出来 | 中 | TagValue.v 允许任意 JSON, host 自己组合; 实操跑通 3 个 reference host 验证 |
| Slot 命名约定碎片化 (每个 host 起不同 slot 名, 无事实标准) | 中 | 阶段 2 发布"推荐 slot 命名集" + 几个 reference host 用同一套 |
| 绑定 schema 在 v0 定下后, 阶段 2 / 3 加新映射类型需要 schema 演进 | 中 | 用 union type, mapping.type 是开放字符串, 未知类型 viewer 跳过 + warning |
| 性能上限 (>500 元素) 在 v0 没解决, 大客户来了会撞墙 | 低 | 文档明示上限; 长期 canvas fallback |
| 安全: `expr` mapping 一旦开启, host 没有沙箱可能引入 XSS | 中 | 默认禁用; 文档明确警告; 长期或上 jsonata / jq 类受限 DSL |

### 8.2 未决事项

- [ ] 多 tag binding 的形态: 单元素一个属性依赖多个 tag (e.g. 颜色 = state + alarm + comm 综合) 怎么表达? **倾向**: 阶段 2 加 `tags: [...]` + 一个 reduce 类型的 mapping
- [ ] Editor 是否在作者模式也接 TagSource 做实时预览? **倾向**: 是, 但默认 mock 数据, host 可选实接
- [ ] TagBrowser 接口提供几种参考实现? **倾向**: 阶段 3 至少给扁平 + 树形两种
- [ ] `expr` 是否替换为受限 DSL (类似 jsonata 子集)? **倾向**: 长期是, 阶段 2 不做
- [ ] 命令系统是否需要"准备 / 选择 / 确认"三段式 (类似 IEC 61850 select-before-operate)? **倾向**: 不进组件, host 自己实现; `onCommand` 派发的 cmd 字段足够 host 表达三段
- [ ] viewer 在 host React tree 里需不需要 Provider 包装? **倾向**: 是, 提供 `<OneLineRuntimeProvider tags={...} slots={...}>` 让多个 viewer 共享
- [ ] 是否要为 react-native / 服务端渲染留口? **倾向**: v0 不留, v1+ 视需求

---

## 9. 演进路线

| 阶段 | 触发条件 | 目标 | 验收 |
|---|---|---|---|
| 1 (MVP) | 当下 | voltreality 能嵌 viewer 做监控页 | voltreality 一个正式仪表盘上线; round-trip 测试通过 |
| 2 | 阶段 1 落地 + 至少一个外部 host 试用 | 三类 slot + 三种 mapping + reference host | 三个 reference host 跑通; 文档完整 |
| 3 | npm 周下载 >100 持续 1 月, 或外部 issue >10 | 性能 / 高级 mapping / TagBrowser | bundle 仍 <300KB; 500 元素 60fps |

---

## 10. 与现有文档的关系

- **`docs/prd.md`** (v0 编辑器 PRD): 本 PRD 的前置文档; 编辑器本体的目标 / 非目标在那里, 此处不重复
- **`docs/data-model.md`**: 本 PRD 引入的 `tags` / `bindings` / `slots` 三个字段在阶段 1 落地后回写到那份文档的 §1 顶层结构和 §13 演进路线
- **`docs/binding-and-viewer-api.md`**: 本 PRD 的实现侧 spec, 包含 TypeScript 类型、组件 props、hook 签名 — 那是"怎么做", 这是"做什么、不做什么"
- **`smartsld` AI agent**: 当 binding schema 落地, smartsld 的工具表会扩展 `bind_prop` / `unbind_prop` / `add_slot` 等; 工具签名遵循本 PRD 的契约
