/**
 * Simplified Chinese catalog for the startup failure screen: the plain-language
 * cause, Extension evidence, folded technical report, and safe-mode confirmation.
 */
export default {
  "startup.failure.render":
    "界面组件在渲染时崩溃。重新启动试试；如果反复出现，可用安全模式排除扩展界面的影响。",
  "startup.failure.backend":
    "本地服务或数据库没有启动。请查看日志文件夹中的服务错误，然后重新启动。",
  "startup.failure.extension":
    "本次启动有扩展报错。可以以安全模式启动，先进入编辑器，再到“设置 > 扩展”里停用出问题的扩展。",
  "startup.failure.extensionSafeMode":
    "有扩展在注册信息时出错。安全模式已经启用；请在“设置 > 扩展”里停用或移除出问题的扩展，然后正常重启。",
  "startup.failure.unknown": "编辑器在启动时因未知原因中断。下方的技术细节可能指出原因。",
  "startup.backendPortConflict.title": "后端端口已被占用",
  "startup.backendPortConflict.description":
    "下次启动时使用 --backend-port=<其他端口>，或到“设置 > 常规 > 界面 > 后端端口”修改后再重试。",

  "startup.report.details": "技术细节",

  "startup.extensions.title": "可能的来源",
  "startup.extensions.failures.title": "启动时这些扩展报错了",
  "startup.extensions.failures.description":
    "这些扩展最可能是原因。请以安全模式启动，然后在“设置 > 扩展”里停用或移除它。",
  "startup.extensions.failures.safeModeDescription":
    "扩展安全模式已经启用。请在“设置 > 扩展”里停用或移除出问题的扩展。",
  "startup.extensions.activations.title": "本次启动加载了这些扩展",
  "startup.extensions.activations.description": "没有扩展报告错误，原因可能是其中之一。",
  "startup.extensions.activations.safeModeTitle": "本次启动注册了这些扩展",
  "startup.extensions.activations.safeModeDescription":
    "扩展安全模式已启用，这些扩展在本次启动中没有运行。",
  "startup.extensions.none": "本次启动没有记录到扩展错误。",
  "startup.extensions.more": "还有 {count} 个。",

  "startup.safeMode.open": "以安全模式启动",
  "startup.safeMode.title": "以安全模式启动？",
  "startup.safeMode.description":
    "本次启动会跳过并禁用所有扩展，让编辑器先能进入。请在“设置 > 扩展”里停用或移除有问题的扩展；下次正常启动会恢复扩展加载。",
  "startup.safeMode.confirm": "以安全模式启动",
  "startup.safeMode.requested": "你从启动失败界面请求了安全模式",
};
