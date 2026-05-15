# 配图清单

博客 `auto-layout-design.md` 引用的截图。每张需要在 sldeditor 里手动生成（或用 `downloadPng`/`downloadSvg` API），文件名按下面的列表命名后丢到本目录即可。

| 文件名 | 内容 | 备注 |
|--|--|--|
| `force-vs-domain.png` | 同一份元件 + 连线，左：force-directed 通用算法（连线扭曲、母线倾斜），右：本算法（母线水平、链下垂） | 概念对照图 |
| `parallel-branches-broken.png` | 并联接地刀闸的"坏"输出 —— QE7 飞到母线上方，QE6 串在 QE1 下面 | 用 fixture `parallel-earth.json` 跑早期版本 |
| `parallel-branches-ok.png` | 修好后：QE1 / QE6 / QE7 三个并联挂在 QF2 下方同一 rake | 当前版本 |
| `tier-stacked.png` | 双母线被错误地堆叠：BI 在上、BII 在下、母联跨了一根超长引线 | 早期版本 |
| `tier-side-by-side.png` | 双母线左右铺开同 Y，B35 在下方，整图层次分明 | 当前版本 |
| `bus-span-propagation.png` | 父母线根据子母线宽度动态拉宽的示意（B1 上有 T1+T2 两个变压器槽位，每个槽宽 ≥ 子 bus span） | 可以用 `complex-substation.json` 截图 + 标注 |
| `slot-ordering-bad.png` | 母联端子在母线中间、跨母联是长水平线 | 关闭 slot ordering 时的输出 |
| `slot-ordering-good.png` | QS_BT_I 在 BI 右边缘、QS_BT_II 在 BII 左边缘 | 当前版本 |
| `3bus-naive.png` | T1 只识别为 2-bus，QS_T1_II 退化成 BII 普通 tap，对角长引线 | 早期版本 |
| `3bus-yjunction.png` | T1 在 BI/BII X 中点、QF_T1/CT_T1 沿 T1 列对齐、merge 节点画成 Y 形 rake | 当前版本 |
| `bus-tie-vertical.png` | QF_BT 默认竖着挂在 QS_BT_I 下方、远端 1200px 长水平线 | 早期版本 |
| `bus-tie-horizontal.png` | QF_BT 旋转 90° 横躺在两母线 X 中点、L 形短引线 | 当前版本 |
| `complex-final.png` | `complex-substation.json` 当前版本完整布局 —— 全图收官 | 当前版本 |

截图建议：

- 加深色背景（设置 → 深色主题）能让墨线更醒目
- 把视图缩到能完整看到关键结构的范围（约 50%-70%）
- 导出 PNG 用 2× 高清（编辑器内置支持）
