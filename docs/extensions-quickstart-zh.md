# 编写第一个 Extension

在扩展目录中创建名为 `example.hello` 的文件夹，放入以下两个文件。文件夹名必须与 manifest 的 id 一致。

`manifest.json`：

```json
{
  "kind": "extension",
  "id": "example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "engines": { "rpe-redux": 1 },
  "entry": "index.js",
  "capabilities": ["scripts", "ui.notice"]
}
```

`index.js`：

```js
export default {
  activate(context) {
    context.scripts.register({
      id: "hello",
      label: "Say hello",
      steps: [{ op: "notice", message: "Hello from my Extension!" }],
    });
  },
};
```

在设置的扩展页面启用该包，然后在脚本界面运行 **Say hello**。hello 示例只需要 `scripts` 和 `ui.notice`；下面的谱面示例还需要 `chart.read` 和 `chart.write`。代码运行在独立 iframe 中，通过异步 context 消息桥调用宿主。完成后可在设置中禁用或移除扩展。

## 改谱面

谱面写入统一走一个原子 `transaction` 请求。先把清单能力改成包含 `chart.read` 和 `chart.write`，再读谱面并提交音符、事件、判定线、BPM 或元数据修改：

```js
const lines = await context.api.chart.lines();
if (lines.ok && lines.value.length > 0) {
  await context.api.transaction.apply({
    label: "添加 Tap",
    notes: {
      insert: [
        {
          lineIndex: 0,
          note: { type: 1, startTime: [0, 0, 1], endTime: [0, 0, 1], positionX: 0, above: 1 },
        },
      ],
    },
  });
}
```

公开的[谱面操作](../docs-sdk/zh/place-note.md)指南包含完整的“读取 → 事务 → 结果”流程、选中音符更新、事件和常见错误。扩展目录、安装、权限、脚本步骤、存储和完整 context 契约见 [Extension 参考](extensions-zh.md)；[SDK 示例](../sdk/examples/)包含 TypeScript 和数据型扩展。[组合示例](../sdk/examples/composition.ts)展示提供者、消费者、Hook 和设计 slot 如何一起工作。

提供者暂时消失时，消费者只会收到不可用通知并保留自己的激活状态，不需要停止整张依赖图。
