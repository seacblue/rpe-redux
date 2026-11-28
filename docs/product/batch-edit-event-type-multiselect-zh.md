# 批量编辑事件类型多选（设计稿）

- 状态：已实现，最终门禁通过
- 日期：2026-11-28
- 范围：编辑器 Inspector 的“批量编辑 → 事件类型”选择器
- 一句话：事件类型可以在同一种值形态内多选，并共享一套批量参数；不同值形态不能混选。

## 1. 背景

当前批量编辑表单的事件类型选择器是单选值 `eventType: string`。预览计划也只按一个事件轨道过滤：

```ts
snapshot.events.filter((entry) => !eventType || entry.type === eventType);
```

这让用户只能重复执行同一套批量参数，分别处理多个事件轨道。目标是让用户在一次操作中选择多个轨道，同时避免把不同数据形态的轨道送进同一个输入控件或同一套数值运算。

这次设计只针对“事件轨道多选”。`field` 仍然是另一个独立选择器，不能把两个选择器合并成一个多层选择器。

## 2. 已确定的产品规则

### 2.1 选择对象

下拉菜单选择的是事件轨道，例如：

- X / Y
- 旋转
- 透明度
- 速度
- 缩放
- 颜色
- Shader
- 文字
- 倾斜
- GIF

同一套 `field`、`operation`、数值范围、缓动、循环和扰动参数，会按事件轨道分别应用到所有已选目标。

### 2.2 值形态分类

事件类型按事件端点 `start/end` 的真实数据形态分为四类：

| 值形态 | 事件轨道 | 可否与同类跨轨道多选 |
| --- | --- | --- |
| 普通数值（用户所说的“纯文本”） | `moveXEvents`、`moveYEvents`、`rotateEvents`、`alphaEvents`、`speedEvents`、`scaleXEvents`、`scaleYEvents`、`inclineEvents`、`gifEvents` | 可以 |
| RGB | `colorEvents` | 可以，但当前只有一个 RGB 轨道 |
| 文字 | `textEvents` | 可以，但当前只有一个文字轨道 |
| Shader | `paintEvents` | 可以，但当前只有一个 Shader 轨道 |

`Beat` 不是事件轨道值形态。所有事件的 `startTime/endTime` 都是 Beat；它只决定 `t1/t2` 字段使用 `BeatField`，不参与事件类型互斥。

`NOISE_ACTIVE_EVENTS` 是“存在/不存在”的合成状态，没有可编辑的事件端点字段，不进入新的多选列表。噪声激活的现有专用路径保持不变，不和普通事件轨道混在本次选择模型里。

### 2.3 选择互斥

- 初始没有选中类型时，所有候选项都可选。
- 选中第一项后，记录该项的值形态。
- 同值形态的候选项继续可选。
- 不同值形态的候选项保持可见，但禁用。
- 禁用项不展示原因、tooltip 或额外说明；列表本身就是规则反馈。
- 取消最后一个选中项后，选择器回到“无值形态锁定”状态，所有候选项重新可选。
- 允许短暂空选，但此时预览和应用按钮不可用，并显示已有的“没有可匹配目标”错误路径。

### 2.4 候选项范围

候选项只来自当前选中对象实际存在的事件轨道：

1. 从当前 `SelectionSnapshot.events` 收集 `entry.type`。
2. 去重。
3. 排除 `NOISE_ACTIVE_EVENTS`。
4. 按 `EVENT_TRACKS` 的稳定顺序排列。

不展示当前选择之外的空轨道，也不在本次功能中创建缺失事件。某个已选类型只存在于部分判定线或事件集合时，预览只修改实际存在的项目，缺失项目跳过。

### 2.5 默认值与选区变化

为保持现有批量编辑的安全语义：

- 面板首次打开时，默认只选候选列表的第一项，不自动全选。
- 选区变化后，保留仍然存在的已选项，不自动加入新出现的同类项。
- 如果原来的已选项全部不再存在，则选择候选列表第一项。
- 如果当前没有可用候选项，则保持空选。
- 选区变化不会清空 `field`、`operation`、`lower`、`upper` 等已经填写的参数；只重新计算可用字段和预览。

## 3. 字段兼容矩阵

事件类型多选只锁定值形态；`field` 仍决定具体写入哪个字段。字段菜单根据当前值形态过滤：

| 值形态   | 可编辑值字段           | 可编辑公共字段                            |
| -------- | ---------------------- | ----------------------------------------- |
| 普通数值 | `both`、`start`、`end` | `easing`、`t1`、`t2`、`line`、`linkgroup` |
| RGB      | `red`、`green`、`blue` | `easing`、`t1`、`t2`、`line`、`linkgroup` |
| 文字     | 无                     | `easing`、`t1`、`t2`、`line`、`linkgroup` |
| Shader   | 无                     | `easing`、`t1`、`t2`、`line`、`linkgroup` |

规则说明：

- `t1/t2` 使用 Beat 输入控件；这不是事件类型分类。
- RGB 的 `red/green/blue` 字段分别对事件的 `start` 和 `end` 对应通道执行同一套操作，等价于对两个端点同时修改。通道值最终限制在 `0–255` 的整数范围。
- 文字和 Shader 在第一版不批量修改端点值。文字替换、Shader 名称切换和 Shader 参数轨道编辑留给后续专用设计。
- `easing` 修改 `easingType`，`line` 继续走现有复制/移动语义，`linkgroup` 继续走现有整数约束。
- 对文字或 Shader 选择时，若持久化草稿中的 `field` 是 `both/start/end`，表单保留其他参数但将当前字段标记为不可预览；用户选择一个公共字段后才能预览和应用。首次进入特殊值形态时，建议把默认字段归一到 `t1`，避免打开面板即进入无效状态。

## 4. 交互稿

### 4.1 入口

保留现有的 `事件类型` 行，不增加分组标题。控件是一个单列表复选下拉：

```text
事件类型  [ X, 旋转                         ▾ ]

展开后：
☑ X
☐ Y
☑ 旋转
☐ 透明度
☐ 颜色        （若已选普通数值则禁用）
☐ Shader      （若已选普通数值则禁用）
☐ 文字        （若已选普通数值则禁用）
```

列表不按值形态分组，不显示“普通数值 / RGB / 文字 / Shader”标题。选中项在收起态显示为本地化标签，多个标签按稳定顺序连接；空间不足时显示已选数量和第一个标签。

### 4.2 选择动作

- 点击已启用未选项：加入 `selectedEventTypes`。
- 点击已选项：移除该项。
- 点击禁用项：无动作。
- 复选框和标签区域都应支持键盘操作；上下键移动，空格切换，Escape 收起。
- 下拉展开时不提交预览；选择变化后沿用现有 `onChange → refresh` 链路。

### 4.3 空态与错误

- 没有事件类型候选项：保留现有空选择/无匹配提示，不伪造选项。
- 有候选但全部取消：事件类型行显示空值，预览与应用不可用。
- 选中类型与字段不兼容：字段仍显示当前草稿值，但预览返回现有错误消息；字段菜单只列出当前值形态允许的项。
- 不为禁用的跨类型选项额外添加解释文本，避免在紧凑 Inspector 中增加噪声。

## 5. 模块设计

### 5.1 值形态模块

在 `core/edit/multiEdit` 放置一个纯函数模块（建议名 `eventTargets.ts`），作为事件类型选择和计划校验的共同接口。它不依赖 React、Inspector 或 host：

```ts
type EventValueFamily = "number" | "rgb" | "text" | "shader";

function eventValueFamily(type: string): EventValueFamily | null;
function eventTypeCanJoin(selected: readonly string[], candidate: string): boolean;
function eventFieldsForFamily(family: EventValueFamily): readonly string[];
function eventTypesForSelection(types: readonly string[]): string[];
```

实现规则集中在这一处：

- `colorEvents → rgb`
- `textEvents → text`
- `paintEvents → shader`
- 其余 `EVENT_TRACKS → number`
- `NOISE_ACTIVE_EVENTS → null`

UI 只调用这个模块来决定 `disabled` 和字段菜单；planner 也调用同一模块做防御性校验，避免 UI 绕过后生成错误计划。

### 5.2 表单接口

将表单值从单个 `eventType` 改为会话内的目标集合：

```ts
interface MultiEditFormValues extends BatchParameters {
  mode: "edit";
  eventApplicationMode: string;
  eventTypes: string[];
}
```

`eventTypes` 不是 `BatchParameters` 的持久化字段。它是当前选区上下文，不能写入跨谱面复用的批量草稿；历史仍只记录批量参数。读取旧 recipe 或旧调用点时，可以在适配层把旧的 `eventType: string` 转成单元素 `eventTypes`，避免历史命令失效。

`MultiEditPane` 与 `MultiEditForm` 的 `eventTypes` prop 应改名为 `availableEventTypes`，把“候选集合”和“当前选中集合”分开：

- `availableEventTypes`：来自当前 snapshot 的候选项。
- `values.eventTypes`：用户在下拉中实际选中的目标项。
- `setAvailableEventTypes()`：选区变化时只做保留/裁剪/默认第一项，不把所有候选项自动选中。

### 5.3 计划接口

`BatchEditOptions` 增加多目标入口：

```ts
interface BatchEditOptions {
  // ...existing batch parameters
  eventTypes?: readonly string[];
  /** Legacy adapter; normalized to eventTypes when present. */
  eventType?: string;
}
```

归一化顺序：

1. `eventTypes` 存在时去重并使用它。
2. 否则若有旧 `eventType`，转换成 `[eventType]`。
3. 两者都没有时，表示不按轨道过滤，保持已有 planner 语义。

预览计划按 `Set(eventTypes)` 过滤 `snapshot.events`，随后仍按 `lineIndex:type` 或 `type` 分组。这样同一批参数会分别在每个选中轨道上运行，分布顺序不会把不同轨道混成一个时间序列。

Planner 在生成 changes 之前检查：

- 目标类型全部属于当前 snapshot 的合法轨道。
- 目标类型必须共享一个 `EventValueFamily`。
- `field` 必须属于该 family 的允许字段。
- 空 `eventTypes` 直接返回现有 no-match 错误。

### 5.4 RGB 写入

RGB 端点写入需要从当前 `writeField` 的 note tint 逻辑中独立出来，形成事件专用小模块或私有函数：

1. 从 `after.start` / `after.end` 读取长度为 3 的数组；异常值回退到 `[255, 255, 255]`。
2. 对选中的通道执行 `batchOperation`。
3. `Math.trunc` 后 clamp 到 `0–255`。
4. 同时写回 `start` 和 `end`，保持端点结构完整。

普通数值仍沿用现有 `both/start/end` 分支；文字和 Shader 只进入公共字段分支，不触碰端点值。

## 6. 受影响的代码面

### Core

- `src/core/edit/multiEdit/eventTargets.ts`（新模块）
- `src/core/edit/multiEdit/planVocabulary.ts`：事件字段、`BatchEditOptions` 多目标类型、RGB 字段词汇
- `src/core/edit/multiEdit/plan.ts`：多目标过滤、family/field 校验、RGB 通道写入
- `src/core/edit/multiEdit/parameters.ts`：保持草稿 schema 不含目标集合；必要时加入字段归一化辅助
- `src/frontend/screens/editor/inspector/multiEdit/multiEditCommit.ts`：候选类型过滤并保持稳定顺序

### Frontend

- `MultiEditForm.tsx`：数组状态、复选下拉、禁用规则、按 family 过滤字段
- `MultiEditPane.tsx`：区分 available 与 selected，透传新接口
- `multiEdit.ts`：读取/刷新/预览/commit 全链路传 `eventTypes`
- `EventCloneForm.tsx`：若共享 `setEventTypes` 接口，改用同一数组适配层；clone 本身仍只使用其已有的轨道语义
- 设计系统样式：仅在没有可复用列表复选样式时增加局部 class，不修改 `.scratch/dev/ports.json`

### i18n

为新增 RGB 字段补齐中英文键，建议使用：

- `editor.commands.multiEdit.eventField.red`
- `editor.commands.multiEdit.eventField.green`
- `editor.commands.multiEdit.eventField.blue`

如果空选、字段不兼容或多选摘要需要新提示，必须同时加入 `en` 和 `zh`，保持 catalog key parity。

## 7. 不在本次范围内

- 不把 Beat 做成事件类型组。
- 不把 `NOISE_ACTIVE_EVENTS` 加入多选列表。
- 不创建当前选区不存在的事件。
- 不批量替换文字内容。
- 不批量修改 Shader 名称、Shader uniform 或参数轨道。
- 不把不同值形态强行转换成同一类型。
- 不改变 clone 页的目标行/通道语义。
- 不改变事件轨道的排序、绘制或存档格式。

## 8. 验证计划

### 纯函数与 planner

- 值形态映射覆盖所有 `EVENT_TRACKS`，噪声返回不可选。
- 同类类型可以合选，异类类型不能合选，空选择可重新选择任何类型。
- 候选类型去重、排除噪声、按 `EVENT_TRACKS` 稳定排序。
- 多目标普通数值预览：每个轨道都产生 changes，且不同轨道的分布互不串组。
- 缺失轨道只跳过，不创建新事件。
- RGB 的 R/G/B 修改同时作用于 start/end，并正确 clamp 到 0–255。
- 文字/Shader 的公共字段可以预览；端点值字段被拒绝。
- 旧单值 `eventType` 可以适配成单元素数组。

### 表单交互

- 默认只选第一项。
- 同类项目可以勾选，异类项目 visible + disabled。
- 取消最后一项后全部重新可选；空选时不能应用。
- 选区变化保留仍存在的选择，不自动加入新候选项。
- 字段菜单随 family 变化；`t1/t2` 仍渲染 Beat 控件。
- 中英文标签和提示键集合一致。

### 仓库门禁

按仓库约定执行：

1. `npm run dev`
2. 定向 `node --test src/test/<topic>/<subject>.test.mjs`
3. `npm run check`
4. `npm run verify`

本次只改编辑器源代码和文档，不做桌面打包；不编辑或提交 `.scratch/dev/ports.json`。

## 9. 实现顺序

1. 先落地 `eventTargets` 纯函数和 planner 的多目标/字段校验。
2. 为 RGB 字段补充词汇与 i18n，并覆盖 planner 测试。
3. 改表单值模型和多选列表，接入 family 禁用规则。
4. 改 panel model 的候选集合、刷新和 recipe 适配。
5. 加 UI/交互测试，执行定向测试、`check`、`verify`。

设计的核心接口只有一个：事件类型选择永远先经过值形态模块，再由表单和 planner 各自消费同一个兼容结果。这样交互规则和实际写入规则不会在两个地方逐渐分叉。
