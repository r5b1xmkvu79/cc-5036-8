# 包装折叠求解实验：树形铰接 vs 带闭环约束

本文件是实验结论，不是架构提案。所有边缝距离与求解成本由
`experiments/packaging-solve.js` 产出，写入 `deliverables/packaging-report.json`；
`test/experiment-report.test.js` 会重新执行同一求解调用，逐条核对报告中每个
边缝距离、成本计数与碰撞数量。报告不是手写数字。

复算方式：

```bash
npm run experiment   # 重新生成 deliverables/packaging-report.json
npm test             # 含 experiment-report.test.js 的逐项复算
```

## 1. 同一平面图上的两种假设

两者使用完全相同的平面图（panel 顶点、铰链树）。差异只在求解假设：

| 假设 | 铰链角 | 边缝 | 成本 | 结果语义 |
| --- | --- | --- | --- | --- |
| 树形铰接 `tree` | 每个铰链角是独立输入，沿树传播刚体变换 | 只测量，不参与求解 | 1 次折叠求值 | 缝可以敞开 |
| 闭环约束 `closed` | 以请求角为目标，求满足缝等式的最近姿态 | 两自由边端点配对为等式约束 | 多次折叠求值 + 有限差分雅可比 | 缝闭合，但可能失败或仍干涉 |

闭环求解器是 Levenberg–Marquardt，目标为

```
Σ‖缝端点差‖² + PRIOR_WEIGHT²·Σ(θ−请求角)²
```

先验项只用于在多个闭合解中选“改动最小”的，权重 1e-3，不足以把缝留在张开状态。

### 为什么必须多起点

平面网是一个精确的缝残差驻点：所有缝在 z=0 平面内天然重合，雅可比为零，
单次局部求解无法离开。因此求解器按固定顺序尝试“请求角 → 90° → −90° → 45° →
−45° → 135° → −135°”。这是方法的一部分，不是掩盖失败的补丁；每次尝试的折叠
构造成本都计入 `work`。

## 2. 实测数据（来自 `packaging-report.json`）

### 2.1 闭环盒体，请求角全为 0°（平面网）

| 模式 | 缝数 | 最大边缝距离 | 闭合 | 折叠构造次数 | 迭代 | 起点 | 最大角改动 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tree | 7 | 10.0 | 否 | 1 | 0 | — | — |
| closed | 7 | 4.61e−16 | 是 | 20 | 1 | uniform 90° | 90° |

结论：树形铰接无法闭合，最大缝距等于盖板平面偏移 10；闭环从 0° 请求自动转到
90° 闭合，代价是 20 次折叠求值（其中 19 次用于两次起点与一次数值雅可比）。

### 2.2 闭环盒体，盖板请求 150°（盖板扫过底板）

| 模式 | 最大边缝距离 | 碰撞 | 折叠构造次数 | 求解后角 |
| --- | --- | --- | --- | --- |
| tree | 3.0 | base × lid，cross | 1 | 90/90/90/90/150 |
| closed | 1.08e−7 | 无 | 45 | ≈90° 全部 |

结论：tree 下盖板的真实穿透被检出（`PANEL_COLLISION`），`ok:false`。closed 把
盖板拉回 90° 消除了碰撞，但也说明求解会改变请求角约 60°（实测 59.999996°）——
这是必须告知用户的
代价，不是“免费闭合”。

### 2.3 闭环盒体 + 内衬，缝仍闭合但内衬贴在前壁

| 模式 | 缝闭合 | 碰撞 | 折叠构造次数 | ok |
| --- | --- | --- | --- | --- |
| tree | 是（6 缝） | front × insert，coplanar | 1 | false |
| closed | 是（6 缝） | front × insert，coplanar | 1 | false |

结论：这是最关键的反例。闭环求解成功（缝距 3.65e−16），但内衬与front面片
共面重叠。`evaluatePackaging` 仍返回 `ok:false` 并附 `PANEL_COLLISION`；界面在
三维中把干涉面片标红并给出交点。**闭合成功不等于可包装**，界面不得隐藏该状态。

### 2.4 旧样例

`open box 4x3x2`、`two-panel diagonal hinge`、`mixed-size strip` 在 tree 模式下
全部运行到底，无缝、无碰撞，诊断为空。旧样例的行为未被闭环功能改写。

## 3. 实际边界对应

以下是代码里真实存在的边界，不是口号：

1. **拓扑边界**：铰链必须构成单树（`validation.js` 的 `TOPOLOGY`）。闭环只增加
   缝等式，不增加运动学环；真正的多环连杆不在支持范围。
2. **缝长度边界**：缝只接受等长自由边；不等长报 `SEAM_LENGTH_MISMATCH`，绝不
   通过缩放面板“修复”。
3. **缝方向边界**：`flip` 必须显式声明；缺失报 `SEAM_ORIENTATION`，求解器不猜
   端点配对。
4. **槽位边界**：同一面板边不能既作铰链又作缝，也不能被两条缝复用
   （`SEAM_SLOT_REUSE`）。
5. **求解边界**：局部求解可能失败。失败时返回 `CLOSURE_NOT_SATISFIED` /
   `INVALID_START_POSE`，`result` 为空或保留实际最佳残差，界面显示真实缝距，
   不以 90° 默认值兜底。
6. **几何边界**：零厚度刚体多边形。缝闭合是几何等式，不代表材料可折、可封、
   可承受载荷。碰撞是严格内部三角相交；共边/共点接触不算碰撞。
7. **碰撞边界**：碰撞单独计算，tree 与 closed 都算，且不会被“闭合成功”覆盖。

## 4. 接入方式（可操作）

### 内核接入

```js
import { evaluatePackaging } from './src/packaging.js';

const evaluated = evaluatePackaging(model, { mode: 'closed' });
// evaluated.result     求解后的折叠几何（失败时可能为 null）
// evaluated.closed.seamReport.maxGap / .seams[i].endpointGaps
// evaluated.comparison  tree 与 closed 的边缝距离、角改动、成本
// evaluated.collisions  面片对、类型 cross/coplanar、交点
// evaluated.diagnostics 真实错误/警告，含 CLOSURE_NOT_SATISFIED
```

`model.seams` 的每一项为：

```json
{ "id": "front-lid", "a": "front", "aEdge": 0,
  "b": "lid", "bEdge": 2, "flip": true }
```

### 界面接入

```bash
npm start          # 启动静态服务
# 浏览器打开 http://localhost:5173/
```

界面由包装折叠内核驱动，不是脚本另算一套：

- 顶部 **Packaging assumption** 选择 `tree` / `closed`，切换即重新求值。
- **Closed box (flat request)** 演示从平面网出发的闭环求解；结果面板显示
  `solved seam max gap`、`solve cost`、`converged from`。
- **Closed box, lid 150°** 在 tree 下显示 base×lid 穿透；切到 closed 后缝闭合、
  碰撞消失、角改动约 60° 会显示在 `largest angle change`。
- **Closed box + flap (closes, collides)** 必须显示 `interference 1 pair(s)` 与红
  色内衬，证明界面不隐藏穿透。
- 三维视窗中拖动青色折线手柄改该铰链角，拖动空白处旋转，滚轮缩放；所有改动
  经 `setAngle → evaluate(mode) → view3d.update` 回写，失败与碰撞照常出现在
  Diagnostics。
- **Unfold / refold** 滑杆把目标姿态按比例展开到平面网再回折；每一步都由同一
  内核重算缝距和碰撞，所以展开纸样时能看到闭合在哪里断开。

## 5. 待验假设（单列，尚未通过物理或工艺验证）

以下每条都只在本实验中按几何模型成立，需要实物或工艺数据确认：

- [ ] 面板零厚度、刚体；实际纸板厚度与压痕半径会改变有效边长与闭合姿态。
- [ ] 缝按“边对边端点重合”闭合；实际粘合/插舌有搭接宽度与公差，等长假设
      不成立时需改为带公差的搭接模型。
- [ ] `flip` 声明的端点配对与真实折向一致；反折或内衬翻边可能要求另一配对。
- [ ] 铰链为理想线铰；实际压痕有回弹，90° 闭合角可能需要过折补偿。
- [ ] 求解只保证几何缝闭合，不保证可折顺序（fold sequence）存在。
- [ ] 碰撞只检测面片内部相交，不包含厚度、间隙、工具或手部可达性。
- [ ] 多起点序列与 1e-6 容差对本批样例有效；更复杂的包装可能需要更多起点或
      全局方法，失败率尚未统计。
- [ ] 求解成本为单机计时与折叠构造计数；不同面板数下的规模增长未建模型。
- [ ] 材料摩擦、自重与回弹对保持闭合的影响未建模。

## 6. 文件对应

| 内容 | 文件 |
| --- | --- |
| 闭环求解与缝校验 | `src/packaging.js` |
| 三角级碰撞检测 | `src/collision.js` |
| 包装样例（闭环盒体、反例） | `src/examples.js` |
| 实验入口 | `experiments/packaging-solve.js` |
| 可复算数据 | `deliverables/packaging-report.json` |
| 三维视窗与拖拽 | `web/view3d.js` |
| 界面接线 | `web/app.js`, `web/index.html` |
| 展开/回折 | `web/unfold.js` |
| 数据复算测试 | `test/experiment-report.test.js` |
| 界面启动测试 | `test/app-boot.test.js` |
