# 主题包

主题包是数据，不是代码。它提供一组 CSS 自定义属性、可选的 PNG 图标覆盖，以及可选的 **外观配方（chrome recipe）**，用来选择窗口框架的布局、表面和动效预设。 `src/core/theme/packages.ts` 负责模式与校验，`src/core/theme/registry.ts` 负责注册， `src/core/theme/applyTheme.ts` 解析当前主题，`src/frontend/app/themeChrome.less` 把预设渲染为样式。宿主只读写文档，从不执行主题包。

随应用发布的主题是构建期源目录；可分发的主题或拖入的主题是单个 JSON 文档。英文指南见 [README.md](README.md)。

```text
dark/                  随应用发布的参考主题
  package.json
  icons/
    add.png
    folder_open.png
    settings.png
light/                随应用发布的亮色参考主题
  package.json
```

## 清单

```json
{
  "schemaVersion": 2,
  "kind": "theme",
  "id": "example-theme",
  "name": { "en": "Example", "zh": "示例" },
  "version": "1.0.0",
  "appearance": "dark",
  "colors": { "--accent": "#a8c7fa" },
  "icons": {},
  "chrome": {
    "layout": {
      "density": "spacious",
      "inspector": "floating",
      "inspectorSide": "right",
      "sidebar": "floating",
      "toolbar": "floating",
      "toolbarPlacement": "left",
      "transport": "floating",
      "transportAnchor": "bottom-right",
      "transportDraggable": true,
      "statusBar": "floating"
    },
    "surface": {
      "shape": "round",
      "material": "glass",
      "backdropBlur": 16,
      "pattern": "none",
      "ambient": "aurora"
    },
    "motion": {
      "level": "expressive",
      "speed": "normal",
      "hover": "glow",
      "entrance": "rise"
    }
  }
}
```

| 字段 | 约定 |
| --- | --- |
| `schemaVersion` | `2`。已安装的模式 `1` 主题仍可加载；省略的 `chrome` 成员使用默认值。 |
| `kind` | `"theme"`。带 `kind: "icons"` 且没有调色板的文档会规范化为暗色主题包。 |
| `id` | 稳定 id：小写字母或数字开头，后接小写字母、数字、`.`、`_` 或 `-`。 |
| `name` | 字符串或语言到字符串的映射；取当前语言、英语，最后取第一项。 |
| `version` | 可选版本字符串，默认 `1.0.0`。 |
| `author` | 可选作者字符串。 |
| `appearance` | `dark` 或 `light`。部分覆盖的亮色主题会继承内置亮色调色板。 |
| `actionForeground` | 可选，把 `resting`、`hover`、`focus`、`pressed`、`disabled`、`emphasized` 映射到 `normal` 或 `inverse`。 |
| `colors` | 已发布的颜色 token 词汇表（`src/core/theme/colorTokens.ts`）；值只能是十六进制、`rgb`/`hsl` 形式或 `transparent`。 |
| `icons` | 可选的图标名到 PNG 映射。随应用发布的源主题使用相对 `.png` 路径；分发文档使用 PNG data URL。 |
| `chrome` | 可选的布局、表面、动效配方。每个成员都是封闭预设；省略的成员使用下方默认值。 |
| `ui` | 可选的声明式槽位/组件树。树使用宿主原语和绑定字段，不包含 HTML、CSS 或代码。 |

未指定的颜色继承声明外观对应的内置调色板，因此只改强调色的主题不会破坏其余界面的可读性。动作前景按声明的 normal 或 inverse 选择；对比度低于 4.5:1 时回退到更可读的候选颜色。

## 外观配方

配方只控制表现。它选择宿主提供的槽位、表面和有界尺寸；不能提供标记、隐藏标题栏、菜单、工具栏或检查器，不能改变窗口行为，也不能注入样式表。渲染器把每个名字映射到宿主自带的 CSS 和 React 槽位。`toolbarOrder` 只按 ID 重排已注册命令，不能新增、删除或改名。

### 布局

| 字段 | 值 | 默认 | 效果 |
| --- | --- | --- | --- |
| `density` | `compact`、`comfortable`、`spacious` | `comfortable` | 控件高度与设计间距节奏。 |
| `inspector` | `docked`、`floating`、`overlay` | `docked` | 检查器保留列、变成内缩卡片，或浮在工作区上方（不超过窗口一半宽度）。 |
| `inspectorSide` | `left`、`right` | `right` | 检查器停靠在哪一侧。 |
| `sidebar` | `rail`、`floating`、`top`、`inspector` | `rail` | 右侧栏贴边、变成卡片、变成顶部横条，或把注册按钮移进检查器空态做双栏文字网格。 |
| `toolbar` | `docked`、`floating` | `docked` | 工具栏贴边或变成抬升卡片。 |
| `toolbarPlacement` | `top`、`left` | `top` | 顶部工具栏位于工作区上方；左侧工具栏变成纵向工具面板。 |
| `toolbarFlow` | `rows`、`single`、`grid` | `rows` | 按注册行分开绘制、合并成一条连续流，或排成网格。网格里的图标按钮保持正方形；分隔线整行跨列，复合字段跨两格。 |
| `toolbarColumns` | `2`、`3`、`4` | `2` | `grid` 流的列数。 |
| `toolbarOrder` | 已注册 ID 数组 | `[]` | 先按给定顺序绘制列出的命令，未列出的命令保持注册表顺序。 |
| `transport` | `toolbar`、`floating` | `toolbar` | 进度条留在工具栏或浮在窗口上方。 |
| `transportAnchor` | `top-left`、`top-right`、`bottom-left`、`bottom-right` | `bottom-right` | 浮动进度条初始所在的角。 |
| `transportDraggable` | 布尔值 | `true` | 浮动进度条能否通过把手拖动。 |
| `statusBar` | `docked`、`floating`、`hidden` | `docked` | 状态栏贴边、变成卡片或隐藏。 |

`sidebar: "top"` 和 `sidebar: "inspector"` 只作用于使用注册侧栏项且拥有检查器的编辑器表面。文档级页面位于 drawer，因此主题不会删除它无法重建的页面导航。

### 表面

| 字段 | 值 | 默认 | 效果 |
| --- | --- | --- | --- |
| `shape` | `square`、`soft`、`round` | `soft` | 面板与控件圆角。 |
| `material` | `solid`、`raised`、`glass`、`flat` | `solid` | 面板底色与阴影；`glass` 使用 `backdropBlur`，`flat` 去掉面板边框与阴影。 |
| `backdropBlur` | 整数 `0`–`24` | `0` | `glass` 使用的背景模糊半径。 |
| `pattern` | `none`、`grid`、`dots`、`scanlines` | `none` | 工作区背后由主题 token 绘制的底纹。 |
| `ambient` | `none`、`aurora`、`pulse` | `none` | 由主题调色板绘制的装饰环境光。 |

### 动效

| 字段 | 值 | 默认 | 效果 |
| --- | --- | --- | --- |
| `level` | `none`、`subtle`、`expressive` | `subtle` | 动效预算。`none` 移除主题过渡与动画；`expressive` 延长入场并使用弹性缓动。 |
| `speed` | `slow`、`normal`、`fast` | `normal` | 乘到共享时长 token 上。 |
| `hover` | `none`、`lift`、`glow` | `none` | 动作按钮的指针反馈。 |
| `entrance` | `none`、`fade`、`rise`、`slide` | `fade` | 工作区面板与设置页的入场动画。 |

### 标题栏与尺寸

| 分组 | 值 | 默认 | 效果 |
| --- | --- | --- | --- |
| `titlebar.density` | `compact`、`normal`、`tall` | `normal` | 标题行高度节奏。 |
| `titlebar.windowControls` | `system`、`compact`、`capsule` | `system` | 窗口按钮的尺寸与分组；最小化、最大化、关闭仍由宿主执行。 |
| `titlebar.menu` | `hamburger`、`expanded` | `expanded` | 单个应用菜单触发器，或把分区标签展开成经典菜单栏；命令集合相同。 |
| `metrics` | 有界整数 | 缺省 | 可选的像素/百分比覆盖；省略的值保持当前预设。 |

`metrics` 支持 `panelGap`（0–32）、`toolbarGap`（0–16）、`toolbarCell`（28–56）、 `toolbarWidth`（200–480）、`inspectorWidth`（280–720）、`sidebarWidth`（40–120）、 `sidebarExpandedWidth`（160–320）、`titlebarHeight`（32–56）、`windowControlSize`（28–56）、 `fieldControlWidth`（24–72，百分比）、`fieldGap`（8–32）。所有值必须是整数。 `fieldControlWidth` 作用于每个带标签字段行的控件列；设置页保留自己更紧的分栏。

`prefers-reduced-motion: reduce` 始终优先：共享时长 token 会收缩，`reset.less` 会禁用过渡与动画，无论配方写了什么。`level: "none"` 的配方不需要系统偏好也能得到同样的抑制。

## 声明式 UI

主题包可以用宿主原语组成一棵树，替换已经发布的槽位或组件结构。宿主保留外层按钮、无障碍语义和动作；主题只控制内部的排列与内容。

```json
"ui": {
  "slots": {
    "inspector.empty": {
      "kind": "surface",
      "variant": "glass",
      "shape": "round",
      "padding": "lg",
      "gap": "md",
      "children": [
        { "kind": "text", "text": { "en": "Panels", "zh": "面板" }, "size": "heading" },
        { "kind": "repeat", "items": "sidebarItems", "columns": 2, "gap": "sm",
          "template": { "kind": "action", "variant": "plain", "shape": "soft" } }
      ]
    }
  },
  "components": {
    "railItem": {
      "kind": "stack",
      "direction": "row",
      "gap": "sm",
      "align": "center",
      "children": [
        { "kind": "icon", "bind": "icon", "iconSize": "sm" },
        { "kind": "text", "bind": "label", "size": "caption", "when": "expanded" },
        { "kind": "dot", "tone": "accent", "when": "hasStatus" }
      ]
    }
  }
}
```

### 可替换 ID

| ID                | 类型 | 约定                                                             |
| ----------------- | ---- | ---------------------------------------------------------------- |
| `inspector.empty` | 槽位 | 没有活动面板时的检查器主体。它可以重复注册的侧栏项。             |
| `railItem`        | 组件 | 侧栏按钮的内容结构。宿主保留按钮、动作、标签和无障碍语义。       |
| `menuTrigger`     | 组件 | 应用菜单触发器的内容结构。宿主保留菜单、命令和无障碍语义。       |
| `windowControl`   | 组件 | 每个窗口按钮的内容结构。宿主保留最小化、最大化、关闭和窗口动作。 |

`menuTrigger` 和 `windowControl` 必须保留一个无条件的 `label` 或 `icon` 绑定，避免自定义结构让关键框架变得不可读。组件树不能包含 `action` 或 `repeat`；它们只属于槽位内容。

这些 ID 是宿主契约。主题可以创造新的排列，但不能凭空发明宿主尚未发布的槽位或组件 ID；新增 ID 是宿主在拥有该表面的组件里做的改动。

### 原语

| 类型 | 用途 |
| --- | --- |
| `stack` | 行或列布局。支持 `direction`、`gap`、`align`、`justify`、`columns`、`wrap`、`padding`。 |
| `surface` | 使用 token 绘制的表面。额外支持 `variant`（`plain`、`outlined`、`solid`、`raised`、`glass`）和 `shape`。 |
| `text` | 文本角色（`caption`、`label`、`body`、`heading`），支持 `tone` 和 `weight`。文本可以是语言映射。 |
| `icon` | 设计系统图标，支持 `iconSize`（`sm`、`md`、`lg`）。 |
| `dot` | 强调色、弱化色或危险色的状态点。 |
| `divider` | 使用 token 的细分隔线。 |
| `spacer` | 行/列中的弹性留白。 |
| `action` | 宿主按钮。在 repeat 中读取条目的标签、图标和激活动作。 |
| `repeat` | 对 `sidebarItems` 重复模板；布局属性作用于外层容器。 |

节点可以绑定 `label`、`icon`、`statusDot` 或 `active`，并声明 `when`： `always`、`active`、`inactive`、`expanded`、`collapsed`、`hasStatus`、`noStatus`。 `span` 让网格子项跨 1–4 列。

解析器把树限制在 128 个节点、深度 8、每个容器 16 个子项、每个文本值 32 种语言。未知 ID、类型、属性或绑定都会拒绝整个主题包。渲染器从不接受主题包提供的类名、样式、HTML 标签、URL 或事件处理器。

渲染器只接收绑定条目的标签、图标、状态、展开标记和宿主激活动作；它永远拿不到 SDK、谱面、文档、文件句柄、网络客户端或宿主 DOM。主题不能新增槽位或组件 ID；这些始终是宿主契约。

## 内置主题

| 主题    | 用途                                       |
| ------- | ------------------------------------------ |
| `dark`  | 参考暗色调色板、完整图标集、默认外观配方。 |
| `light` | 参考亮色调色板与视觉更轻的图标集。         |

选择 `dark` 也是布局不顺手时的重置路径：标题栏、菜单和工具栏不能被主题隐藏，所以设置窗口始终可达。

## 安全性

主题的权限刻意低于 Extension：

| 能力面                 | 主题                         | Extension                         |
| ---------------------- | ---------------------------- | --------------------------------- |
| SDK、后端、文档、文件  | 无                           | 受能力门控                        |
| 网络、宿主 DOM、计时器 | 无                           | 网络无；宿主 DOM 无；计时器有能力 |
| 可执行入口             | 无                           | opaque iframe 沙箱                |
| UI 范围                | 已发布的前端槽位/组件        | 面板、覆盖层、侧栏、工具栏        |
| 能否创建新动作         | 否；只能重新呈现已有侧栏条目 | 可以，通过受门控的 API            |

主题包遵循与其他包表面相同的不可信输入规则：

- **纯数据，且只作用于前端。** 没有 JavaScript、CSS 文本、HTML、SVG、远程 URL 或包外文件路径。没有可被沙箱执行的代码入口，主题也没有 SDK、后端、数据库、网络、文件系统或宿主 DOM 句柄。它只能改变前端表现。
- **不能发明动作。** 声明式 `action` 只能出现在注册侧栏项的 repeat 模板里；它读取条目的标签、图标和激活动作，主题不能创建自己的回调或调用 API。组件模板完全不能包含 action 或 repeat。
- **边界可见。** 导入带声明式 UI 的主题包时，会列出被替换的表面并要求确认；选择器会标记 `自定义 UI`。
- **封闭词汇表。** 每个外观值都是枚举或有界整数。未知键和非法值会让整个主题包被拒绝，不会被强制转换为默认值；拼写错误不会悄悄应用半个配方。
- **封闭颜色通道。** 调色板只能设置已发布颜色 token 列表中的名字。布局、动效、圆角、z-index 和组件局部变量由宿主拥有，因此颜色值不能被塞进网格或过渡。`--on-accent-*` 是动作墨色解析器的受检输入；生成的 `--action-foreground-*` 名字不会被接受。
- **有界集合。** 最多 512 个颜色 token 和 512 个图标覆盖；token 名最多 64 字符，值最多 240 字符，版本和作者字符串最多 200 字符，单个图标源最多 512 KiB，全部图标数据最多 4 MiB。桌面宿主还会把主题文档限制在 4 MiB。
- **不提供任意绘制。** 调色板只接受十六进制、数字 `rgb`/`hsl` 或 `transparent`。图标只接受 PNG data URL 或安全的包内相对 `.png` 路径；远程 URL、SVG 数据、绝对路径和路径穿越都会被拒绝。字体、图标几何和语义 token 词汇表由宿主拥有；主题不能加载字体或添加 CSS 规则。
- **关键框架保持可见。** 主题不能隐藏标题栏、应用菜单、工具栏或检查器，覆盖模式下的检查器最多占窗口一半。它不能改变窗口行为或动作含义。
- **侧栏可以移动，目的地不变。** 检查器文字网格复用注册的侧栏项及其标签；主题不能凭空创建按钮。移动进度条只是有界的表现手势：卡片始终留在视口内，拖动不会替换编辑器捕获的同一组 DOM 节点。
- **尺寸有界，不是自由 CSS。** `metrics` 只接受整数范围，最终夹取由宿主掌握；主题包不能提供选择器、单位或任意长度。视口限制和关键最小尺寸仍然优先。
- **无障碍优先。** 动作前景解析强制执行 4.5:1 下限，减少动态效果偏好会覆盖所有主题动画。

## 亮色调色板

大面积表面保持中灰范围而不是纯白。抬升表面比页面亮一级，画布和时间轴保持略冷的层级，激活控件使用强调蓝而不是单独设置暖色。文本与图标的组合在发布前检查 WCAG 对比度。

## 图标

随应用发布的主题图标是扁平的 `icons/<snake_case>.png` 文件，渲染为 192×192；嵌套目录、kebab-case 名称、SVG 文件和未被引用的文件会被 `npm run icons:check` 拒绝。检查器还会解码每个 PNG，验证签名、尺寸、alpha 通道和引用覆盖。渲染器把每个 PNG 的 alpha 当作遮罩，用当前主题墨色绘制。可分发的主题 JSON 以 PNG data URL 内联同一组图标。远程 URL、SVG 数据、绝对路径和路径穿越都会被拒绝。data URL 必须是带 PNG 签名的 base64，因此载荷无法把引号或 CSS 文本带进图标 URL。

缺失的图标名沿用主题外观对应的参考图形，因此亮色主题会继承更轻的视觉粗细。给暗色包和 `src/design/components/icon/iconAssets.ts` 添加图标后，`npm run icons:build` 会重新生成两套图标，`npm run icons:export` 会写出内联全部图标的独立主题 JSON。

## 发现

宿主只扫描受管理的 `themes/` 根目录中的外部主题包。应用运行时会轮询该目录，所以把 `<id>.json` 放进去无需重启即可更新选择器。导入主题会把同样的 `<id>.json` 写入该目录。 `src/assets/themes/` 下的内置主题编译进前端，不会被扫描，因此导入的包无法删除随应用发布的主题。

主题包必须使用透明 PNG 图标；不透明图块在 alpha 遮罩下会变成实心方块。
