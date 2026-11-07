# Ctrl 前缀跳转判定线研究

## 结论

需求可行，但不能作为一条普通的 `Ctrl+数字串` 快捷键注册。当前快捷键模型表达的是“一个 key 加一组 modifiers”，解析器也只接受一个非修饰键。因此实现应是一个编辑器专用输入状态机：

```text
按下 Ctrl → 累积数字 → 松开 Ctrl → 严格解析并跳转
```

普通快捷键表最多注册一个裸 `CTRL` 作为设置页里的入口提示；数字串应由专用控制器处理。

本文基于 `main`（`2913488c`）的代码事实，并把设计建议单独标出。

## 当前代码事实

### 1. 快捷键不能写成 `CTRL+123`

- [`src/core/shortcuts/types.ts`](../../src/core/shortcuts/types.ts#L43-L48) 的 `Shortcut` 只有一个 `key` 和可选 `modifiers`。
- [`src/core/shortcuts/keys.ts`](../../src/core/shortcuts/keys.ts#L168-L203) 的解析器允许裸修饰键，但普通组合必须恰好有一个非修饰键。
- 实测：`parseShortcut("CTRL")` 成功，`parseShortcut("CTRL+123")` 返回 `shortcuts.error.unsupportedKey`。
- [`src/core/shortcuts/registry.ts`](../../src/core/shortcuts/registry.ts#L352-L369) 每次事件只返回第一个匹配的注册快捷键，没有序列或前缀缓冲。

仓库已有裸修饰键先例：`sampling.hideGuides` 默认绑定为 `SHIFT`，并在 [`src/test/editor/sampling/samplingShortcuts.test.mjs`](../../src/test/editor/sampling/samplingShortcuts.test.mjs#L42-L63) 覆盖了解析、匹配和录制。

### 2. 裸 Ctrl 当前有两个边界缺口

运行时匹配已经特殊处理了 `Control` 到 `CTRL` 的映射：[`src/core/shortcuts/keyMatching.ts`](../../src/core/shortcuts/keyMatching.ts#L94-L121)。但录制流程和释放判断不完全一致：

- [`src/frontend/screens/settings/shortcuts/shortcutCapture.ts`](../../src/frontend/screens/settings/shortcuts/shortcutCapture.ts#L68-L80) 捕获裸控制键时保存候选 `{ key: "CONTROL", modifiers: [] }`。
- [`src/core/shortcuts/keys.ts`](../../src/core/shortcuts/keys.ts#L374-L391) 没有把 `CONTROL` 规范化成 `CTRL`，所以这个候选提交到注册表时会被判为 `shortcuts.error.unsupportedKey`。
- [`src/core/shortcuts/keyMatching.ts`](../../src/core/shortcuts/keyMatching.ts#L153-L168) 的 `released()` 也没有先把事件的 `CONTROL` 规范化成 `CTRL`；实测 `released({ key: "Control" }, { key: "CTRL" })` 为 `false`。

如果采用裸 `CTRL` 作为前缀，应该先统一事件、录制候选和已存绑定的规范化规则，并补裸 Ctrl 的录制、匹配、释放回归测试。

### 3. 当前派发顺序会造成抢占风险

- [`src/frontend/platform/shortcuts/editorKeyboard.ts`](../../src/frontend/platform/shortcuts/editorKeyboard.ts#L113-L145) 先匹配编辑器快捷键，再匹配注册表快捷键。
- 注册快捷键命中后会在 [`src/frontend/platform/shortcuts/editorKeyboard.ts`](../../src/frontend/platform/shortcuts/editorKeyboard.ts#L176-L179) 调用 `preventDefault()` 和 `stopPropagation()`。
- 编辑器快捷键与注册快捷键都通过现有匹配表；扩展快捷键也会进入注册表。
- [`src/core/shortcuts/registry.ts`](../../src/core/shortcuts/registry.ts#L191-L213) 的冲突检查只按 `canonicalText` 的完全相等分组。因此 `CTRL` 与 `CTRL+1` 不会被报告为冲突，即使新的输入模式在运行时会观察同一组按键。

当前默认快捷键没有发现 `Ctrl+数字`，但用户配置或扩展可以注册它。

### 4. 现有的“跳转并变成单线”路径可以复用

[`src/frontend/screens/editor/workspace/runtime/composition/EditorAssembly.ts`](../../src/frontend/screens/editor/workspace/runtime/composition/EditorAssembly.ts#L474-L486) 的 `selectOverviewLine` 已经完成：

1. 检查索引为整数且判定线存在；
2. 取消批量控件和时间线放置；
3. 将 `editorLineSelection` 替换为 `[index]`；
4. 调用 `session.current.selectLine(index)`。

随后 [`src/frontend/screens/editor/workspace/runtime/bindings/editorBindings.ts`](../../src/frontend/screens/editor/workspace/runtime/bindings/editorBindings.ts#L162-L178) 会同步单线选择；[`src/core/edit/session/session.ts`](../../src/core/edit/session/session.ts#L245-L255) 在选择长度小于 2 时关闭多线模式。因此新功能不应另写一套“强制单线”规则，应该复用这个入口。

## 设计建议

### 快捷键如何写

推荐把它声明成编辑器导航能力，设置页显示裸 `Ctrl`，标题和提示明确写成：

> 按住 Ctrl，输入判定线编号，松开 Ctrl 跳转；编号从 0 开始。

但裸 `CTRL` 不能直接走普通命令执行路径：当前派发器会把匹配的注册快捷键当作已处理事件，可能阻断 `Ctrl+C`、`Ctrl+V`、`Ctrl+Z`。应由编辑器专用控制器监听前缀、数字和释放，只在确实消费数字输入时阻止默认行为；或者给快捷键声明增加明确的“被观察但不消费”语义。

如果产品接受输入框体验，`Ctrl+L` 或 `Ctrl+G` 打开线号输入框是更小、可访问性更好且完全兼容现有模型的替代方案。

### `Ctrl+数字` 已被占用时

第一版建议采用“显式绑定优先”：

1. `Ctrl+数字` 到来时先让现有编辑器、注册表和扩展快捷键按正常优先级匹配；
2. 有命令绑定时执行命令并取消当前数字缓冲；
3. 没有命令绑定时才把数字加入跳转缓冲。

这样不会让用户已经明确绑定的命令静默失效。代价是：如果 `Ctrl+1` 已被占用，用户就不能在同一次手势里输入包含该数字的编号；设置页和键盘文档必须说明这一点。

如果产品要求所有数字都必须可输入，则应改为保留 `Ctrl+0` 到 `Ctrl+9`，拒绝新的同类绑定，并在加载已有配置或扩展绑定时显式显示冲突。无论选择哪种策略，扩展快捷键都必须纳入仲裁，不能只检查内置编辑器快捷键。

不建议让手势静默优先并吞掉已有的 `Ctrl+数字` 命令。

### 错误编号是否弹 Toast

建议按结果区分：

| 输入结果             | 行为                   | Toast      |
| -------------------- | ---------------------- | ---------- |
| 只按 Ctrl，没有数字  | 不提交、不改变当前线   | 不弹       |
| 合法且存在的编号     | 跳转，并替换为单线选择 | 不弹       |
| 完整输入但编号不存在 | 保持当前线不变         | 弹 warning |
| 当前没有打开谱面     | 手势不启用或直接取消   | 不弹       |

Toast 应是用户输入反馈，不应走诊断错误或 modal。建议使用短 warning，并用固定 key 合并连续失败，避免用户快速试号时刷屏。当前 Toast 系统支持 `warning`、自定义时长和按 `key` 合并：[`src/design/patterns/ToastHost.tsx`](../../src/design/patterns/ToastHost.tsx#L50-L65)、[`src/design/patterns/ToastHost.tsx`](../../src/design/patterns/ToastHost.tsx#L278-L306)。默认 warning 时长为 8 秒：[`src/design/patterns/toastLifecycle.ts`](../../src/design/patterns/toastLifecycle.ts#L50-L58)；这里可使用约 4 秒。

不要静默 clamp 到最后一条线。工具栏输入框目前会 clamp（[`src/core/edit/state/lineSelectionInput.ts`](../../src/core/edit/state/lineSelectionInput.ts#L5-L8)、[`src/core/edit/state/lineSelectionInput.ts`](../../src/core/edit/state/lineSelectionInput.ts#L64-L100)），但快捷手势没有可见的编辑字段，clamp 会把输错编号伪装成成功。建议使用严格的单索引解析器；保留 0-based 语义，允许前导零，并在提交时重新校验当前谱面的判定线列表。

## 输入状态机的边界

实现时应明确以下规则，并为状态机单测覆盖：

- 忽略 `event.repeat`，避免长按数字变成重复编号；
- `event.isComposing` 时不接管输入；
- 限制最大数字位数，超出按无效编号处理；
- `Escape`、失焦、打开 modal、切换到文本输入、`Ctrl+wheel` 或 pointer 操作时清空缓冲；
- 采样、曲线编辑、批量控件和拖拽等会改变编辑上下文的操作进行中时禁用手势；
- 提交时再次读取 `chart.judgeLineList[index]`，防止输入期间谱面发生变化；
- `Ctrl+0` 在 WebView2 打包环境中需要实测是否触发浏览器缩放重置，必要时仅在确认消费该数字时阻止默认行为。

## 推荐实现拆分

1. 先修复 `CONTROL`/`CTRL` 的规范化、释放判断和测试。
2. 在 core 中加入严格的单判定线编号解析结果（empty / valid / missing）。
3. 在编辑器快捷键层增加独立的 Ctrl 前缀状态机；不要把数字串伪装成普通快捷键。
4. 复用 `selectOverviewLine`，让现有单线选择同步机制负责关闭多线模式。
5. 在编辑器 feedback seam 上增加缺失判定线的 warning Toast 和中英文文案。
6. 补状态机、快捷键冲突、裸 Ctrl 回归、越界 Toast 和单线选择测试，再按仓库要求验证。
