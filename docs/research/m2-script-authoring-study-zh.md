# RPE Redux M2：面向普通谱师的脚本化制谱调研

> 研究日期：2026-11-23。范围：M2（随机数、序列值、目标/轨道选择、参数复用、预览/模拟、安全执行），并扩展到 Phigros/RPE 常见演出与维护成本。本文同时记录本轮落地的接口调整。

## Executive Summary / 执行摘要

M2 不应从“让用户写更多代码”开始，而应从“把一段可解释、可预览、可撤销的制谱意图变成一次批量编辑”开始。成熟工具的共同模式是：

1. 随机数的可复现性仍然重要，但不等于要把 `seed` 暴露给普通谱师。M2 的扰动只显示“幅度”；计划引擎内部保持稳定随机源，使同一谱面、同一选择和同一参数可以重复预览，重新抽样属于之后的高级能力。
2. 目标范围先于数值操作：当前选择、明确的行/轨道集合、全局范围分别表达；REAPER 以选中 MIDI 对象为脚本入口，Blender 用字段/索引传播，RPE 的 `judgeLine` 已有 exact/range/global 雏形。
3. 普通作者需要“命名参数 + 简单默认值 + 高级折叠”，而不是裸表达式。Max 的 Presentation Mode、Godot 的 Inspector 参数、Blender 的 Group Input 都把复杂网络包装成可操作面板。
4. 写入应是 `Plan → Preview → Apply`：先显示影响数量、警告和代表性帧，再以一个历史单元提交。RPE Redux 已有 detached plan、intermediate snapshot、fingerprint 冲突拒绝、事务与脚本超时/取消；M2 的关键缺口是把计划结果以用户能看懂的方式呈现出来。
5. Phigros 的高自由度使“逐 note 速度、0 速视觉、判定线表演、副线/装饰线、回收”互相耦合。绑线不是一个基础宏，而是包含目标线、末尾定位、folder 和生命周期的结构向导，不能塞进 M2 的常用脚本卡片。

## Introduction / 范围与方法

资料按证据强度分层：

- **格式/实现事实**：Lchzh Docs 的格式与实测页面、RPE/PhiEdit 说明、Phira Documents、开源模拟器/渲染器源码或文档，以及 RPE Redux 自己的兼容性文档。
- **社区实践**：谱师教程、原始帖子、玩家/模拟器作者的说明、PhiBot 的实际图表与标签。它们说明“有人如何制作/游玩”，不等于规范。
- **个别经验**：单篇帖子或单个作者的计数、耗时、兼容性反馈，只作为待验证信号。
- **本报告推导**：针对 RPE Redux M2 的产品方案和假设，不冒充外部事实。

Phigros 官方没有公开完整的谱面规则/格式规范；因此“格式事实”仍需注明其来源是逆向文档或实现，而不是官方标准。跨模拟器结论只在资料明确显示不同实现/开关时成立，不从一张谱面的异常泛化。

## Main Analysis / Phigros 谱面语义

### 可直接依赖的结构

- 官方 JSON 的根结构包含 `formatVersion`、`offset`、`judgeLineList`；判定线包含 `bpm`、上下方 note、速度事件、移动/旋转/消失事件。[Lchzh Docs：根结构与 JudgeLine](https://docs.lchzh.top/learning/phigros/#%E6%A0%B9%E7%BB%93%E6%9E%84-root)、[判定线字段](https://docs.lchzh.top/learning/phigros/#%E5%88%A4%E5%AE%9A%E7%BA%BF-judgeline)
- Note 的基本语义包括类型、判定时间、`positionX`、Hold 的 `holdTime`、逐 note `speed`、`floorPosition`；速度事件是按判定线组织的时间区间。逐 note 速度与判定线速度不是同一个旋钮。[Lchzh Docs：Note/SpeedEvent](https://docs.lchzh.top/learning/phigros/#%E9%9F%B3%E7%AC%A6-note)、[Lchzh Docs：相关实测](https://docs.lchzh.top/learning/phigros/metrics#%E9%9F%B3%E7%AC%A6%E6%B8%B2%E6%9F%93%E7%BB%86%E8%8A%82)
- RPE/PhiEdit 的时间通常是 `a:b/c` 拍数；RPE 还承载事件层、父线、扩展字段等编辑器能力。RPE 说明把谱面解释为“判定线 + note + 事件”，事件改变线的位置、角度、透明度和基准速度。[Re:PhiEdit 说明书摘录](https://www.scribd.com/document/1029936570/RPE%E8%AF%B4%E6%98%8E%E4%B9%A6v1-1-P1-Public)
- 在本仓库中，RPE/PEZ 是 lossless 工作格式；官方 JSON 导出会按 1/32 拍采样、烘焙缓动和父线变换，再计算官方 `floorPosition`；PEC 受 30 条判定线、无元数据、无父线/事件层等限制。[RPE Redux `docs/compatibility.md`](../../docs/compatibility.md#L1-L3)、[外部格式限制](../../docs/compatibility.md#L28-L39)

### 绑线、0 速与固定视觉

- **社区术语而非单一格式字段**：常见“绑线”实践是让 note 与一条移动/表演判定线共同运动，常配合逐 note 速度为 0；原始说明明确写到 note 可逐个设置速度、速度 0 的 note 会从一开始贴在线上、判定线与 note 作为整体运动。[原始作者说明：performance notes](https://note.com/phamutrapush7/n/n3274dc67ba0a?hl=en)
- **不要把 0 速当作安全的“固定显示”开关**：Lchzh 的实测称，Hold 的 `speed=0` 会导致长度为 0、因而不渲染；note 的实时垂直距离超过阈值也会不可见。这些是特定版本的实测行为，必须由目标模拟器回归验证。[Lchzh Docs：Hold/可见性实测](https://docs.lchzh.top/learning/phigros/metrics#%E9%9F%B3%E7%AC%A6%E6%B8%B2%E6%9F%93%E7%BB%86%E8%8A%82)
- **RPE Redux 已有相关数据但不能替作者做语义判断**：兼容文档保留完整 note `speed`、`visibleTime`、`yOffset`，也记录了 hook event 的固定端点和恢复尾值；这说明脚本可以做一致性检查，但“这是演出 note 还是可判定 note”仍需要作者明确。[RPE Redux `docs/compatibility.md`](../../docs/compatibility.md#L42-L48)
- **末尾不能直接取 `chartTime`**：OpenPhM 的格式实测指出，RPE 根上的 `chartTime` 更像编辑器时长提示，和音符/事件内容末尾可能不一致。[OpenPhM 格式实测](https://github.com/DemonPlayer00/OpenPhM/blob/master/Phigros-%E8%A7%84%E5%88%99%E9%80%9F%E6%9F%A5.md)
- **本轮新增 `chart.range()`**：宿主现在从音符、普通事件轨和 Shader 事件计算 `endBeat/endSeconds`，并明确它是“已写入内容边界”，不是音频长度；这为将来的绑线向导提供了稳定定位基础。

### 判定线表演、副线、装饰线与回收

- 社区教程把判定线分成主线、副线和装饰线：主线服务判定与可读性，副线用于配合多轨/多方向效果，装饰线不承担判定而服务视觉；教程还强调高速与大幅度移动不宜同时堆叠。这是谱师方法论，不是格式规范。[社区谱师教程：判定线演出](https://www.bilibili.com/read/cv12131531/)
- 副线/装饰线的“自然出现、消失并转换”直接对应脚本需要的生命周期操作：创建或选择线、设置 parent/transform、写 alpha、绑定/解除 note、最后回收或复用。社区不应被抽象成“只改一条线的几个事件”。
- 一篇原始制谱帖报告一张观赏谱使用 96 条线、83 个绑线表演 note，并指出 0 速 Hold 的回收和忘记回收是实际困难；这只能作为个案，但足以证明 M2 必须把“资源清单/回收检查”纳入实验，而不是只看生成成功。[原始制谱帖：线数量、绑线与回收](https://www.233leyuan.com/post-detail/1979253569401534138)

### 模拟器差异、事件量与维护成本

- PhiZone/player 明确实现了 RPE 支持之外的自定义属性，并提供 `integrateSpeedEasings` 开关；prpr 也暴露 `format`、自动对齐、加速优化等配置。可确认的结论是：不同播放器存在实现开关与增强字段，不能把某个模拟器的画面当作 RPE/官方游戏的唯一真值。[PhiZone/player：渲染顺序与增强字段](https://github.com/PhiZone/player#z-indexes)、[prpr：ChartInfo 与运行配置](https://github.com/Mivik/prpr#global-configuration)
- Phira 的 `info.yml` 把 chart 文件、格式、offset、预览时间、宽高比、判定线长度等包装成独立元数据；其文档还持续记录渲染/判定同步修复。因此测试包必须同时验证 chart 内容和包元数据，不能只交换一个 JSON。[Phira Documents：ChartInfo](https://yuevuwu.github.io/phira-docs/en/chart-standard/chartinfo.html)、[Phira FAQ/更新](https://docs.phira.link/en/help/)
- Lchzh 的版本化实测记录了 note 渲染复杂度、事件处理、浮点边界与大物量打开延迟；例如其实测表中 131072 个 note 的打开延迟约 30.25 秒。它不是 RPE Redux 的性能基准，但说明“事件/音符数量”和“运行时可维护性”必须成为实验观测量。[Lchzh Docs：性能与复杂度实测](https://docs.lchzh.top/learning/phigros/metrics#%E8%B0%B1%E9%9D%A2%E5%BC%80%E5%90%AF%E6%80%A7%E8%83%BD)
- 另一条社区视频描述记录了 549 notes、3440 events 的谱面，并明确标注使用 Re:PhiEdit 与某模拟器录制；这是一个样本，不是“社区平均值”，但可作为压力测试的现实量级起点。[社区视频描述：物量、事件量与工具链](https://www.youtube.com/watch?v=riJE5pO2r2U)

## Main Analysis / 常用演出模式与痛点

| 模式 | 作者实际要表达的意图 | 容易出错的隐含状态 | M2 应验证什么 |
| --- | --- | --- | --- |
| 绑线表演 note | note 跟随一条移动/旋转/透明度变化的线 | note 所属线、逐 note 速度、可见性、线的回收顺序 | 作为后续结构向导验证；不作为 M2 基础 recipe |
| 逐 note 速度/超车 | 同一时间的 note 以不同速度抵达、交错或停滞 | `speed` 与 line speed 叠加，`floorPosition` 和可见阈值 | `per-note`/`per-line`/`absolute` 三种语义是否能被普通作者区分 |
| 0 速/低速固定视觉 | note 留在画面或与线绑定，随后淡出/移动 | 0 速 Hold 可能不渲染；不同模拟器的浮点/可见阈值不同 | 预览中主动警告“不可见/非 Hold 安全”，并给出目标模拟器差异 |
| 主线节奏表演 | 小幅 move/rotate/alpha 与音乐节拍一致 | 事件时间、缓动、BPM/全局 tempo、事件层 | 序列值、按拍生成事件、缓动模板是否易读 |
| 副线/装饰线 | 不增加或少增加判定压力，增加画面层次 | 线数量、zOrder/透明度、parent、纹理、何时出现/消失 | 目标选择能否按“用途/空闲线/已绑定线”而非只按数字 |
| 回收/复用 | 演出结束后让线消失或把空线再次利用 | 孤儿 note、未清 alpha、复用后旧事件残留、0 速 Hold | 生成后能否给出线生命周期清单与未回收警告 |
| 事件密集段 | 用大量关键帧追逐音乐细节 | 事件量、重复值、相邻常量事件、编辑/打开性能 | 脚本是否能合并、计数、限制或分段提交 |
| 跨模拟器交付 | RPE/Redux 编辑，Phira/prpr/游戏录制 | 官方 JSON/PEC/RPE 能力不对称，渲染开关不同 | Preview/export matrix 是否能暴露“编辑器看得到但目标看不到” |

## Synthesis & Insights / 对照工具启发

以下结论均来自一手文档/API，并标明可迁移部分；不把外部工具的完整 UX 当作 RPE Redux 的需求。

| 工具 | 做得好的点（准确出处） | 可迁移到 RPE Redux 的规则 |
| --- | --- | --- |
| Ableton Live / Max for Live / Max | Max `random` 支持范围、seed、cycle；`counter` 支持上下数、边界和复位。[random Reference](https://docs.cycling74.com/reference/random/) 的 **Attributes: seed/cycle**、[counter Reference](https://docs.cycling74.com/reference/counter/) 的 **Description/Messages**。Max 用 Lock/Presentation Mode 区分编辑网络与运行面板。[Patching](https://docs.cycling74.com/userguide/patching/) 的 **Locking/Unlocking/Presentation Mode**。Live 的 Max for Live MIDI Tools 可生成/变换 MIDI note，设备参数可映射到 Live automation。[Ableton Max for Live](https://www.ableton.com/en/live-manual/12/max-for-live/) 的 **Using Max for Live Devices**、[Device Parameters](https://docs.cycling74.com/userguide/m4l/live_parameters/)。 | 默认显示“作者面板”：有 seed、范围、节拍/速率和运行按钮；把脚本内部的 graph/steps 隐藏在高级视图；提供“锁定参数/只运行”状态。随机必须可重演，并允许重新抽样。 |
| REAPER ReaScript / MIDI | ReaScript 支持 Lua/EEL2/Python；脚本默认有 undo，复杂修改可用 `Undo_BeginBlock`/`Undo_EndBlock`；可用 `GetUserInputs` 收集最多 16 个字段并区分取消；MIDI API 能枚举 selected notes、批量 insert/set/delete，并要求多次修改后 `MIDI_Sort`。[ReaScript](https://www.reaper.fm/sdk/reascript/reascript.php) 的 **Undo/Persistence**、[API help](https://www.reaper.fm/sdk/reascript/reascripthelp.html) 的 **GetUserInputs/MIDI_EnumSelNotes/MIDI_InsertNote/MIDI_Sort**。 | “当前选择”应是默认 scope；参数对话框要有取消语义；一次脚本运行应只有一个可读的历史单元；批量操作后由宿主统一排序/校验，不让普通用户承担内部顺序。 |
| Blender Geometry Nodes / Animation Nodes | Geometry Nodes 的 Random Value 以 ID 和 Seed 驱动，可对每个唯一 index 生成字段；Index Switch 只评估选中的输入且可用 Menu Switch 标签提升可理解性。[Random Value](https://docs.blender.org/manual/en/5.4/modeling/geometry_nodes/utilities/random_value.html)、[Index Switch](https://docs.blender.org/manual/en/5.0/modeling/geometry_nodes/utilities/index_switch.html)。Viewer 可把中间值同时送入视图与 Spreadsheet；Group Input/Node Tool 暴露用户参数；Undo 提供 Adjust Last Operation/Undo History。[Viewer](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/output/viewer.html)、[Node-Based Tools](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/tools.html)、[Undo & Redo](https://docs.blender.org/manual/en/latest/interface/undo_redo.html)。 | 随机策略要声明 key：`per note`、`per line` 或 `per run`；目标下拉用“第 3 条线（名称）”而不只显示整数；预览要能检查中间结果/抽样值；一次操作后的参数应可再次调整而不重写脚本。 |
| Godot VisualShader / AnimationTree | VisualShader 是节点图，图转为 shader；参数节点可由 Inspector/脚本设置，参数引用节点用于复用。[VisualShader](https://docs.godotengine.org/en/latest/classes/class_visualshader.html)、[VisualShaderNodeParameter](https://docs.godotengine.org/en/latest/classes/class_visualshadernodeparameter.html)、[ParameterRef](https://docs.godotengine.org/en/stable/classes/class_visualshadernodeparameterref.html)。AnimationTree 用 BlendTree/StateMachine 组织状态，Advance Expression 允许可读的条件表达式。[Using AnimationTree](https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html) 的 **Blend tree/Advance Expression**。 | M2 先保留声明式 steps，不急于引入通用节点编辑器；但应支持“命名中间参数/复用参数”和有限表达式。把复杂脚本拆成可解释的 stage：选目标 → 生成值 → 应用 → 检查。 |
| Pure Data（额外的 dataflow 参照） | Pd 把对象、inlet/outlet 和连接线作为可运行的数据流；run/edit mode 明确区分“操作 patch”和“修改 patch”，并有 Help patch、Undo/Redo。[Pd Manual：boxes/connections](https://msp.ucsd.edu/Pd_documentation/2.theory.of.operation.htm#2.1.2)、[Edit and run mode](https://msp.ucsd.edu/Pd_documentation/2.theory.of.operation.htm#2.2.1)、[官方 metro help patch](https://github.com/pure-data/pure-data/blob/master/doc/5.reference/metro-help.pd)。 | 脚本的“运行面板”应可被普通用户直接操作；帮助/示例应贴近每个参数与对象；执行态和编辑态要有明显边界，避免用户误以为改了预览就已经改图。 |

## Recommendations / 结合当前 Studio / Extension 能力的判断

- 当前参数 schema 已支持 `number/boolean/text/select/color/beat/judgeLine/expression`，且 `judgeLine` 在有固定数量时支持 exact/range/global；这是 M2 目标选择的可用基础。[`docs/extensions.md`](../../docs/extensions.md#L225-L231)、[`parameters.ts`](../../src/core/extensions/parameters.ts#L15-L18)、[`parameters.ts`](../../src/core/extensions/parameters.ts#L83-L115)
- 当前声明式 steps 只有 `batch/transaction/select/notice`，参数引用只解析为参数值，没有任意代码 step；这适合安全的序列/分布/批处理，但还不能在 data-only script 内表达“对每个 note 计算一个新随机值”。[`docs/extensions.md`](../../docs/extensions.md#L233-L244)、[`steps.ts`](../../src/core/extensions/steps.ts#L59-L86)
- batch 已有 notes/events 两类、字段/操作/上下界/缓动/扰动/seed；clone 已有目标线、增量、保留源、seed 和通道分布参数，可优先用来验证 M2，而不是重新发明一套脚本语言。[`parameters.ts`](../../src/core/edit/multiEdit/parameters.ts#L36-L57)、[`parameters.ts`](../../src/core/edit/multiEdit/parameters.ts#L89-L100)、[`planVocabulary.ts`](../../src/core/edit/multiEdit/planVocabulary.ts#L1-L45)
- steps 会在 detached chart 上规划，保存每一步 intermediate snapshot，并以 before fingerprint 拒绝过期计划；apply 通过现有 selection edit/history 提交。这已经具备“先计划后提交”的内核。[`steps.ts`](../../src/core/extensions/steps.ts#L96-L132)、[`steps.ts`](../../src/core/extensions/steps.ts#L347-L359)、[`steps.ts`](../../src/core/extensions/steps.ts#L505-L524)
- 当前脚本面板是一张卡片一个 Run 按钮；参数只用于弹窗初值记忆，取消即不运行；脚本主体/steps 有 30 秒预算，Extension 卸载会取消而不记失败。[`ScriptsPanel.tsx`](../../src/frontend/screens/editor/inspector/scripts/ScriptsPanel.tsx#L1-L8)、[`ScriptsPanel.tsx`](../../src/frontend/screens/editor/inspector/scripts/ScriptsPanel.tsx#L36-L59)、[`scripts.ts`](../../src/core/extensions/scripts.ts#L787-L823)、[`scripts.ts`](../../src/core/extensions/scripts.ts#L954-L1007)
- 当前 `preview.frame` 渲染的是当前预览运行时的 frame，不是任意 `StepsPlan` 的假想 chart；因此 M2 的“可预览”仍是待验证产品能力，不能假设现有 preview API 已经解决。[`preview.ts`](../../src/core/api/preview.ts#L287-L318)

## Recommendations / M2 实验脚本矩阵

每个脚本都应有同一组观测：输入步数、受影响 note/event/line 数、事件总量增量、计划耗时、预览帧、导出到官方 JSON/Phira/prpr 的结果、撤销后 fingerprint 是否恢复。随机实验固定保存 seed；同一输入重复运行必须能判定是“同结果”还是“重新抽样”。

| ID | 实验脚本（普通作者语言） | 最小参数模型 | 覆盖的 Phigros 情景 | 待验证假设 |
| --- | --- | --- | --- | --- |
| M2-01 | 给选中 note 排一个 X 序列 | scope=当前选择；start/step；order=时间/选择顺序；wrap | 基础键形、序列值 | 时间顺序比选择顺序更容易理解；预览应显示首/尾样本 |
| M2-02 | 给选中 note 加受控随机扰动 | amount；内部稳定随机源；clamp | 随机键形、轻微人化 | 普通作者只需要控制幅度；同一计划可重复预览，重新抽样不进入基础表单 |
| M2-03 | 在指定线或 folder 内选择目标 | target=exact/range/global；folder token；count | 目标/轨道选择、副线 | 输入框应补全 folder 名；folder 展开后保持 authored order；global 继续作为显式高级模式 |
| M2-04 | 在同一 folder 内循环分配选中 note | source scope；folder；cycle；preview diff | 多线键型、同组铺设 | 这是选择/分配实验，不等于一键绑线；必须显示 folder 展开后的真实线号 |
| M2-05 | 逐 note 速度曲线 | speed mode=absolute/multiplier；start/end；easing；seed 可选 | 超车、低速、0 速固定视觉 | 普通作者能理解“最终速度”与“倍率”差异；Hold speed=0 和可见性警告必须在预览前出现 |
| M2-06 | 生成一段主线 move/rotate/alpha 演出 | beat range；from/to；easing；density；line target | 节奏型主判定线表演 | “按拍生成”比逐事件录入更可维护；相邻常量/重复事件应可合并 |
| M2-07 | 检查演出线资源与生命周期 | line set；end beat；fade duration；reuse policy | 副线、装饰线、回收 | 先做 lint/报告，不在 M2 自动创建或删除线 |
| M2-08 | 回收/复用指定演出线 | line set；end beat；fade duration；reuse policy | 回收、重复段落 | 自动回收能减少维护成本，但必须报告“仍有 note/event/child 的线”并拒绝危险删除 |
| M2-09 | 事件/Note 的按拍复制与分布 | source selection；target lines；beat increment；channel cycle；retain source | 多线复制、装饰通道、重复乐句 | 现有 clone 参数足够覆盖大部分初版需求；目标序列的重复值与 `_` 跳过语义需做可视化 |
| M2-10 | 一键生成“绑线 + 回收”小场景 | carrier line；note scope；speed=0；move/alpha template；cleanup | 真实演出闭环 | 只测单步编辑会低估问题；一个脚本必须能从创建到回收并给出资源清单 |
| M2-11 | 跨模拟器安全检查与预览 | target=Redux/official JSON/Phira/prpr；sample beats；strictness | 模拟器差异、固定视觉 | 输出必须区分“格式不可表示”“渲染实现不同”“仅本地已验证”；不能只给绿色成功 |
| M2-12 | 物量/事件量压力测试 | notes/events/lines 规模；chunk size；preview rate | 大量事件、维护成本 | 超过阈值时应建议分段或合并；脚本超时和预览帧节流不应留下半次写入 |

## Recommendations / 参数、预览与安全执行方案

### 建议的参数交互模型

采用三段式表单，默认只显示普通作者需要的选项：

1. **Scope（改谁）**：当前选择、拍区间、指定判定线、候选线 exact/range/global。候选线显示“folder / 索引 / 名称”，文本输入支持 folder 名自动补全并展开为真实线号；不要只显示整数。
2. **Pattern（怎么改）**：序列、随机、按拍分布、绑定、生命周期五类；根据类别显示最小参数。`seed`、单位、速度语义、排序依据和边界策略必须有短说明与示例。
3. **Review（会发生什么）**：影响对象计数、事件增量、线创建/删除/复用、跨格式警告、代表性时间点 preview；明确 `Preview`、`Apply`、`Cancel`，Apply 后写入一个可读的 history label。

参数复用采用“记住上次输入 + 一键恢复默认 + 显式保存 preset”三层：当前代码已有每脚本参数记忆，M2 先验证记忆是否减少重复劳动；随机扰动不再要求用户维护 seed。跨脚本 preset、tag 和编辑器才放到 M4/M6，避免把“记忆值”误当成“可复用配方”。

### 预览与安全策略

- **所有批量/线生命周期脚本默认先 Plan**。Plan 结果至少包含：受影响对象、增删线、事件数、首/尾/随机抽样值、风险警告、before/after fingerprint。
- **渲染 preview 与结构 preview 分开**。结构 preview 展示 diff/count；渲染 preview 在用户选定的 beat/seconds 取帧。若暂时不能把假想 chart 接入 `preview.frame`，至少显示结构摘要并标注“渲染仍是当前图”。
- **随机要可复现但不增加认知负担**。同一 scope、参数和 chart fingerprint 应得到相同计划；“重新抽样”如果未来需要，应是高级动作，不是基础参数。
- **危险操作显式确认**。删除/回收线、把 0 速赋给 Hold、把 note 移到另一条线、超过物量阈值、输出格式会丢字段时，Apply 按钮旁显示具体原因；不能靠 toast 一闪而过。
- **一次 Apply 一次撤销**。沿用现有 `applySteps` 的 fingerprint guard 与 history metadata；计划过期就重新规划，不能把旧计划强行覆盖到新图上。
- **可取消、可限额**。沿用脚本超时/AbortSignal；对大图使用分段规划/预览，但最终提交仍应是明确的事务边界，避免半次写入。

## Limitations & Caveats / 限制与待验证事项

1. Lchzh Docs 的规范与实测不是 Phigros 官方公开规范；版本、模拟器、资源包和浮点行为可能改变结论。
2. “绑线”“副线”“装饰线”“回收”是社区工作语言，不能直接假定存在对应的单一字段；M2 应从真实 RPE/PEZ 样本抽取最小结构，再决定 API 名称。
3. 单篇社区帖的 96 线/83 绑线、视频的 3440 events 只能当样本，不可当平均谱面规模；需要用一组有授权的真实谱面统计分位数。
4. 现有 `preview.frame` 不能直接证明能渲染 detached plan；需做一个不写盘的计划图渲染探针，验证资源、父线、噪域和事件层是否完整。
5. M2 不应同时解决脚本录制、tag、筛选、编辑器、分享导出；本报告只把它们需要的契约（稳定参数、可读 label、运行记录、preview/apply 边界）先固定下来。

## Methodology Appendix / 方法附录

检索先从格式和实现事实入手，再用原始谱师教程、作品说明和玩家讨论补足实践层证据，最后与 Max、REAPER、Blender、Godot 和 Pure Data 的一手文档对照。格式事实、社区惯例、个案经验和本项目推导在正文中分开标记。对“绑线”“0 速”“回收”等术语，不把社区工作语言直接升格为格式字段；所有高风险结论都要求在 RPE Redux 预览与至少一个外部播放器中复核。

## Bibliography / 参考文献

**Phigros/RPE/Phira/模拟器**

[1] [Lchzh Docs：Phigros 谱面格式](https://docs.lchzh.top/learning/phigros/)

[2] [Lchzh Docs：相关计算与实测数据](https://docs.lchzh.top/learning/phigros/metrics)

[3] [RPE/PhiEdit 说明书 v1.1 摘录](https://www.scribd.com/document/1029936570/RPE%E8%AF%B4%E6%98%8E%E4%B9%A6v1-1-P1-Public)

[4] [Phira Documents：ChartInfo](https://yuevuwu.github.io/phira-docs/en/chart-standard/chartinfo.html)

[5] [Phira Guides & FAQ](https://docs.phira.link/en/help/)

[6] [PhiZone/player README](https://github.com/PhiZone/player)

[7] [Mivik/prpr README](https://github.com/Mivik/prpr)

[8] [PhiBot Chart Browser](https://phibot.dev/charts)

**社区实践与原始说明**

[9] [Phigros 自制谱面全方位攻略](https://www.bilibili.com/read/cv12131531/)

[10] [Performance notes in Phigros：逐 note 速度与 0 速说明](https://note.com/phamutrapush7/n/n3274dc67ba0a?hl=en)

[11] [原始制谱帖：绑线、线数量与回收](https://www.233leyuan.com/post-detail/1979253569401534138)

[12] [社区视频描述：RPE/模拟器录制与物量](https://www.youtube.com/watch?v=riJE5pO2r2U)

**对照工具一手文档**

[13] [Cycling '74 Max `random`](https://docs.cycling74.com/reference/random/)、[`counter`](https://docs.cycling74.com/reference/counter/)、[Patching](https://docs.cycling74.com/userguide/patching/)、[Max for Live](https://www.ableton.com/en/live-manual/12/max-for-live/)

[14] [REAPER ReaScript](https://www.reaper.fm/sdk/reascript/reascript.php)、[ReaScript API help](https://www.reaper.fm/sdk/reascript/reascripthelp.html)

[15] [Blender Random Value](https://docs.blender.org/manual/en/5.4/modeling/geometry_nodes/utilities/random_value.html)、[Index Switch](https://docs.blender.org/manual/en/5.0/modeling/geometry_nodes/utilities/index_switch.html)、[Viewer](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/output/viewer.html)、[Undo & Redo](https://docs.blender.org/manual/en/latest/interface/undo_redo.html)

[16] [Godot VisualShader](https://docs.godotengine.org/en/latest/classes/class_visualshader.html)、[VisualShaderNodeParameter](https://docs.godotengine.org/en/latest/classes/class_visualshadernodeparameter.html)、[AnimationTree](https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html)

[17] [Pure Data Manual：Theory of operation](https://msp.ucsd.edu/Pd_documentation/2.theory.of.operation.htm)、[官方 `metro` help patch](https://github.com/pure-data/pure-data/blob/master/doc/5.reference/metro-help.pd)
