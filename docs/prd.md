# OneLineEditor PRD (v0)

> 轻量化、体验好的 Web 端电力一次系统图编辑器。

最后更新：2026-05-06

---

## 1. 背景与定位

电力行业的一次系统图（single-line diagram / 一次主接线图）目前主要依赖 AutoCAD、CAD Electrical、QElectroTech 等桌面工具，或南瑞 / 东方电子 / 四方等闭源专业软件。开源 + 在线 + **真正可编辑**（非只读渲染）的方案在国内外都接近空白：

- PowSyBl / GridSuite：专业级，但偏渲染/查看，编辑能力弱
- draw.io：通用编辑器，电气元件库简陋
- QElectroTech：桌面 Qt，元件库丰富，但本体不在线

OneLineEditor 切入这块空位，**用现代前端技术做一个手感对标 Figma / Excalidraw 的在线一次系统图编辑器**。

## 2. 目标与非目标

### 2.1 目标（v0 / MVP）

- 纯前端，浏览器内可用，无后端依赖
- 拖拽放置常见一次设备符号
- 端子级（terminal）连线，自动吸附 + 正交布线
- 母线（busbar）作为可拉伸特殊元件，正确处理多设备挂接
- 显式电气拓扑模型（与图形分离），支持基础连通性分析
- JSON 文件存档（本地下载/上传），无云存储
- 撤销/重做、缩放/平移、对齐吸附、网格、多选

### 2.2 非目标（明确不做）

- ❌ **不做格式互通**：不导入/导出 CIM (IEC 61970)、IEC 61850 SCL、PSD-BPA、PSS/E、PowerFactory 等任何行业标准格式
- ❌ **不做仿真**：不接潮流、短路、稳定计算
- ❌ **不做 SCADA 实时绑定**
- ❌ **不做账号/协作/云存储**（v0 阶段）
- ❌ **不做二次系统图 / 控制回路图**（保留扩展可能，但 v0 不做）
- ❌ **不做移动端**

## 3. 用户与场景

### 3.1 目标用户

- 电力设计院、电气工程师：日常画一次系统图
- 电力相关教学：学校/培训机构作图教学
- 新能源开发商、电站业主：方案沟通时画示意图
- 二次开发者：可能在自己的运维/调度产品里嵌入

### 3.2 核心场景

1. **从零画一张厂站一次系统图**：选元件 → 拖到画布 → 连线 → 命名 → 导出 JSON / SVG / PNG
2. **打开已有 JSON 继续编辑**
3. **复制粘贴常见接线模板**（单母线、双母线、桥接、3/2 接线等）

### 3.3 非用户

- 调度运行人员（他们要的是 SCADA，不是绘图）
- 仿真分析人员（他们要的是 PSS/E、PSCAD 等专业仿真工具）

## 4. 功能范围

### 4.1 MVP 必须有

| 模块 | 功能 |
|---|---|
| 画布 | 缩放、平移、网格、对齐吸附、多选框选 |
| 元件库 | 至少 20 个一次设备符号（见 §6） |
| 放置 | 从面板拖拽到画布、键盘快捷键放置 |
| 连线 | 端子吸附、正交布线、连线高亮 |
| 母线 | 单独的可拉伸元件，多设备挂接 |
| 编辑 | 选中、移动、旋转（90°步进）、镜像、删除 |
| 属性面板 | 元件 ID、名称、类型参数、状态（开/合） |
| 历史 | 撤销 / 重做 |
| 导入导出 | JSON 文件下载/上传；导出 SVG / PNG |
| 拓扑 | 显式 ConnectivityNode；连通性着色（同一电气节点同色） |

### 4.2 v1 扩展（不在 MVP）

- 连线自动布线算法（A* / orthogonal connector）
- 文字标注、图例、标题栏、图框
- 电压等级着色规范（GB/T 编码）
- 接线模板库（双母分段、3/2 接线等）
- PWA 离线
- 多张图（厂站图 / 系统图）切换

### 4.3 v2 及以后

- 协作 / 云存储 / 历史版本
- 二次系统图
- 简单拓扑分析（合环/开环检测、孤岛识别）
- 元件库管理（用户自定义符号）

## 5. UI 与交互模型

> 参考姊妹项目 BimEditor 的成熟做法，避免重新发明轮子。

### 5.1 整体 Shell 布局

```
┌──────────────────────────────────────────────────────┐
│           顶部浮条（文件 / 视图 / 导出 / 撤销重做）          │
├─────────┬────────────────────────────────────┬───────┤
│         │                                    │       │
│ 左侧栏  │                                    │ 右侧栏 │
│ (持久)  │            画 布 区 域              │(仅选中) │
│         │                                    │       │
│ 元件库  │   [浮动工具条]                      │ 属性  │
│ ───    │                                    │ 面板  │
│ 大纲    │                          [视图工具] │       │
└─────────┴────────────────────────────────────┴───────┘
```

| 区域 | 宽度/位置 | 内容 |
|---|---|---|
| 顶部浮条 | 居中浮动玻璃面板 | 文件 / 视图 / 导出 / 撤销重做 / 缩放百分比 |
| 左侧栏 | 持久，~240px | 元件库（按类别折叠分组）+ 文档大纲（设备列表，可定位/选中） |
| 右侧栏 | 持久占位、内容仅在有选区时显示，~240px | 属性面板（分组折叠） |
| 浮动工具条 | 画布左中 | Select / Pan / Wire / Busbar / Place / Rotate / Mirror |
| 视图工具 | 画布右下 | 缩放、适配视图、网格切换 |
| 画布提示 | 浮层 | 当前工具 hint（"端子吸附中""按 Esc 取消"） |

不做：楼层切换、学科过滤、3D 视图（不在产品边界内）。

### 5.2 工具/模式系统（Tool Registry）

所有画布交互实现统一接口，避免在一个 `onClick` 里堆 if/else：

```ts
interface ToolHandler {
  id: string;
  cursor: string;
  onPointerDown(e, ctx): void;
  onPointerMove(e, ctx): void;
  onPointerUp(e, ctx): void;
  onKeyDown?(e, ctx): void;
  onActivate?(ctx): void;
  onDeactivate?(ctx): void;
}
```

`ToolContext` 提供：当前选区、`screenToSvg()`、命令派发、撤销栈接口。

v0 工具集：`select` / `pan` / `zoom` / `wire`（端子→端子连线） / `busbar`（拖一段母线） / `place_device`（放置元件） / `rotate` / `mirror`。

工具切换不丢上下文：按住 `Space` 临时切 Pan，松开回到原工具。

### 5.3 选择与命中

| 操作 | 行为 |
|---|---|
| 单击元素 | 选中 |
| Shift + 单击 | 加选 / 反选 |
| 拖动空白区域 | 框选 |
| 单击空白 | 清除选区 |
| Esc | 取消当前工具操作 / 清除选区 |
| Delete / Backspace | 删除选中 |

命中测试委托给 SVG DOM：事件 target 向上找带 `data-element-id` / `data-terminal-id` 的祖先。Hover 高亮用 CSS（`:hover`、`data-hovered`），**不**触发 React 重渲染。

### 5.4 键位约定（v0）

| 键 | 动作 |
|---|---|
| `V` | Select 工具 |
| `H` / `Space`（按住） | Pan |
| `Z` | Zoom 工具 |
| `W` | Wire（连线） |
| `B` | Busbar |
| `R` | 旋转 90°（选中时） |
| `M` | 镜像（选中时） |
| `G` | 网格开关 |
| `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` | 撤销 / 重做 |
| `Cmd/Ctrl + S` | 导出 JSON（v0：触发下载） |
| `Cmd/Ctrl + A` | 全选 |
| `Esc` | 取消 / 清除选区 |
| `Delete` / `Backspace` | 删除 |

### 5.5 属性面板触发规则

- **无选**：右侧栏内容隐藏（保留占位还是完全收起，v0 实现时定）
- **单选**：显示该元素的 ID、名称、类型参数、状态（开/合等）
- **多选**：显示字段交集；同名字段值不同时显示"——多个值——"
- **提交时机**：文本框失焦或回车写入 store；下拉/开关即时写入。每次写入产生一个可撤销操作。

### 5.6 画布 / 视口

- Pan/Zoom 通过 SVG 根 `<g transform="translate(x,y) scale(s)">` **直接操作 DOM**，不走 React 状态，跟手不抖
- 缩放中心 = 鼠标光标位置（Cmd/Ctrl + 滚轮，或触控板捏合）
- `--canvas-scale` CSS 自定义属性暴露当前缩放，给选中描边、端子点、网格等抗缩放变形（描边宽度 / scale）
- 屏幕坐标 ↔ SVG 坐标：`screenToSvg()` 由 ToolContext 提供，所有工具复用
- 网格：背景 SVG `<pattern>`，网格大小随缩放档位切换（避免极小或极密）

### 5.7 概念暗合：宿主 + 参数化子元素

BimEditor 的"门挂在墙上、用 0–1 参数化位置"的 hosted geometry 模型，与本项目"端子挂在设备上、用 localPos 局部坐标"模型同构。带来的好处：

- 设备旋转 90° → 端子坐标自动跟随父变换
- 设备镜像 → 端子的朝向（orientation）也镜像
- 母线挂接：设备拖到母线上时，按"投影到母线参数 t ∈ [0,1]"挂接，母线拉伸时挂接保持

这套父子变换栈应在数据模型中显式表达（见 §6）。

## 6. 数据模型

参考 CIM (IEC 61970-301 / 453) 的核心设计原则，**电气拓扑层与图形层分离**，但 schema 保持轻量。

### 6.1 三层结构

```
1. Topology（电气拓扑层）—— 决定"是什么、连到哪"
   - elements:           设备实例
   - terminals:          设备端子
   - connectivityNodes:  电气节点

2. Diagram（图形层）—— 决定"画在哪、怎么画"
   - diagramObjects:     设备在图上的位置/旋转/镜像
   - wires:              连线的视觉路径（折线点序列）

3. State（状态层，可选）
   - 开关位置、量测、告警
```

### 6.2 JSON Schema 草案

```jsonc
{
  "version": "0.1",
  "elements": [
    {
      "id": "QF1",
      "type": "Breaker",
      "name": "出线断路器",
      "params": { "ratedVoltage": 220, "ratedCurrent": 2000 },
      "state": { "position": "closed" },
      "terminalIds": ["QF1.t1", "QF1.t2"]
    }
  ],
  "terminals": [
    { "id": "QF1.t1", "elementId": "QF1", "localPos": [0, -10] },
    { "id": "QF1.t2", "elementId": "QF1", "localPos": [0,  10] }
  ],
  "connectivityNodes": [
    { "id": "n1", "terminalIds": ["QF1.t1", "T1.t1"] }
  ],
  "diagram": {
    "objects": [
      { "elementId": "QF1", "x": 100, "y": 200, "rotation": 0, "mirror": false }
    ],
    "wires": [
      { "id": "w1", "connectivityNodeId": "n1",
        "path": [[100,200],[150,200],[150,260]] }
    ]
  }
}
```

### 6.3 关键设计原则（不可妥协）

1. **Terminal 是一等公民**——连线连端子，不连设备本体
2. **ConnectivityNode 显式建模**——电气连通性由 ConnectivityNode 决定，wire 只管走线视觉
3. **拓扑与图形 1:N 分离**——同一设备未来可在多张图上出现（v1+）
4. **id 用人可读字符串**（QF1、T1、n1），不用 uuid，方便调试和 JSON diff

## 7. 元件库

### 7.1 来源策略

- **短期**：从 **QElectroTech** (qelectrotech.org, GPLv2) 提取 `.elmt` 文件，编写 `elmt → SVG + port metadata` 转换脚本
- **中期**：按 **GB/T 4728** / IEC 60617 自绘高频元件（约 30 个），替换 QElectroTech 来源
- **明确不用**：AutoCAD Electrical 符号库（合规审计风险）

### 7.2 MVP 元件清单（≥20）

母线 / 接线类：
- 母线段（busbar，可拉伸）
- 接地

开关类：
- 断路器（QF）
- 隔离开关（QS）
- 接地刀闸（QE）
- 负荷开关
- 熔断器（FU）

变压器类：
- 双绕组变压器
- 三绕组变压器
- 自耦变压器

互感器类：
- 电流互感器（CT）
- 电压互感器（PT/VT）

电源 / 负荷类：
- 发电机（G）
- 同步电动机（M）
- 异步电动机
- 系统电源（无穷大母线）
- 负荷
- 电池储能

无功 / 保护类：
- 并联电抗器
- 串联电抗器
- 并联电容器
- 避雷器（FBL）

### 7.3 元件数据规格

每个元件包含：
- SVG 几何（path/line/rect 组合）
- 端子定义：`{ id, localPos: [x,y], orientation: 'N'|'S'|'E'|'W' }`
- 默认参数 schema
- 旋转/镜像后端子坐标变换规则

## 8. 技术选型

### 8.1 选型决策

| 维度 | 选择 | 决策依据 |
|---|---|---|
| 框架 | **React + TypeScript** | 生态最成熟，团队熟悉 |
| 构建 | **Vite** | 启动快，配置简单 |
| 图编辑核心 | **自研 SVG（无图编辑库）** | 见 §8.2 |
| 状态 | **Zustand** | 轻量、API 简单 |
| 渲染 | **SVG** | DOM 可检查、CSS/事件原生、SVG 导出零成本；不考虑大体量场景，性能不是约束 |
| 拖拽/手势 | 原生 Pointer Events（必要时 `use-gesture`） | 不需要重型库 |
| 样式 | **Tailwind CSS** | 工程化好；shadcn/ui 的基座 |
| 通用 UI 组件 | **shadcn/ui**（Radix + Tailwind） | 复制源码到仓库可改、无运行时依赖锁、对话框/下拉/Tooltip/表单等不再造轮子 |
| 测试 | Vitest + Playwright | Vite 原生集成 |
| 代码质量 | ESLint + Prettier + TypeScript strict | 标配 |

### 8.2 不用图编辑库（自研 SVG）的理由

通用图编辑库（React Flow / JointJS / GoJS / mxGraph）解决的是"在画布上拖节点连线"，但本项目 80% 的复杂度在**电气语义层**——Terminal、ConnectivityNode、可拉伸母线、多设备共节点——这些库一行都不帮。留着库反而带来约束：

- **母线模型冲突**：库的 node 是"点+尺寸"，没有"两端可拖的线段"原语；要么自己在库外渲染一层，要么扭曲库的抽象
- **Handle ↔ Terminal 翻译层**：库的连接点概念和我们的端子模型不是 1:1，每次 `onConnect` 都要翻译成 ConnectivityNode 操作，徒增一层心智负担
- **Edge ≠ Wire ≠ ConnectivityNode**：库的 edge 通常是 1:1 source/target，多端子挂到同一母线时建模别扭
- **mxGraph / draw.io fork**：API 老旧，长期被绑死在其架构上
- **JointJS Plus / GoJS**：高阶功能商业授权

自研要补的"基础设施"其实有限，且都是一次性投入：

| 自己写 | 估算 | 说明 |
|---|---|---|
| 视口（pan/zoom，SVG `viewBox`） | 小 | ~100 行 |
| 选择 / 多选 / 框选 | 中 | Pointer Events + 命中测试 |
| 拖拽 + 网格吸附 | 中 | 端子级吸附本来就是自研重点 |
| 撤销/重做 | 中 | 用 Zustand 状态打 patch；任何方案都得自己写 |
| SVG/PNG 导出 | 小 | `XMLSerializer` + `html-to-image` |

> 一句话：电气编辑器的差异化在数据模型，不在画布库。自研 SVG 让数据模型和渲染层 1:1 对齐，长期更轻。

**自研边界**：只自研画布（SVG + 电气语义）。画布外的通用 UI——工具栏按钮、属性面板控件、对话框、下拉、Tooltip、表单——一律走 shadcn/ui，不造轮子。

## 9. 风险与未决事项

### 9.1 主要风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| QElectroTech `.elmt` 解析复杂度超预期 | 中 | M1 第一周做 spike；不行就先手画 5 个元件 |
| 母线（可拉伸 + 多挂接）建模与交互复杂 | 高 | 第一周做 spike：定义 busbar 数据结构、拉伸手柄、多端子吸附；产出最小可玩 demo |
| 自研 SVG 画布的"基础设施工作量"被低估（pan/zoom、选择、框选、撤销栈） | 中 | M0 集中投入；以后每个里程碑只在已稳定的画布上加业务 |
| 正交布线效果差 | 中 | v0 接受手动拐点，v1 再上自动布线算法 |
| GPLv2 元件库的合规边界 | 中 | 内部使用无虞；分发时做风险评估，长期换自绘 |

### 9.2 未决事项

- [ ] 是否做 PWA？（v1 决定）
- [ ] 元件 ID 命名规范（KKS？自由文本？）—— v0 自由文本即可
- [ ] 是否支持夜间模式 —— v1
- [ ] License 选择（MIT / Apache 2.0 / 闭源）—— 待定
- [ ] 项目是否做成开源 —— 待定

---

## 附录 A：参考资料

- IEC 61970-301 (CIM Base)
- IEC 61970-453 (CIM Diagram Layout Profile)
- GB/T 4728《电气简图用图形符号》
- IEC 60617《Graphical symbols for diagrams》
- QElectroTech: https://qelectrotech.org
- PowSyBl: https://www.powsybl.org
- React Flow: https://reactflow.dev
