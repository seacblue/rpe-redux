# 扩展上下文

`context` 是扩展自己的运行时上下文，`context.api` 则是宿主数据与动作的异步门面。把它们分开看，文档里就不会把通知、存储和谱面修改混成同一层。

## 两个入口

| 入口 | 是什么 | 例子 |
| --- | --- | --- |
| `context.api.chart` | 一个 API handle，访问宿主数据或执行宿主动作 | 读取判定线、提交事务 |
| `context.scripts` | 扩展运行时，注册命令和入口 | 注册“放一个 Tap” |
| `context.ui` | 扩展运行时，显示通知和注册表面 | `ui.notice(...)`、`ui.registerPanel(...)` |
| `context.storage` | 扩展运行时，保存任意 JSON 数据 | 缓存上次导入的文件 |

`context.api` 上的 handle 见[API 总览](api:)。`context` 上的成员不是 handle，不能拼成 `context.api.ui.notice(...)`。

## context 成员

| 成员         | 用途                                               |
| ------------ | -------------------------------------------------- |
| `scripts`    | 注册脚本、参数和默认快捷键。                       |
| `ui`         | 通知、确认、输入、选择、引导、面板、侧栏和覆盖层。 |
| `events`     | 订阅固定白名单内的宿主事件。                       |
| `hooks`      | 注册或调用命名空间化的跨扩展 Hook。                |
| `settings`   | 包私有的字符串键值存储，不注册设置页。             |
| `storage`    | 包私有的 JSON 存储，适合任意缓存和迁移数据。       |
| `timers`     | 宿主计时器；沙箱不提供全局计时器。                 |
| `styles`     | 添加只作用于本扩展表面的 CSS。                     |
| `i18n`       | 声明和解析扩展自己的多语言文本。                   |
| `params`     | 当前脚本这次运行收到的参数。                       |
| `addCleanup` | 注册停用或重载时要执行的清理函数。                 |

## storage 和 values 怎么选

它们都能保存数据，但用途不同：

| 需求                         | `context.api.values` | `context.storage` |
| ---------------------------- | -------------------- | ----------------- |
| 设置页里出现一行、用户可修改 | 是                   | 否                |
| 值变化时通知脚本             | 是                   | 否                |
| 按 schema 校验类型和范围     | 是                   | 否                |
| 保存任意 JSON、带版本号迁移  | 可以，但先声明值     | 是                |
| 读写宿主值或跨脚本共享命名值 | 是                   | 否                |

简单说：**values 是“有名字、可观察、可出现在设置页的值”；storage 是“包私有的一袋 JSON”**。只有后者时才用 `context.storage`。

## 为什么 hitTest、preview、layout 没有合并

- `preview` 是“最后一帧已经绘制出来的对象快照”，可订阅帧更新。
- `hitTest` 是“给定表面坐标，查询命中了哪些对象”，还包含碰撞几何；它是一次性查询，不拥有帧生命周期。
- `layout` 是“宿主面板、工具栏和控件的安全矩形锚点”，只给位置和标签，不给 DOM 或输入值。
- 三者共享 `preview.read` capability，因为它们都只读视觉运行时；但数据源、更新频率和失败语义不同。合并成一个平面 handle 会让 `snapshot`、`pick`、`anchors` 看起来像同一类数据，反而误导调用方。

## 为什么 theme 没有放进 values

- `values` 是可声明、可写、可持久化、可订阅的命名值；扩展可以把自己的设置放进去。
- `theme.tokens()` 是宿主已经应用到文档的只读派生快照，来源是当前 CSS token surface；它没有 `set`、没有持久化 key，也不能被扩展声明覆盖。
- `theme.subscribe()` 监听的是主题/密度变化，不能替代某个值的变更订阅。把它伪装成 `values` 会让扩展误以为能写主题或把主题 token 当成用户设置。

## 为什么 layout、theme、ui 没有合并

- `layout` 和 `theme` 是只读快照 handle，和谱面、播放一样属于 `context.api`。
- `ui` 是扩展运行时里的界面辅助，不是 `context.api` 的成员。合并它会让所有已有的 `context.ui.notice(...)` 失效。
- `scripts` 是注册命令的入口；`storage` 是数据存储。把它们塞进同一个 handle 只会让每个扩展都多背一层不相关的 API。

因此 API 树只列真正的 `context.api` handle；`ui`、`scripts`、`storage`、`events`、`timers`、`styles` 在这个页面集中说明。

## 常用 context 方法

{{CONTEXT_METHODS_TABLE}}

## 相关接口

- [数据持久化](persistence.md)
- [面板与菜单](panels-and-menus.md)
- [声明式 UI](ui-reference.md)
- [API 总览](api:)
