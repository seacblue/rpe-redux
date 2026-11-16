# Note timeline X 坐标范围控制（设定稿）

- 状态：实现稿
- 范围：note timeline 的横向 X 坐标视口，不改变谱面数据
- 相关原型：[note-timeline-navigator.html](../prototypes/note-timeline-navigator.html)
- 相关示意图：[主方案](./note-timeline-navigator.svg)、[状态图](./note-timeline-navigator-states.svg)

## 1. 结论

note timeline 的默认 X 视口为：

```text
-675 ├──────────────────────────────┤ 675
```

底部提供三个小按钮：

```text
        ◀       ⌂       ▶
      左移     回归     右移
```

- 左移、右移：每次把 X 视口移动 `150`，减少需要连续点击的次数。
- 回归：把 X 视口中心恢复为 `cameraX = 0`。
- 相机移动使用缓动，不会瞬间跳到目标位置；按住左右按钮会持续以小步移动，并保持按压反馈。
- 控件不移动歌曲时间、不移动播放头、不切换判定线、不改变 note 数据。
- 控件作为 note timeline 底部的浮层出现，类似事件 timeline 底部的 layer strip；不增加新的 grid row，不改变 timeline 高度。

## 2. 视口模型

`cameraX` 是当前 note timeline 的 X 坐标中心。每个 note timeline 都使用同一个可见范围：

```text
visibleMin = cameraX - 675
visibleMax = cameraX + 675
```

多线编辑时，每条可见的 note timeline 使用同一个 `cameraX`，按钮只移动所有 note timeline 的 X 视口，不移动或重新排列 panel。

`cameraX` 继续复用现有 timeline viewport 的投影和命中测试，因此绘制、编辑、拖拽看到的是同一个 X 范围。

## 3. 浮层位置

浮层挂在 note field 自己的 grid cell 上：

- note 与 event 同时显示时，浮层位于 note timeline 的底部。
- multi-line note 模式时，浮层仍然只出现一组，覆盖在整个 note timeline 的底部，不按 panel 数量复制。
- event 模式时隐藏 note 浮层。
- note timeline 隐藏时隐藏浮层。
- 浮层使用 `align-self: end` 和 `z-index` 叠在 canvas 上，不占额外高度。
- 三个按钮使用现有 `IconButton` 尺寸和 tooltip，不添加自定义按钮形状。

## 4. 离屏竖线与当前拍提示

不再绘制整块离屏背景，也不新增离屏颜色设置。竖向网格线以默认 `-675..675` 范围内的 spacing 为基准，移动到非常规 X 范围后继续按同样的 spacing 和水平倍率绘制，不在接缝处压缩或重新铺排。归位按钮在 `cameraX = 0` 时 disabled，偏离默认范围后 enabled。

中心竖线仍使用现有的中心竖线颜色和粗细；离屏延伸的普通网格线继续使用普通竖线颜色，不覆盖中心线。

当前拍 note 越过某条 timeline 边缘时，只在对应边缘出现 note 高度范围内的白光 indicator：

- 白条只检查当前 playhead 这一拍的 note。
- 每条 note timeline 单独判断自己的左右边界。
- note 的横向主体越过当前 timeline 左边界，显示左白条；越过右边界，显示右白条。
- note 完全在视口外也显示对应一侧白条，不要求 note 主体仍可见。
- 当前拍没有越界 note 时不显示白条。
- 白光 indicator 使用主题前景色和轻微 glow，不修改 note 本身颜色。
- indicator 不绘制全高边缘线，只覆盖当前 note 的垂直范围。

多线时，白条画在对应 note timeline 的左右边缘，而不是整个多线 canvas 的最外侧。

## 6. 多线、缩放与提示

### 多线

所有可见 note timeline 共用 `cameraX`，只显示一组底部浮层。移动后所有 timeline 同步改变 X 范围；判定线数量、panel 顺序和 active line 不变。

### 缩放

- 纵向时间缩放继续使用现有 timeline scale。
- X 视口按钮只做平移，不引入第二套水平缩放。
- 每次移动 `150` X 单位；持续按住时重复移动，仍可通过缓动和长按完成精细调整。
- 浏览器缩放和高 DPI 只影响 CSS/canvas 像素，不改变 `cameraX` 的坐标含义。

### 渐进式出现

浮层本身稳定显示，但相机移动采用缓动：

- note timeline 可见时，浮层固定在底部。
- 回归按钮在 `cameraX = 0` 时 disabled。
- 左右按钮始终可用，因为 X 坐标没有固定最大边界。
- 白条只在当前拍存在越界 note 时出现。
- 左右按钮按住超过短暂延迟后开始重复移动，按钮保持 active 状态作为反馈。
- 偏离默认范围后网格线继续延伸；归位后回到默认 `-675..675` 网格范围。

后续如果需要降低遮挡，可以只降低浮层和白条的对比度，再在 hover/focus 时恢复；不能通过改变布局高度来出现或消失。

## 7. 交互与提示

- 左按钮 tooltip：`向左移动音符可见范围`
- 中间按钮 tooltip：`回到默认 X 坐标范围`
- 右按钮 tooltip：`向右移动音符可见范围`
- 浮层使用 `role="group"` 和独立 aria label。
- 不使用“上一页/下一页”措辞，避免用户误以为移动的是歌曲时间。
- 按钮操作不写入编辑历史，但会保留现有 display preference 的持久化行为。
- 单击移动 `150`；长按连续重复移动，不改变歌曲时间或编辑历史。

## 8. 验收标准

- 单线 note timeline 底部可以看到三个按钮，且不增加 timeline 高度。
- multi-line note timeline 只出现一组浮层，所有 note timeline 同步改变 X 范围。
- event timeline 不显示 note X 范围浮层。
- `cameraX = 0` 时可见范围为 `-675..675`，归位按钮 disabled，中心竖线保持原有颜色。
- 偏离默认范围后不绘制红色或其他离屏背景，普通竖向网格线按相同 spacing 和倍率延伸。
- 当前拍越过某条 note timeline 左边界时只显示左侧 note 高度白光，越过右边界时只显示右侧对应提示；两侧都有越界时两侧都显示。
- 亮色模式下 indicator 使用深色主题前景色并保留 glow，保证对比度。
- 非当前拍的 note 不产生白条。
- 点击回归后回到 `cameraX = 0`，所有 timeline 同步恢复默认 X 范围。
