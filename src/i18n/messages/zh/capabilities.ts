/**
 * Chinese consent labels and descriptions for every Extension capability.
 *
 * The keys mirror `CAPABILITY_CATALOG` in
 * `src/core/extensions/capabilityCatalog.ts` one-for-one, so the install dialog
 * and documentation render typed text instead of a capability name. The
 * deprecated `host.patch` row stays here for legacy manifests and is never
 * offered to a new install.
 */
export default {
  "settings.extensions.capability.scripts.label": "运行扩展脚本",
  "settings.extensions.capability.scripts.description":
    "注册并运行扩展自己的脚本，包括声明式步骤。",
  "settings.extensions.capability.chart.read.label": "读取谱面数据",
  "settings.extensions.capability.chart.read.description":
    "读取谱面元数据、判定线、音符、事件和资源。",
  "settings.extensions.capability.chart.write.label": "编辑谱面数据",
  "settings.extensions.capability.chart.write.description":
    "通过校验过的事务修改谱面元数据、判定线、音符和事件。",
  "settings.extensions.capability.selection.read.label": "读取选择",
  "settings.extensions.capability.selection.read.description": "读取当前选中的音符和事件。",
  "settings.extensions.capability.selection.write.label": "修改选择",
  "settings.extensions.capability.selection.write.description":
    "选择、复制、剪切、粘贴和删除音符或事件。",
  "settings.extensions.capability.document.read.label": "读取文档状态",
  "settings.extensions.capability.document.read.description":
    "读取当前文档的名称、路径、快照和指纹。",
  "settings.extensions.capability.document.write.label": "管理文档",
  "settings.extensions.capability.document.write.description": "创建、打开、保存和关闭文档。",
  "settings.extensions.capability.library.read.label": "读取谱面库",
  "settings.extensions.capability.library.read.description": "读取谱面库项目、资源和修订。",
  "settings.extensions.capability.library.write.label": "修改谱面库",
  "settings.extensions.capability.library.write.description":
    "创建、更新、复制和删除谱面库项目及修订。",
  "settings.extensions.capability.assets.write.label": "修改库资源",
  "settings.extensions.capability.assets.write.description":
    "向当前文档所属的谱面库项目添加或移除资源。",
  "settings.extensions.capability.playback.read.label": "读取播放状态",
  "settings.extensions.capability.playback.read.description": "读取播放状态、渲染纹理、帧和指标。",
  "settings.extensions.capability.playback.control.label": "控制播放",
  "settings.extensions.capability.playback.control.description":
    "播放、暂停、跳转、设置倍率并运行预览测量。",
  "settings.extensions.capability.ui.notice.label": "显示通知",
  "settings.extensions.capability.ui.notice.description": "在宿主界面显示通知和进度消息。",
  "settings.extensions.capability.ui.dialog.label": "询问用户",
  "settings.extensions.capability.ui.dialog.description":
    "打开宿主的确认、输入、选择、引导和图片选择对话框。",
  "settings.extensions.capability.ui.guide.label": "打开帮助与教程",
  "settings.extensions.capability.ui.guide.description":
    "打开帮助、更新日志，或注册扩展自己的分步教程。",
  "settings.extensions.capability.ui.panel.label": "添加面板",
  "settings.extensions.capability.ui.panel.description": "在编辑器内注册声明式面板。",
  "settings.extensions.capability.ui.sidebar.label": "添加侧栏条目",
  "settings.extensions.capability.ui.sidebar.description": "注册侧栏图标、路由和分隔线。",
  "settings.extensions.capability.ui.overlay.label": "绘制叠加层",
  "settings.extensions.capability.ui.overlay.description": "在编辑器上方注册舞台或窗口叠加层。",
  "settings.extensions.capability.ui.toolbar.label": "添加工具栏条目",
  "settings.extensions.capability.ui.toolbar.description":
    "注册工具栏动作、字段、控件、分隔线和占位。",
  "settings.extensions.capability.ui.contextMenu.label": "添加右键菜单",
  "settings.extensions.capability.ui.contextMenu.description": "为宿主界面注册右键菜单行。",
  "settings.extensions.capability.shortcuts.label": "注册快捷键",
  "settings.extensions.capability.shortcuts.description": "注册分类、快捷键和脚本默认绑定。",
  "settings.extensions.capability.shortcuts.read.label": "读取快捷键绑定",
  "settings.extensions.capability.shortcuts.read.description":
    "通过工具栏快捷键 helper 读取宿主快捷键绑定。",
  "settings.extensions.capability.settings.label": "注册设置",
  "settings.extensions.capability.settings.description": "注册扩展设置和设置导航页。",
  "settings.extensions.capability.values.label": "使用命名值",
  "settings.extensions.capability.values.description": "定义并更新扩展自己的命名值。",
  "settings.extensions.capability.storage.label": "存储扩展数据",
  "settings.extensions.capability.storage.description": "读写扩展自己的偏好存储。",
  "settings.extensions.capability.events.label": "读取宿主事件",
  "settings.extensions.capability.events.description": "订阅只读的文档、选择和生命周期事件。",
  "settings.extensions.capability.hooks.label": "组合公开 Hook",
  "settings.extensions.capability.hooks.description":
    "注册和调用带命名空间的扩展 Hook，并合并 JSON 载荷。",
  "settings.extensions.capability.services.label": "组合扩展服务",
  "settings.extensions.capability.services.description": "向其他扩展提供或使用命名空间服务。",
  "settings.extensions.capability.styles.label": "添加样式表",
  "settings.extensions.capability.styles.description": "添加仅作用于扩展自己面板和叠加层的样式。",
  "settings.extensions.capability.timers.label": "使用计时器",
  "settings.extensions.capability.timers.description": "在宿主计时器预算内运行超时、间隔和动画帧。",
  "settings.extensions.capability.diagnostics.label": "读取诊断",
  "settings.extensions.capability.diagnostics.description": "读取诊断快照并控制跟踪捕获。",
  "settings.extensions.capability.hitTest.read.label": "读取谱面命中测试",
  "settings.extensions.capability.hitTest.read.description":
    "在不改变编辑器视图的情况下，按指定时间查询谱面对象。",
  "settings.extensions.capability.preview.read.label": "读取预览几何",
  "settings.extensions.capability.preview.read.description":
    "读取已绘制的预览对象、拾取几何和布局锚点。",
  "settings.extensions.capability.host.patch.label": "旧版宿主补丁（已弃用）",
  "settings.extensions.capability.host.patch.description":
    "为兼容旧 manifest 保留的宿主专用名称；不授予任何 handle，新安装不会再展示。",
};
