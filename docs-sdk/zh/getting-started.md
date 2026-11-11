# 快速开始

本页用三个步骤完成一个可安装的 RPE Redux 扩展：准备清单、注册脚本并显示通知、启用调试。示例代码可以直接复制到 `user-data/extensions/example.hello/` 下运行。

## 步骤一：准备扩展目录

在 `user-data/extensions/` 下新建目录 `example.hello/`，然后创建 `manifest.json`：

```json
{
  "id": "example.hello",
  "name": "Hello Extension",
  "version": "1.0.0",
  "kind": "extension",
  "engines": { "rpe-redux": ">=1.0.0-a1 <2.0.0" },
  "entry": "index.js",
  "capabilities": ["scripts", "ui.notice"],
  "author": "Your name",
  "license": "MIT",
  "description": "Minimal example extension."
}
```

| 字段 | 说明 | 示例中的取值 |
| --- | --- | --- |
| `id` | 包身份，必须与目录名一致；小写字母开头，可含数字、`.`、`_`、`-` | `example.hello` |
| `name` | 显示名称，可被翻译目录覆盖 | `Hello Extension` |
| `version` | 包版本字符串 | `1.0.0` |
| `kind` | `extension`、`mod`（旧别名）、`data-only` 或 `script` | `extension` |
| `engines` | 宿主 major 数字，或覆盖完整版本号的 semver 范围 | `>=1.0.0-a1 <2.0.0` |
| `entry` | 入口文件，相对包目录 | `index.js` |
| `capabilities` | 请求的能力；用户确认后才授予 | `scripts`、`ui.notice` |
| `author` / `license` | 来源元数据，不产生信任 | 自定义 |

没有 `entry` 的包是数据包，必须在 `scripts` 中声明声明式步骤；数据包不能请求 `ui.*` 或 `shortcuts`。

## 步骤二：注册脚本并显示通知

创建 `index.js`。入口默认导出 `activate(context)`，在包启用时执行一次：

```js
/**
 * Minimal code extension: register one script that shows one notice.
 * The manifest is read from manifest.json; the entry only exports activate.
 */
export default {
  activate(context) {
    // 注册脚本；返回的 disposer 交给包生命周期管理。
    const disposeScript = context.scripts.register({
      id: "hello",
      label: "打个招呼",
      description: "显示一条通知，不修改谱面。",
      icon: "info",
      run({ ui }) {
        // 官方通知由宿主绘制，level 支持 info / success / warning / error。
        ui.notice("Hello from RPE Redux", { level: "success" });
      },
    });

    // 包停用或重载时自动释放注册。
    context.addCleanup(disposeScript);
  },
};
```

`activate` 收到的上下文包括：

| 成员                   | 用途                                             |
| ---------------------- | ------------------------------------------------ |
| `manifest`             | 当前包的物化清单（名称、版本、能力等）           |
| `signal`               | 包停用或重载时中止的 `AbortSignal`               |
| `api`                  | 能力门控的异步宿主门面，调用需要 `await`         |
| `ui`                   | 通知、确认、输入、选择、进度、面板、侧栏和覆盖层 |
| `events`               | 订阅固定白名单内的宿主事件                       |
| `scripts`              | 注册包内脚本                                     |
| `settings` / `storage` | owner 作用域的字符串键值存储                     |
| `timers`               | 宿主计时器；全局计时器在沙箱中不可用             |
| `styles`               | 添加所有者作用域的样式表                         |
| `addCleanup`           | 注册停用时执行的清理函数                         |

扩展运行在不透明源的 iframe 里，只能通过异步、按能力授权的 `context.api` 读写克隆数据；宿主 DOM、Tauri IPC、网络、Worker 和 `window.redux` 不在包的作用域内。

## 步骤三：启用、调试与下一步

1. 打开 **设置 → 扩展**。
2. 找到 `Hello Extension`，启用或重新加载。
3. 在脚本面板运行“打个招呼”，应出现一条成功通知。
4. 修改 `index.js` 后使用扩展卡片的重新加载动作；需要跨会话保留的状态写入 `context.storage`。

调试时可以用 `ui.notice(JSON.stringify(value))` 输出小范围状态，用 `api.diagnostics.snapshot()` 检查宿主运行时是否就绪。扩展列表会显示最近错误；回调在 30 秒窗口内失败 5 次会触发失败预算并自动停用扩展，最近错误最多保留 12 条。

常用限制：

| 项目     | 限制                          |
| -------- | ----------------------------- |
| 入口源码 | 2 MB                          |
| 活跃脚本 | 64 个                         |
| 事件订阅 | 128 个                        |
| 定时器   | 64 个，最小间隔 16 ms         |
| 样式表   | 32 张，每张 100 KB            |
| 存储     | key 128 字符，值 256 KB UTF-8 |

下一步：

- 想改谱面：读[谱面操作](place-note.md)，里面有完整的“读取 → 事务 → 结果”流程和插音符示例。
- 做界面前读[设计系统](design-system.md)，按组件和 token 选择写法。
- 需要面板、侧栏、工具栏和右键菜单时读[面板与菜单](panels-and-menus.md)。
- 需要保存配置时读[数据持久化](persistence.md)。
- 不清楚 `context`、`ui`、`scripts`、`storage` 分别是什么：读[扩展上下文](context.md)。
- 遇到 `ChartTransactionRequest`、`ChartObjectId`、`ApiResult` 这类类型名：查[类型与术语](types.md)。
- 需要确认某个方法是否登记、需要什么能力时，在左侧 **API** 树按 handle 查方法页；异步约定见[API 约定](api-reference.md)。
