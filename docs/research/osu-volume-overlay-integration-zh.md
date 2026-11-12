# osu!lazer 音量浮层与 RPE Redux 接入调研

## 结论

用户看到的功能不是编辑器左侧的持久化侧栏，而是 osu!lazer 的全局左浮层 `VolumeOverlay`。它平时挂载但隐藏；用户通过音量快捷键或符合条件的滚轮事件唤起它，面板显示在左侧并短暂保留。面板中有 Master、Music、Effect、Hitsound 四个可切换的音量表。

RPE Redux 可以复用现有的 Web Audio 增益节点和设置 schema，但不能直接把这个浮层塞进当前的 Sidebar registry：Redux 的 Sidebar 是右侧的导航 rail，而音量浮层属于窗口级瞬时反馈。建议先把“全局音频状态”和“全局输入分发”抽成稳定 seam，再决定是否做完全等价的浮层。

## osu!lazer 是怎样触发的

### 1. 浮层的位置和生命周期

`OsuGame` 创建全局 `VolumeOverlay`，把它加入 `leftFloatingOverlayContent`，并同时加入一个全局的 `ScrollAdjustsVolume(requireAltPressed: true)`。因此左侧位置来自全局浮层容器，不是编辑器侧栏注册表；浮层在应用启动后就存在，等待输入触发。

- [OsuGame.cs](https://github.com/ppy/osu/blob/master/osu.Game/OsuGame.cs)
- [VolumeOverlay.cs](https://github.com/ppy/osu/blob/master/osu.Game/Overlays/VolumeOverlay.cs)

### 2. 键盘快捷键

当前默认绑定属于 `audioControlKeyBindings`：

| 绑定          | action                | 作用               |
| ------------- | --------------------- | ------------------ |
| `Alt + Up`    | `IncreaseVolume`      | 调高当前选中的通道 |
| `Alt + Down`  | `DecreaseVolume`      | 调低当前选中的通道 |
| `Alt + Left`  | `PreviousVolumeMeter` | 切换到上一个通道   |
| `Alt + Right` | `NextVolumeMeter`     | 切换到下一个通道   |
| `Ctrl + F4`   | `ToggleMute`          | 切换 Master 静音   |

`OsuGame.OnPressed()` 对增减音量 action 先直接转发给 `volume.Adjust()`，因此这两个 action 不走后面的“禁止按键重复”分支；切换通道和静音则在重复按键过滤之后处理。也就是说，按住 `Alt+Up/Down` 可以连续调节，且不要求当前处于某个特定屏幕。

- [GlobalActionContainer.cs](https://github.com/ppy/osu/blob/master/osu.Game/Input/Bindings/GlobalActionContainer.cs)
- [OsuGame.cs](https://github.com/ppy/osu/blob/master/osu.Game/OsuGame.cs)

### 3. Alt + 滚轮

全局 `ScrollAdjustsVolume` 处理未被其他控件消费的滚轮事件：

1. 必须按住 `Alt`。
2. `Ctrl`、`Shift`、`Super` 任一同时按下时拒绝处理。
3. 如果鼠标悬停链上有实现 `IBlockGlobalAltScrollVolume` 的控件，也拒绝处理，让该控件保留自己的 Alt+滚轮语义。
4. 将滚轮方向和精细滚轮信息转给 `VolumeOverlay.Adjust()`。

- [ScrollAdjustsVolume.cs](https://github.com/ppy/osu/blob/master/osu.Game/Overlays/Volume/ScrollAdjustsVolume.cs)
- [IBlockGlobalAltScrollVolume.cs](https://github.com/ppy/osu/blob/master/osu.Game/Input/IBlockGlobalAltScrollVolume.cs)

这里有一个重要的交互细节：当浮层是隐藏状态时，第一次增减 action 只执行 `Show()`；浮层可见后，下一次 action 才对当前选中的音量表执行增减。因此第一次 Alt+滚轮可能只看到面板而不改变数值，这是设计行为，不是丢事件。

osu!lazer 的自动隐藏延迟约为 1 秒；鼠标仍悬停在浮层上时会重新计时。浮层重新从隐藏状态显示时默认重新聚焦 Master。以上行为都在 `VolumeOverlay.Adjust()`、 `Show()` 和 `schedulePopOut()` 中实现。

- [VolumeOverlay.cs](https://github.com/ppy/osu/blob/master/osu.Game/Overlays/VolumeOverlay.cs)

### 4. 浮层展示哪些音量

当前实现绑定四个值：

- Master：`audio.Volume`
- Music：`audio.VolumeTrack`
- Effect：`audio.VolumeSample`
- Hitsound：`OsuSetting.HitsoundVolume`

其中 Effect 和 Hitsound 是两个不同概念。Effect 是游戏/界面采样音频总线，Hitsound 是游戏设置中的击打音效值。每个 `VolumeMeter` 既能处理滚轮，也能处理垂直拖拽；数值变化会触发浮层显示并播放刻度声。

- [VolumeOverlay.cs](https://github.com/ppy/osu/blob/master/osu.Game/Overlays/VolumeOverlay.cs)
- [VolumeMeter.cs](https://github.com/ppy/osu/blob/master/osu.Game/Overlays/Volume/VolumeMeter.cs)
- [MasterVolumeMeter.cs](https://github.com/ppy/osu/blob/master/osu.Game/Overlays/Volume/MasterVolumeMeter.cs)

### 5. 编辑器中的已知冲突

osu!lazer 的默认 action 枚举把编辑器 action 放在音量 action 之前，并明确说明本地屏幕应优先于全局 action。编辑器同时会消费滚轮做时间线、吸附或距离相关操作，所以 Alt+滚轮并非在所有编辑器状态都能自然落到全局音量 fallback。

官方讨论明确记录了“编辑器里的 Alt+滚轮缺失/损坏”，推荐的临时方式是 `Alt+Up/Down`，或在设置中自行把 Alt+滚轮绑定到音量 action。官方 issue 还记录了不同屏幕中滚轮被消费、按键重复和全局音量 overlay 之间的边界问题。

- [GlobalActionContainer.cs](https://github.com/ppy/osu/blob/master/osu.Game/Input/Bindings/GlobalActionContainer.cs)
- [Can't change game volume in the editor #38132](https://github.com/ppy/osu/discussions/38132)
- [Can't change volume using Alt+mouse wheel in certain screens #31675](https://github.com/ppy/osu/issues/31675)
- [Holding keys / cannot scroll in some screens #31267](https://github.com/ppy/osu/issues/31267)

## RPE Redux 当前可复用的部分

### 音频增益已经存在

`AudioTransport` 已经有独立 master 增益：

- `volume` 默认 `0.75`。
- `ensureContext()` 创建 `gain -> backgroundGain -> destination` 图。
- `setVolume()` 直接更新 master `GainNode`，并把值限制在 `[0, 1]`。
- `setBackgroundVolume()` 通过 ramp 处理窗口失焦/后台衰减。

`HitSounds` 还有自己的增益层：

- `volume` 是 hitsound 总增益，默认 `0.3`。
- `soundVolumes` 按 `tap`、`drag`、`flick`、`custom` 分通道。
- `setVolume()` 更新 hitsound 总增益，并把四个通道恢复到同一比例。
- `setSoundVolume()` 更新单个通道的相对增益。

对应实现：

- `src/core/media/audio.ts`
- `src/core/media/hitsounds.ts`
- `src/frontend/screens/editor/workspace/runtime/providers/PreviewProvider.tsx`

### 设置 schema 已经覆盖大部分数据

`src/core/settings/features/audio.ts` 已注册：

- `volume`
- `background-volume`
- `hitsound-tap`
- `hitsound-drag`
- `hitsound-flick`
- `hitsound-custom`
- 各 hitsound offset

这意味着新 UI 不需要新建音频数值模型；但需要让运行中的 `AudioTransport`、 `HitSounds` 和设置值之间形成统一的绑定/更新路径。当前设置 schema 是定义，不能自动替代运行时增益更新。

### 快捷键模型已经支持所需输入

`src/core/shortcuts/keys.ts` 已把 `WHEELUP`、`WHEELDOWN` 作为一等 key，且支持 `ALT` modifier；`keyMatching.ts` 负责匹配 wheel delta 和 modifier。也就是说，重新绑定 Alt+滚轮不需要扩展快捷键语法。

## 接入时需要克服的主要困难

### 1. 没有单一的全局音频总线

编辑器预览在 `PreviewProvider` 中创建 `AudioTransport` 和 `HitSounds`，它们随编辑器运行时创建和销毁。首页 library preview 则由 `src/frontend/screens/welcome/library/libraryPreviewAudio.ts` 单独管理一个媒体元素和自己的 master/background 处理。

因此如果浮层要像 osu!lazer 一样在首页、编辑器、设置页都有效，必须先回答：

- Master 是否同时控制编辑器音乐、hitsound 和首页 preview？
- Music/Effect/Hitsound 在首页没有对应播放通道时如何显示和保存？
- 打开/关闭文档、切换项目、编辑器重建 runtime 时，浮层绑定如何不悬空？
- 后台衰减是全局乘数还是某个 transport 的局部乘数？

如果不先抽出全局 mixer seam，直接在 React 组件里读取某个 `PreviewRuntime`，很容易出现“编辑器里能调、回到首页失效”或“旧 runtime 被调”的问题。

### 2. 当前快捷键 dispatcher 主要挂在编辑器 runtime

`registerEditorKeyboardBindings()` 安装了窗口级 `keydown`，并把 editor action 和 registered shortcut 一起分发；canvas 还在 capture phase 处理 pointer/wheel。该绑定由编辑器 runtime 创建，而不是 `App` 的常驻 app-level dispatcher。

如果音量 action 只放进现有编辑器 dispatcher，它会天然受文档是否打开、编辑器 surface、modal 和 canvas 生命周期影响，无法达到 osu!lazer 的全局行为。若把它做成独立 `window` listener，又会绕过现有 shortcut registry、重绑设置、冲突检测和 modal 优先级。

较稳妥的方向是：给 shortcut dispatcher 增加常驻的 app/instrument 级入口，或把当前 dispatcher 的全局部分上移到 `App`；音量 action 仍注册在 shortcut registry，不要在音量组件中再维护一套键盘解析。

相关实现：

- `src/frontend/platform/shortcuts/editorKeyboard.ts`
- `src/frontend/platform/shortcuts/canvasShortcuts.ts`
- `src/core/shortcuts/scope.ts`
- `src/core/edit/shortcuts/shortcutCatalog.ts`

### 3. 滚轮会和时间线交互争抢所有权

当前编辑器对滚轮有明确语义：时间线导航、行切换、跳转和缩放。全局 Alt+滚轮若在 capture 阶段先截获，会破坏时间线；若在 bubble 阶段等待，又可能已经被 canvas 或时间线 `preventDefault()`/停止传播。

需要明确一个产品规则：

- `Alt+滚轮` 在编辑器时间线始终调音量；还是
- 只有鼠标不在时间线/画布上时调音量；还是
- 保留当前时间线语义，音量只用 `Alt+Up/Down` 和浮层内滚轮。

建议第一版采用最后一种或“只在非时间线区域 fallback”，并写交互测试，避免复刻 osu!lazer 已经遇到的 screen-specific regression。

### 4. “左栏”与现有 Sidebar 不是同一个概念

Redux 的 `src/frontend/chrome/sidebar/Sidebar.tsx` 是右侧、常驻、图标导航 rail，由 `src/core/shell/registries/sidebar.ts` 提供 inspector/drawer 路由。把四个音量表作为 sidebar item 会让音量面板变成导航页，还会污染 inspector 路由和 active state。

若目标是复刻 osu!lazer 的体验，应在 `src/frontend/overlays/` 增加窗口级、左侧、自动隐藏的 transient overlay，并把它挂在 `App.tsx` 的 root overlay 层。若目标是常驻调音台，则应放入 transport/toolbar，而不是 Sidebar registry。

### 5. 不同音量的语义和持久化需要先定下来

当前 Redux 的 master music、hitsound 总音量、四种 hitsound 子音量和 background volume 分属不同用途。osu!lazer 的 Effect 与 Hitsound 也不是同一通道。

需要避免一个含糊的“音效”滑块同时改动：

- UI/编辑器反馈音；
- note hitsound；
- 首页 chart preview；
- 窗口失焦衰减。

建议 UI 显示为 `Master / Music / Effects / Hitsounds`，其中 `Effects` 必须先定义 Redux 是否有真正的 UI SFX bus；如果没有，第一版应明确把它标成 unavailable 或把现有 task-completion sound 等 UI 音效接入独立 bus，而不是误映射到 hitsound。

## 推荐的实现拆分

### Phase 1：编辑器内的最小闭环

1. 不改 Sidebar registry。
2. 在 editor overlay host 中增加左侧 transient `AudioVolumeOverlay`。
3. 只绑定现有 editor `AudioTransport`、`HitSounds` 和 settings values。
4. 快捷键先提供 `Alt+Up/Down`、`Alt+Left/Right`，由现有 registry 分发。
5. 浮层内部支持 wheel/drag；编辑器外不宣称全局生效。
6. 增加 focused tests：显示/自动隐藏、首次 action 行为、通道切换、master/hitsound 增益同步、快捷键冲突和编辑器时间线滚轮不被误吞。

这是低风险版本，能先验证交互和视觉，而不会立即重构首页预览音频。

### Phase 2：真正的应用级音量控制

1. 在 `core/media/` 建立应用级 audio mixer/bus，至少提供 master、music、effects、hitsounds 四个可观察值。
2. 让 editor `AudioTransport`、`HitSounds` 和 library preview 都接入同一套值；背景衰减作为独立乘数叠加，不能覆盖用户设置值。
3. 将 app/instrument shortcut dispatcher 挂到 `App` 生命周期，保留 modal/capture 优先级和可重绑定能力。
4. 在窗口级 overlay host 渲染左侧浮层；无可用通道时禁用相应 meter，而不是显示一个看似可调但没有效果的数值。
5. 明确 Alt+滚轮和编辑器时间线的优先级，并覆盖首页、编辑器、设置、弹窗、输入捕获和失焦状态的 e2e 测试。

## 最终建议

值得加入，但建议把它定义为“全局音频浮层”，而不是“左侧栏音量组件”。如果当前需求只是编辑器里快速试听，Phase 1 已足够，预计工作量主要在 UI、编辑器 runtime 绑定和输入测试；如果需求是完全复刻 osu!lazer 的跨页面行为，先做 Phase 2 的音频总线和 app-level dispatcher，否则后续会被首页预览、编辑器滚轮冲突和 runtime 生命周期反复牵制。
