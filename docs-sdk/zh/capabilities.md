# 能力与授权

声明扩展需要访问的宿主能力，理解风险等级、同意流程和拒绝后的恢复方式。

## 用途

能力（capability）是扩展能触达的宿主操作集合。清单里的 `capabilities` 是请求；用户在安装或启用时确认后，运行时才授予对应句柄。每次桥接调用都会再次检查授权。

## 签名

```ts
// manifest.json
interface TrustedExtensionManifest {
  id: string;
  name?: string;
  version: string;
  engines: { "rpe-redux": number | string };
  entry?: string;
  capabilities?: readonly ExtensionCapability[];
}

// 运行时拒绝
interface ExtensionCapabilityError extends Error {
  code: "capabilityDenied";
  capability: ExtensionCapability;
}
```

能力声明示例：

```json
{
  "id": "example.tools",
  "name": "Example Tools",
  "version": "1.0.0",
  "engines": { "rpe-redux": ">=1.0.0-a1 <2.0.0" },
  "entry": "index.js",
  "capabilities": ["scripts", "ui.notice", "ui.panel", "ui.sidebar", "storage"]
}
```

## 最小示例

在入口里检查运行时是否可用，再调用对应句柄：

```js
export default {
  activate(context) {
    context.scripts.register({
      id: "inspect",
      label: "检查选区",
      async run({ api, ui }) {
        const selection = await api.selection.state();
        if (!selection.ok) {
          ui.notice(selection.error.message, { level: "error" });
          return;
        }
        ui.notice(`已选中 ${selection.value.notes.length} 个音符`, {
          level: "info",
        });
      },
    });
  },
};
```

## 进阶用法

### 按功能拆分能力

| 功能                           | 需要的能力                               |
| ------------------------------ | ---------------------------------------- |
| 注册脚本                       | `scripts`                                |
| 读取谱面                       | `chart.read`                             |
| 写入谱面                       | `chart.write`                            |
| 读取选区                       | `selection.read`                         |
| 修改选区                       | `selection.write`                        |
| 读取文档                       | `document.read`                          |
| 新建/打开/保存/关闭            | `document.write`                         |
| 读取曲库                       | `library.read`                           |
| 写入曲库                       | `library.write`                          |
| 写入资源                       | `assets.write`                           |
| 播放控制                       | `playback.read` / `playback.control`     |
| 通知与进度                     | `ui.notice`                              |
| 确认/输入/选择/引导            | `ui.dialog`                              |
| 面板 / 侧栏 / 覆盖层           | `ui.panel` / `ui.sidebar` / `ui.overlay` |
| 工具栏 / 右键菜单              | `ui.toolbar` / `ui.contextMenu`          |
| 快捷键                         | `shortcuts`                              |
| 读取快捷键文本                 | `shortcuts.read`                         |
| 设置行                         | `settings`                               |
| 值                             | `values`                                 |
| 私有存储                       | `storage`                                |
| 宿主事件                       | `events`                                 |
| 样式表                         | `styles`                                 |
| 计时器                         | `timers`                                 |
| 诊断                           | `diagnostics`                            |
| 预览几何 / 命中测试 / 布局锚点 | `preview.read`                           |

### 读取能力使用情况

扩展可以通过宿主事件和扩展列表观察失败；宿主侧维护按 owner 的能力使用账本，用于测试和审计，不属于包 API。测试时可以在加载后检查当前包的失败计数和最近错误。

### 旧清单兼容

`host.patch` 是旧宿主清单里的门禁名。当前目录仍保留它以便解析已安装包，但它不授予任何句柄，也不会出现在同意对话框。新包使用上表中的明确能力。

## 权限与上限

### 能力总表

下表由构建脚本从 `src/core/extensions/capabilities.ts` 和 `capabilityCatalog.ts` 生成；风险等级取自运行时目录。共 30 项：29 项可授予，`host.patch` 已退役、不可授予。

{{CAPABILITY_TABLE}}

### 风险等级

| 等级 | 含义 | 例子 |
| --- | --- | --- |
| `read` | 只读宿主状态 | `chart.read`、`selection.read`、`preview.read` |
| `write` | 改变编辑器内状态或注册表 | `chart.write`、`ui.panel`、`timers` |
| `sensitive` | 跨文档、跨项目或影响用户文件 | `document.write`、`library.write`、`assets.write`、`ui.dialog` |

### 同意规则

1. 清单声明 `capabilities`；未知名称和重复项在加载时被拒绝。
2. 宿主把声明投影成同意行；`host.patch` 被剥离。
3. 用户确认后建立该包的授权集合，并按所有权限定 id。
4. 包字节改变后同意可能变为 `stale`，需要重新确认。
5. 数据包（没有 `entry`）不能声明 `ui.*` 或 `shortcuts`。

## 错误与恢复

| 错误                  | 含义                           | 恢复                             |
| --------------------- | ------------------------------ | -------------------------------- |
| `capabilityDenied`    | 清单没有请求，或用户没有授予   | 补能力并重新确认；避免循环重试   |
| `methodNotRegistered` | 宿主门面暴露了未登记的方法     | 宿主缺陷；换用已登记方法         |
| `eventNotAllowed`     | 订阅了白名单外的事件           | 使用已发布事件名                 |
| `unavailable`         | 运行时尚未挂载                 | 先查 `availability()` 或等待事件 |
| `bridge.limit`        | 跨桥数据超过层级/节点/字节上限 | 分页、裁剪或改用摘要             |
| 同意变为 `stale`      | 包字节改变                     | 让用户重新确认                   |

`capabilityDenied` 会计入包的失败预算；`methodNotRegistered` 属于宿主注册缺口，不应归咎于包。

## 相关接口

- [快速开始](getting-started.md)：清单与激活流程。
- [安全模型](security.md)：沙箱边界、信任状态和资源预算。
- 左侧 **API** 树：每个方法对应的能力、参数、风险和写状态；异步约定见[API 约定](api-reference.md)。
- [数据持久化](persistence.md)：`storage`、`settings`、`values` 的实际用法。
