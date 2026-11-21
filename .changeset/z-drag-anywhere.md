---
"rpe-redux": patch
---

### 中文

**变更**

- 按住 `Z` 时，只要事件或 Hold 处于单选状态，就可以在时间轴任意位置按下：单击会把对应头/尾直接落到指针所在拍，拖动则实时预览（检查器的开始/结束拍和时间轴上的头尾数值同步跟随）并在松开时提交，与 RPE 的行为一致；没有单选对象时，仍可从对象本身开始拖动。

### English

**Changed**

- With `Z` held, a single selected event or Hold can be trimmed from anywhere in the timeline: a click moves that edge to the pointer row, and a drag previews the change live (the inspector's start and end fields and the timeline's head and tail value labels follow) and commits on release, matching RPE. Starting on the object itself still works when there is no single selection.
