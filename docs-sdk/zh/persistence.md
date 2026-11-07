# 数据持久化

为扩展保存配置、草稿、版本标记和用户可配置项，并在升级时安全迁移旧数据。

## 用途

| 数据                         | 使用接口                                      | 用户可见        |
| ---------------------------- | --------------------------------------------- | --------------- |
| 用户可配置项                 | `api.settings.registerSetting` + `api.values` | 是，设置页有行  |
| 包私有草稿、缓存、版本标记   | `context.storage`                             | 否              |
| 当前会话的活状态             | `api.values.define`                           | 否              |
| 大文件、图片、音频、项目资产 | library / package 资产                        | 是（P3 待开放） |

`context.storage` 是 owner 作用域的字符串键值存储，写入偏好文档的 `values` 段；每个 key 最终存成 `extension:<扩展 id>:<key>`。JSON 便利方法在同一存储上提供结构化读写。

## 签名

```ts
interface SandboxStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface SandboxJsonStore extends SandboxStore {
  getJSON<T = unknown>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
}

// context.storage 同时提供字符串与 JSON 方法
context.storage.get("last-tab");
context.storage.getJSON("config");
context.storage.setJSON("config", { version: 1, data: {} });

// 设置行
context.api.settings.registerNavigation(navigation): Promise<() => void>;
context.api.settings.registerSetting(definition): Promise<() => void>;

// 值读写
context.api.values.byId.get("quality");
context.api.values.byId.set("quality", 90);
context.api.values.byId.subscribe("quality", listener);
```

`getJSON` 返回解析后的值，缺失、损坏或超限时返回 `null`；`setJSON` 只接受纯 JSON 数据。

## 最小示例

保存带版本号的配置：

```js
const CONFIG_KEY = "config";
const CONFIG_VERSION = 1;

export default {
  activate(context) {
    async function readConfig() {
      const stored = await context.storage.getJSON(CONFIG_KEY);
      if (!stored || typeof stored !== "object") {
        return { quality: 80, mode: "pez" };
      }
      if (stored.version !== CONFIG_VERSION) {
        return migrateConfig(stored);
      }
      return stored.data ?? { quality: 80, mode: "pez" };
    }

    async function writeConfig(config) {
      await context.storage.setJSON(CONFIG_KEY, {
        version: CONFIG_VERSION,
        data: config,
      });
    }

    context.scripts.register({
      id: "save-config",
      label: "保存配置",
      async run({ ui }) {
        await writeConfig({ quality: 90, mode: "json" });
        ui.notice("配置已保存", { level: "success" });
      },
    });

    void readConfig();
  },
};

function migrateConfig(stored) {
  if (stored.version === 0 && stored.data) {
    return {
      quality: Number(stored.data.quality) || 80,
      mode: "pez",
    };
  }
  return { quality: 80, mode: "pez" };
}
```

## 进阶用法

### 注册设置行

用户可配置项放进设置页，由宿主负责布局、重置、依赖关系和确认：

```js
export default {
  async activate(context) {
    const navigation = await context.api.settings.registerNavigation({
      key: "tools",
      label: context.i18n.key({ key: "settings.page" }),
      icon: "sliders",
      order: 920,
    });

    const rows = await context.api.settings.registerSetting({
      key: "quality",
      navigation: "tools",
      group: context.i18n.key({ key: "settings.group" }),
      label: { key: "settings.quality.label" },
      description: { key: "settings.quality.description" },
      control: "range",
      default: 80,
      min: 1,
      max: 100,
      step: 1,
      unit: "%",
    });

    context.addCleanup(() => {
      rows();
      navigation();
    });
  },
};
```

支持的 `control`：`toggle`、`select`、`text`、`number`、`range`、`color`、`beat`、`action`、`file`、`custom`。依赖关系用 `visibleWhen`（条件成立才显示）、`enabledWhen`（条件成立才启用）、`disabledWhen`（条件成立就禁用）声明；内置设置使用 `enabledWhen` / `disabledWhen`，不用 `visibleWhen` 隐藏依赖项。跨越信任边界的开关用 `confirm`。

读写设置值：

```js
const quality = await context.api.values.byId.get("quality");
await context.api.values.byId.set("quality", 90);

const stop = await context.api.values.byId.subscribe("quality", () => {
  panel.update(tree());
});
context.addCleanup(stop);
```

### 版本与迁移

```js
const VERSION = 2;

function migrate(stored) {
  if (!stored) return { version: VERSION, data: { mode: "pez" } };
  if (stored.version === 1) {
    return {
      version: VERSION,
      data: { ...stored.data, mode: stored.data.mode ?? "pez" },
    };
  }
  return { version: VERSION, data: { mode: "pez" } };
}
```

- 第一版就写 `version`。
- 迁移函数只转换形状，不写盘；由调用方统一保存一次。
- 未知版本保留原值到 `config.backup`，再回退默认值。
- 版本由值的 envelope 维护，不用 key 数量表达。

### values.define 的边界

```js
const handle = context.api.values.define({
  id: "session-draft",
  initial: { query: "" },
});
```

- 包表面只接受 `{ id, initial }`。
- `persist`、`storageKey`、`legacyStorageKey` 会被忽略；包值总是落在 `values` 偏好段。
- `validate`、`merge`、`equals` 不能跨异步桥，定义保持纯数据。
- 包只能写自己声明的值；宿主值和其他包的值只读。
- `byId.snapshot()` 和 `subscribeAll()` 只返回本包的值。

### 大文件与资产（P3 待开放）

图片、音频、完整谱面和二进制文件使用 library/package 资产，不放 `context.storage`：

- `api.library.addAsset` / `removeAsset` 需要 `assets.write`（敏感）。
- `api.library` 的读取、创建、更新和修订需要对应能力。
- 扩展包内大文件随包分发；通用 package 资源读取仍在 P3 计划中。

## 权限与上限

| 接口                                   | 能力       | 上限                                 |
| -------------------------------------- | ---------- | ------------------------------------ |
| `context.storage.get/set/delete/clear` | `storage`  | key 128 字符；值 256 KB UTF-8        |
| `context.storage.getJSON/setJSON`      | `storage`  | JSON 编码后 256 KB；最多 32 层       |
| `api.settings.registerNavigation`      | `settings` | 包内 key 自动加 `extension.<owner>.` |
| `api.settings.registerSetting`         | `settings` | 设置值自动声明                       |
| `api.values.byId.get/set`              | `values`   | 只写本包值                           |
| `api.values.define`                    | `values`   | 初始值必须可克隆                     |

存储值会被备份和迁移，不提供加密；令牌、密码和隐私数据应放在宿主管理的安全通道，或完全不保存。

## 错误与恢复

| 错误/现象 | 原因 | 恢复 |
| --- | --- | --- |
| `storageValueNotJson` | `setJSON` 收到函数、类实例、循环引用或 `BigInt` | 只传纯 JSON 数据 |
| `storageValueTooLarge` | 编码后超过 256 KB | 裁剪数据或改用资产通道 |
| `bridge.limit` | 跨桥对象超过 32 层/500k 节点/16 MB | 分页、裁剪或只保存摘要 |
| `getJSON` 返回 `null` | key 不存在、JSON 损坏或值超限 | 回退默认值并保留备份 |
| 设置行不显示 | 导航 key 或 `visibleWhen` 不匹配 | 检查 `navigation` 和能力 |
| 设置行不可操作 | `enabledWhen` / `disabledWhen` 的依赖未满足 | 检查依赖项的当前值 |
| 写入被拒绝 | 目标不是本包值 | 使用本包声明的值 id |
| 迁移后丢数据 | 未知版本直接覆盖 | 先备份原值，再写新版本 |

## 相关接口

- [快速开始](getting-started.md)：最小包结构和 `activate`。
- [设计系统](design-system.md)：设置页和面板使用的控件。
- [能力与授权](capabilities.md)：`storage`、`settings`、`values` 的授权规则。
- 左侧 **API** 树：`storage.*`、`settings.*`、`values.*` 的方法页；异步约定见[API 约定](api-reference.md)。
