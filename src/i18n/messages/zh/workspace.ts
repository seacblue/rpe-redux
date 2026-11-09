/**
 * Simplified Chinese catalog for the React-rendered workspace, stage, welcome
 * page, and shell dialogs.
 */
export default {
  "workspace.loading.title": "正在加载谱面中…",
  "workspace.loading.failed": "无法打开谱面",
  "workspace.loading.progress": "谱面加载进度",
  "workspace.loading.solution": "解决办法",
  "workspace.loading.errorCode": "错误代码",
  "workspace.loading.read": "读取文件",
  "workspace.loading.unpack": "读取谱面包",
  "workspace.loading.notes": "正在解析音符",
  "workspace.loading.events": "正在解析事件",
  "workspace.loading.render": "正在渲染首帧",
  "workspace.loading.parse": "校验谱面",
  "workspace.loading.textures": "加载纹理",
  "workspace.loading.audio": "加载音频",
  "workspace.loading.ready": "加载完成",
  "workspace.document.compatibility.title": "谱面格式转换",
  "workspace.document.compatibility.description":
    "需要将 RPE {version} 谱面转换为当前格式；转换后可能无法在原编辑器打开。",
  "workspace.document.compatibility.descriptionUnknown":
    "此文件没有可用的 RPE 版本。需要转换为当前格式；转换后可能无法在原编辑器打开。",
  "workspace.document.compatibility.detail":
    "将谱面转换为 RPE {version}，并补齐 {count} 个缺失的判定线字段。",
  "workspace.document.compatibility.convert": "转换并打开",
  "workspace.document.compatibility.cancel": "取消",
  "workspace.document.compatibility.newerTitle": "较新的谱面版本",
  "workspace.document.compatibility.newerDescription":
    "谱面由 Redux {version} 创建，当前应用为 {current}；部分字段可能被忽略。",
  "workspace.document.compatibility.openAnyway": "仍然打开",
  "workspace.document.occupancy.title": "谱面已被占用",
  "workspace.document.occupancy.description":
    "“{name}”已在另一个编辑器窗口中打开。如果该窗口已崩溃，占用记录可能是残留的。",
  "workspace.document.occupancy.detail": "另一个窗口：前端端口 {frontend}，后端端口 {backend}",
  "workspace.document.occupancy.unknownPort": "未知",
  "workspace.document.occupancy.frontend": "释放其他窗口",
  "workspace.document.occupancy.backend": "清除后端记录",
  "workspace.document.occupancy.reconcile": "修复并重试",
  "workspace.document.occupancy.clearFailed":
    "后端没有释放占用记录。可以尝试清除本谱面的后端占用记录，或取消打开。",
  "workspace.document.error.createCancelled": "扩展已取消新建文档。",
  "workspace.document.error.openCancelled": "扩展已取消打开文档。",
  "workspace.document.error.closeCancelled": "扩展已取消关闭文档。",
  "workspace.document.error.pathUnavailable": "路径文档仅在桌面运行环境中可用。",
  "workspace.document.error.bytesMissing": "未提供文档数据。",
  "workspace.document.error.noDocument": "当前没有打开的文档。",
  "workspace.document.error.readOnly": "当前谱面为只读。",
  "workspace.document.error.saveFailed": "文档未能保存。",
  "workspace.document.error.libraryRevisionConflict":
    "谱面库中的项目已在另一处被修改，本次保存未应用。",
  "workspace.document.saving": "正在保存谱面…",
  "workspace.document.error.saveBaselineUnavailable": "无法读取磁盘保存基线，因此未应用本次保存。",
  "workspace.document.error.saveSessionMissing": "保存会话在完成前已失效。",
  "workspace.document.error.saveAssetsBinaryRequired": "文档资源必须以二进制数据发送。",
  "workspace.document.error.invalidSaveAssetData": "文档资源数据无效。",
  "workspace.document.error.saveExportDirectoryRequired": "提取文档资源前请选择导出目录。",
  "workspace.document.error.saveAssetMissing": "缺少文档资源。",
  "workspace.document.error.duplicateSaveAsset": "同一文档资源被重复上传。",
  "workspace.document.error.saveDestinationExists": "导出目标位置已有同名文档资源。",
  "workspace.document.error.saveAssetFilenameMissing": "文档资源路径缺少文件名。",
  "workspace.document.error.unsafeSaveAssetPath":
    "该谱面引用了文档目录外的文件，无法打包。请先把外部资源复制到谱面目录，再重新保存。",
  "workspace.document.error.saveConflict":
    "磁盘上的文件已发生变化，本次保存未应用；当前编辑内容仍保留在编辑器中。",
  "workspace.document.notice.externalResources":
    "该谱面可能引用了文档目录外的文件。外部文件默认不会加载；如需使用，请先把它们复制到谱面目录，再打开或保存为 PEZ。",
  "workspace.document.externalResources.title": "外部文件未加载",
  "workspace.document.externalResources.description":
    "该谱面引用了 {count} 个文档目录外的文件，默认不会加载。仅在信任该谱面时允许。",
  "workspace.document.externalResources.more": "还有 {count} 条",
  "workspace.document.externalResources.allow": "允许并重新打开",
  "workspace.document.externalResources.keep": "保持不加载",
  "workspace.document.externalResources.unavailableTitle": "部分文件无法授权",
  "workspace.document.externalResources.unavailableDescription":
    "其中 {count} 个引用无法授权（路径逃出文档目录），将保持不加载。",
  "workspace.document.diskChange.title": "磁盘文件已更改",
  "workspace.document.diskChange.cleanBody":
    "其他程序修改了此文件。重新载入磁盘版本，还是保留本地版本？",
  "workspace.document.diskChange.dirtyBody":
    "另一个程序修改了这个文档或它的资源，而你还有本地修改。请谨慎选择。",
  "workspace.document.diskChange.limitation": "当前不支持自动三方合并，也不支持完整的资源级撤销。",
  "workspace.document.diskChange.reload": "从磁盘重新载入",
  "workspace.document.diskChange.keepLocal": "保留本地版本",
  "workspace.document.diskChange.saveAs": "将本地版本另存为…",
  "workspace.document.diskChange.stale": "应用选择前文档又发生了变化，没有内容被丢弃。",
  "workspace.document.diskChange.retained": "已保留本地版本。准备好后请显式保存或使用“另存为”。",
  "workspace.dialogs.timelineMenu": "时间轴菜单",
  "workspace.dialogs.addMarker": "添加时间标记",
  "workspace.dialogs.splitTrajectory": "拆分曲线轨迹",
  "workspace.dialogs.deleteMarker": "删除此标记",
  "workspace.dialogs.editMarker": "编辑时间标记",
  "workspace.dialogs.dismiss": "取消",
  "workspace.timeline.historyTooltip": "{label}，影响 {count} 个对象",

  "workspace.scripts.source": "提供者：{source}",
  "workspace.scripts.run": "运行",
  "workspace.scripts.runParameterHint": "使用这些参数运行",
  "workspace.scripts.parameters.title": "使用参数运行 {script}",
  "workspace.scripts.parameters.description": "请输入有效值后运行此脚本。",
  "workspace.scripts.parameters.fields": "字段：{value}",
  "workspace.scripts.parameters.functions": "函数：{value}",
  "workspace.scripts.parameters.judgeLine.option": "判定线 {index}，{name}",
  "workspace.scripts.parameters.judgeLine.allocate": "分配空闲判定线",
  "workspace.scripts.parameters.judgeLine.allocateHint":
    "为这个参数选择一条空闲判定线；优先复用空闲线，没有时才新建。",
  "workspace.scripts.parameters.judgeLine.createdName": "脚本判定线",
  "workspace.scripts.parameters.judgeLine.remove": "移除未使用的脚本判定线",
  "workspace.scripts.parameters.judgeLine.modeLabel": "判定线输入方式",
  "workspace.scripts.parameters.judgeLine.mode.exact": "精确",
  "workspace.scripts.parameters.judgeLine.mode.range": "范围",
  "workspace.scripts.parameters.judgeLine.mode.global": "全局",
  "workspace.scripts.parameters.judgeLine.mode.exactHint": "严格使用这里写出的判定线，并保持顺序。",
  "workspace.scripts.parameters.judgeLine.mode.rangeHint":
    "写出候选判定线，由宿主随机挑选所需数量。",
  "workspace.scripts.parameters.judgeLine.mode.globalHint":
    "忽略写出的判定线，由宿主从谱面所有判定线中随机挑选。",
  "workspace.scripts.parameters.judgeLine.placeholder": "判定线列表，例如 1,3:5",
  "workspace.scripts.parameters.judgeLine.globalHint":
    "脚本运行时从谱面所有判定线中随机挑选 {count} 条。",
  "workspace.scripts.recipe.distributeNotes": "分布音符",
  "workspace.scripts.recipe.distributeNotesDescription": "将选中的音符分布到两个 X 位置之间。",
  "workspace.scripts.recipe.staggerEvents": "错开事件",
  "workspace.scripts.recipe.staggerEventsDescription": "偏移选中的事件值。",
  "workspace.scripts.recipe.fadeNotes": "淡化音符",
  "workspace.scripts.recipe.fadeNotesDescription": "缩放选中音符的透明度。",

  "workspace.history.title": "编辑历史",
  "workspace.history.description": "浏览编辑历史并撤回到之前的状态。",
  "workspace.history.emptyTitle": "还没有编辑历史",
  "workspace.history.empty": "第一次编辑后，这里会出现撤销历史。",
  "workspace.history.undo": "撤销历史",
  "workspace.history.redo": "重做分支",
  "workspace.history.affected": "影响 {count} 个对象",
  "workspace.history.revert": "撤回到这一步",
  "workspace.history.collaborativeUndo": "协作撤销",
  "workspace.history.undoUnavailable": "房间里没有可撤销的本人编辑。",
  "workspace.history.undoConflict": "无法撤销，这些路径已被修改：{paths}",
  "workspace.history.undoRejected": "撤销未能应用。",
  "workspace.history.redoUnavailable": "在协作房间中无法重做。",
  "workspace.history.codeCell": "代码单元",
  "workspace.history.discarded": "快照已丢弃",

  "workspace.welcome.settings": "设置",
  "workspace.welcome.more": "更多",
  "workspace.welcome.moreMenu": "更多操作",
  "workspace.welcome.importRpe": "从 RPE 导入…",
  "workspace.welcome.importDialog.title": "导入谱面",
  "workspace.welcome.importDialog.description":
    "选择 RPE 安装文件夹或其他受支持的谱面文件，也可以直接拖到下方。",
  "workspace.welcome.importDialog.dropTitle": "拖入文件夹或文件",
  "workspace.welcome.importDialog.dropActive": "松开即可导入",
  "workspace.welcome.importDialog.rpe": "选择 RPE 文件夹",
  "workspace.welcome.importDialog.external": "选择其它谱面",
  "workspace.welcome.drop.title": "松开即可导入",
  "workspace.welcome.drop.imported": "已导入 {name}",
  "workspace.welcome.drop.extensionDetected": "检测到扩展：{name}",
  "workspace.welcome.drop.skinDetected": "检测到皮肤：{name}",
  "workspace.welcome.drop.openSettings": "打开设置",
  "workspace.welcome.drop.invalidPackage": "无法验证包 {name}。",
  "workspace.welcome.drop.unsupported": "拖入的内容不是谱面、扩展或皮肤：{name}",
  "workspace.welcome.rpe.title": "从 RPE 迁移",
  "workspace.welcome.rpe.viewHotkeys": "查看键位对照",
  "workspace.welcome.rpe.pickFolder": "选择原版 RPE 安装文件夹",
  "workspace.welcome.rpe.chartCount": "{count} 张谱面",
  "workspace.welcome.rpe.settingsFound": "Settings.json",
  "workspace.welcome.rpe.hotkeysFound": "Hotkey.txt",
  "workspace.welcome.rpe.confirmTitle": "从 RPE 导入？",
  "workspace.welcome.rpe.confirmDescription":
    "将导入 {summary}，并把可识别的设置与快捷键合并到当前配置。",
  "workspace.welcome.rpe.confirm": "开始导入",
  "workspace.welcome.rpe.importing": "正在导入 {count} 张谱面…",
  "workspace.welcome.rpe.importingChart": "正在导入 {name}…",
  "workspace.welcome.rpe.done":
    "已导入 {charts} 张谱面，迁移 {settings} 项设置和 {shortcuts} 个快捷键，{warnings} 条警告。",
  "workspace.welcome.rpe.desktopOnly": "RPE 导入仅在桌面应用中可用。",
  "workspace.welcome.rpe.notFound":
    "没有找到 RPE 的 Settings.json、Hotkey.txt 或 Resources 谱面目录。",
  "workspace.welcome.external.title": "导入官谱或 PhiEdit 谱面",
  "workspace.welcome.external.importing": "正在导入 {name}…",
  "workspace.welcome.external.done": "已导入 {name}，{warnings} 条警告。",
  "workspace.welcome.external.desktopOnly": "官谱与 PhiEdit 导入仅在桌面应用中可用。",
  "workspace.welcome.external.notFound":
    "该文件或文件夹中没有找到 Phigros 官谱 JSON 或 PhiEdit PEC 谱面。",
  "workspace.welcome.external.missingChart": "压缩包中没有找到谱面文件。",
  "workspace.welcome.external.multipleCharts": "压缩包中有多个谱面文件：{names}。请逐个导入。",
  "workspace.welcome.external.mediaLimit": "谱面媒体文件超过 512 MB，其后的文件已被忽略。",
  "workspace.welcome.external.mediaUnreadable": "无法读取媒体文件：{name}",
  "workspace.welcome.importReport.title": "导入兼容性报告",
  "workspace.welcome.importReport.description": "{source}：共 {count} 项与原始谱面不同。",
  "workspace.welcome.importReport.action": "查看兼容性报告",
  "workspace.welcome.importReport.badge": "兼容性 {count} 项",
  "workspace.welcome.importReport.badgeHint": "查看这份谱面在导入时的差异",
  "workspace.welcome.importReport.more": "另有 {count} 项未显示。",
  "workspace.welcome.importReport.moreGroups": "另有 {count} 张谱面的报告未显示。",

  "workspace.welcome.library.empty": "这里还没有谱面",
  "workspace.welcome.library.emptyDescription": "新建或打开谱面，即可在这里找到它。",
  "workspace.welcome.library.unavailable": "谱面库暂时不可用",
  "workspace.welcome.library.retry": "重试",
  "workspace.welcome.library.stale": "正在显示上次加载的谱面。刷新失败：{message}",
  "workspace.welcome.library.field.charter": "谱师",
  "workspace.welcome.library.field.level": "难度",
  "workspace.welcome.library.detail.select": "选择一张谱面查看详情",
  "workspace.welcome.library.open": "打开",
  "workspace.welcome.library.export": "导出",
  "workspace.welcome.library.delete": "删除",
  "workspace.welcome.library.action.new": "新建谱面",
  "workspace.welcome.library.action.import": "导入谱面",
  "workspace.welcome.library.sort.label": "谱面排序",
  "workspace.welcome.library.sort.updated": "修改时间",
  "workspace.welcome.library.sort.created": "创建时间",
  "workspace.welcome.library.sort.name": "名称",
  "workspace.welcome.library.sort.composer": "曲师",
  "workspace.welcome.library.sort.charter": "谱师",
  "workspace.welcome.library.sort.newest": "新 > 旧",
  "workspace.welcome.library.sort.oldest": "旧 > 新",
  "workspace.welcome.library.sort.az": "A > Z",
  "workspace.welcome.library.sort.za": "Z > A",
  "workspace.welcome.library.view.label": "谱面视图",
  "workspace.welcome.library.view.list": "列表",
  "workspace.welcome.library.view.grid": "网格",
  "workspace.welcome.search.placeholder": "搜索谱面",
  "workspace.welcome.search.empty": "没有找到匹配的谱面。试试其他关键词。",

  "workspace.welcome.menu.label": "谱面菜单",

  "workspace.collaboration.title": "联机协作",
  "workspace.collaboration.description": "为当前谱面创建房间，或粘贴邀请链接加入。",
  "workspace.collaboration.defaultName": "成员",
  "workspace.collaboration.createTab": "创建房间",
  "workspace.collaboration.joinTab": "加入房间",
  "workspace.collaboration.create": "创建房间",
  "workspace.collaboration.join": "申请加入",
  "workspace.collaboration.leave": "离开房间",
  "workspace.collaboration.closeRoom": "关闭房间",
  "workspace.collaboration.closeRoomTitle": "关闭这个房间？",
  "workspace.collaboration.closeRoomBody":
    "所有成员都会被断开，房间数据会从这台设备删除。对方本地的副本仍会保留。",
  "workspace.collaboration.closeRoomConfirm": "关闭房间",
  "workspace.collaboration.roomClosed": "房主已关闭房间。",
  "workspace.collaboration.displayName": "显示名称",
  "workspace.collaboration.color": "指针颜色",
  "workspace.collaboration.hostMode": "托管方式",
  "workspace.collaboration.hostMode.tunnel": "Cloudflare Tunnel",
  "workspace.collaboration.hostMode.lan": "内网",
  "workspace.collaboration.lanPort": "内网端口",
  "workspace.collaboration.joinMethod": "加入方式",
  "workspace.collaboration.joinMethod.link": "邀请链接",
  "workspace.collaboration.joinMethod.custom": "自定义地址",
  "workspace.collaboration.serverUrl": "服务器地址",
  "workspace.collaboration.serverUrlPlaceholder": "ws://192.168.1.10:51234",
  "workspace.collaboration.changePassword": "更新房间密码",
  "workspace.collaboration.changePasswordPlaceholder": "输入新密码",
  "workspace.collaboration.updatePassword": "更新密码",
  "workspace.collaboration.showSecret": "显示",
  "workspace.collaboration.hideSecret": "隐藏",
  "workspace.collaboration.exitTitle": "退出并断开联机？",
  "workspace.collaboration.exitBody":
    "退出程序会断开房间连接。如果你是房主，其他成员也可能受到影响。",
  "workspace.collaboration.exitConfirm": "退出程序",
  "workspace.collaboration.password": "房间密码",
  "workspace.collaboration.invalidServerUrl": "请填写 ws:// 或 wss:// 服务器地址。",
  "workspace.collaboration.hostFailed": "无法创建房间：{detail}",
  "workspace.collaboration.sessionBusyTitle": "此设备已在房间中",
  "workspace.collaboration.sessionBusyBody":
    "同一个后端只能同时主持或加入一个房间。请先在另一个窗口离开房间，或关闭该窗口后再试。",
  "workspace.collaboration.sessionClaimFailed":
    "无法确认房间会话状态。请关闭其他 Redux 窗口后重试。",
  "workspace.collaboration.startingRoom": "正在启动房间……",
  "workspace.collaboration.joinHint":
    "粘贴邀请链接加入。除非房间允许自动编辑，否则仍需要房主批准。",
  "workspace.collaboration.joinInviteTitle": "加入这个房间？",
  "workspace.collaboration.joinInviteDescription":
    "这是一个联机房间邀请。加入前先看看当前有哪些成员。",
  "workspace.collaboration.joinInviteMembers": "房间成员",
  "workspace.collaboration.joinInviteCapacity": "{count}/{max} 人",
  "workspace.collaboration.joinInviteOnline": "在线",
  "workspace.collaboration.joinInviteOffline": "离线",
  "workspace.collaboration.joinInviteNoMembers": "目前没有可显示的成员。",
  "workspace.collaboration.joinInviteMembersUnavailable":
    "暂时无法预览房间成员，但仍可以尝试使用此邀请加入。",
  "workspace.collaboration.joinInviteConfirm": "加入房间",
  "workspace.collaboration.joinInviteCancel": "暂不加入",
  "workspace.collaboration.members": "成员",
  "workspace.collaboration.pending": "等待批准",
  "workspace.collaboration.you": "你",
  "workspace.collaboration.role.host": "房主",
  "workspace.collaboration.role.editor": "可编辑",
  "workspace.collaboration.role.viewer": "只读",
  "workspace.collaboration.roleLabel": "{name} 的权限",
  "workspace.collaboration.kick": "移除成员",
  "workspace.collaboration.kickTitle": "移除这个成员？",
  "workspace.collaboration.kickBody": "将 {name} 移出房间？对方本地的副本仍会保留。",
  "workspace.collaboration.kickConfirm": "移除",
  "workspace.collaboration.maxMembers": "最大人数",
  "workspace.collaboration.approveEditor": "允许编辑",
  "workspace.collaboration.approveViewer": "允许查看",
  "workspace.collaboration.reject": "拒绝",
  "workspace.collaboration.copyInviteLink": "复制邀请链接",
  "workspace.collaboration.inviteLink": "邀请链接",
  "workspace.collaboration.inviteLinkPlaceholder": "rperedux://join?...",
  "workspace.collaboration.inviteLinkCopied": "邀请链接已复制。",
  "workspace.collaboration.invalidInviteLink": "邀请链接无效。",
  "workspace.collaboration.invalidRoomDetails": "请填写服务器地址和房间密码。",
  "workspace.collaboration.autoApproveEditor": "允许新加入成员编辑",
  "workspace.collaboration.autoApproveHint": "拿到链接者直接以编辑身份加入",
  "workspace.collaboration.copyFailed": "无法复制邀请链接。",
  "workspace.collaboration.e2eOverwrite":
    "加密房间按版本顺序应用修改。并发编辑覆盖了此文档中的字段，已保留本地恢复副本。",
  "workspace.collaboration.recovery": "本地恢复副本",
  "workspace.collaboration.recoveryHint": "被拒绝的本地修改会保留在这里，丢弃前请先下载。",
  "workspace.collaboration.reapplyMine": "重新应用我的版本",
  "workspace.collaboration.resumeTitle": "恢复上次的协作房间？",
  "workspace.collaboration.resumeBody":
    "上次主持的房间仍在这台设备上。恢复后将以房间谱面为准，并替换当前文档。",
  "workspace.collaboration.resumeAction": "恢复房间",
  "workspace.collaboration.lockDeniedRetry": "房间无法保留这次编辑，请等其他成员释放后重试。",
  "workspace.collaboration.rebaseLabel": "重新应用：{label}",
  "workspace.collaboration.unsent": "未发送的修改",
  "workspace.collaboration.unsentHint":
    "房间没有接受这些编辑。可以重试、覆盖到当前房间谱面，或放弃。",
  "workspace.collaboration.unsentRetry": "重试",
  "workspace.collaboration.unsentRebase": "重新应用",
  "workspace.collaboration.unsentDiscard": "放弃",
  "workspace.collaboration.downloadRecovery": "下载副本",
  "workspace.collaboration.clearRecovery": "丢弃副本",
  "workspace.collaboration.invalidSnapshot": "房间快照无效：{detail}",
  "workspace.collaboration.roomChart": "房间谱面",
  "workspace.collaboration.joined": "已加入联机房间。",
  "workspace.collaboration.waitingApproval": "已连接，等待房主批准…",
  "workspace.collaboration.reconnecting": "连接中断，正在重连…",
  "workspace.collaboration.reconnected": "已重新连接联机房间。",
  "workspace.collaboration.connectionLost": "联机连接已断开。",
  "workspace.collaboration.connectionFailed": "无法连接联机服务器。",
  "workspace.collaboration.compatibilityMismatch":
    "此客户端与联机服务器不兼容。请更新 RPE Redux 后重试。",
  "workspace.collaboration.versionDifferenceWarning":
    "双方 RPE Redux 产品版本不同，但当前联机协议兼容，可以继续协作。",
  "workspace.collaboration.connectionTimeout": "连接联机服务器超时，请检查地址和网络。",
  "workspace.collaboration.handshakeTimeout": "联机服务器已接受连接，但没有及时响应，请重试。",
  "workspace.collaboration.connectionClosed": "房间就绪前联机连接已断开。",
  "workspace.collaboration.heartbeatTimeout": "联机连接长时间没有响应，正在重连…",
  "workspace.collaboration.statusLabel": "状态",
  "workspace.collaboration.joiningRoom": "正在加入房间…",
  "workspace.collaboration.remoteSnapshot": "房间快照",
  "workspace.collaboration.applyFailed": "无法应用房间修改。",
  "workspace.collaboration.conflictNotice": "其他成员修改了相同内容，已请求当前房间版本。",
  "workspace.collaboration.invalidRemoteChange": "远端修改生成了无效谱面，已请求当前房间版本。",
  "workspace.collaboration.roleChanged": "你的房间权限已变更为 {role}。",
  "workspace.collaboration.roleChangedReason": "你的房间权限已变更为 {role}：{reason}",
  "workspace.collaboration.replaceDirtyTitle": "加入房间并替换当前文档？",
  "workspace.collaboration.replaceDirtyBody":
    "当前谱面有未保存修改。房间谱面替换当前文档前，会先把本地谱面写入文档恢复存储；后续发生冲突时会再保留一份恢复副本。房间谱面保存为新的本地谱面库项目，不会写回原文件或原项目。",
  "workspace.collaboration.recoveryWriteFailed":
    "无法写入本地恢复副本，因此没有加入房间。请先保存或导出当前谱面，然后重试。",
  "workspace.collaboration.continue": "继续",
  "workspace.collaboration.status.idle": "未连接",
  "workspace.collaboration.status.connecting": "正在连接",
  "workspace.collaboration.status.waiting": "等待房主批准",
  "workspace.collaboration.status.connected": "已连接",
  "workspace.collaboration.status.reconnecting": "正在重连",
  "workspace.collaboration.status.offline": "已离线",
  "workspace.collaboration.status.error": "连接错误",
  "workspace.collaboration.queued": "{count} 项修改等待确认",
  "workspace.collaboration.location.none": "暂无位置",
  "workspace.collaboration.location.global": "Global，{section}",
  "workspace.collaboration.location.edit": "编辑，节拍 {beat}",
  "workspace.collaboration.location.design": "Design",
  "workspace.collaboration.assets": "资源",
  "workspace.collaboration.assetSyncHint": "资源按内容哈希同步，校验通过后才会替换本地副本。",
  "workspace.collaboration.assetSyncing": "同步中",
  "workspace.collaboration.locks": "编辑锁",
  "workspace.collaboration.locked": "{owners} 正在编辑 {objects}，请等待或让对方先完成。",
  "workspace.collaboration.lockTimeout":
    "房间未响应编辑锁请求，本次修改尚未发送；连接稳定后请重试。",
  "workspace.collaboration.queueFull":
    "待发送的修改过多，已停止继续排队。请先保存当前谱面，再重新连接房间。",
  "workspace.collaboration.someone": "其他成员",
  "workspace.collaboration.assetUploadFailed":
    "谱面资源上传失败。修改已保留在本地，请检查连接后重试。",

  "guide.title": "完整上手引导",
  "guide.navigation": "引导主题",
  "guide.search.label": "搜索帮助",
  "guide.search.placeholder": "搜索帮助主题",
  "guide.search.empty": "没有匹配的帮助主题。",
  "guide.category.workflow": "工作流",
  "guide.category.editing": "编辑",
  "guide.category.tools": "工具",
  "guide.category.collaboration": "AI 与协作",
  "guide.category.app": "应用",
  "guide.category.extensions": "扩展",
  "guide.sectionCount": "{current} / {total}",
  "guide.section.overview.title": "从这里开始",
  "guide.section.overview.summary":
    "RPE Redux 围绕一条主流程组织：准备谱面，在时间线上放置内容，在画布中调整，再检查并导出结果。",
  "guide.section.overview.tip1": "首页负责谱面文件和谱面库；编辑器窗口一次管理一张打开的谱面。",
  "guide.section.overview.tip2":
    "工具栏决定显示内容和时间划分；时间线适合精确选择，画布适合观察和摆放。",
  "guide.section.overview.tip3":
    "大多数编辑都可以撤销。导出前可以使用 Ctrl+Z、历史面板和谱面错误检查。",
  "guide.section.inspector.title": "Inspector 基础",
  "guide.section.inspector.summary":
    "Inspector 是右侧随上下文变化的属性面板，会根据选中的音符、事件、判定线或工具切换内容。",
  "guide.section.inspector.tip1":
    "没有选中对象时，可以通过面板卡片打开谱面信息、时值、判定线、资源、历史等工作流。",
  "guide.section.inspector.tip2":
    "打开面板后，标题栏的问号会跳到该面板对应的教程；X 会关闭面板并把焦点还给编辑器。",
  "guide.section.inspector.tip3":
    "字段由所属功能负责提交；无效值会保留并显示原因，不会悄悄修改谱面。",
  "guide.section.inspector.tip4":
    "Inspector 和侧边栏使用同一套注册入口，从任意位置打开的面板行为都一致。",
  "guide.section.home.title": "首页与谱面库",
  "guide.section.home.summary":
    "在首页新建空白谱面、导入已有 RPE 谱面、重新打开最近作品，并管理本地谱面库。",
  "guide.section.home.tip1":
    "“新建谱面”会创建空白文档；“导入”支持 RPE 文件夹或其他受支持的谱面文件，首页也支持直接拖入文件。",
  "guide.section.home.tip2":
    "点击谱面库卡片即可继续编辑；谱面库保存谱面身份，编辑器负责未保存修改。",
  "guide.section.home.tip3":
    "请经常保存。“导出”用于完成谱面或交付副本，与保存当前工作文档是两件事。",
  "guide.section.toolbar.title": "工具栏与播放控制",
  "guide.section.toolbar.summary":
    "第一行控制播放和当前编辑上下文，第二行控制可见区域以及画布视角。",
  "guide.section.toolbar.tip1":
    "放置音符前先选择判定线、拍子划分和播放倍率。判定线输入框支持单个编号、范围和组合。",
  "guide.section.toolbar.tip2": "用“音符”“事件”“预览”按钮给当前任务需要的画布留出空间。",
  "guide.section.toolbar.tip3": "网格数量改变横向轨道划分；预览比例改变渲染出来的预览画面比例。",
  "guide.section.toolbar.tip4":
    "自由视角允许在画布中缩放和平移；居中回到合适取景，重置恢复默认视角。",
  "guide.section.timeline.title": "时间线",
  "guide.section.timeline.summary":
    "时间线是精确编辑音符和事件的工作区，标尺、播放头、选择状态和右键菜单相互配合。",
  "guide.section.timeline.tip1":
    "将指针移到音符画布上查看拍子和轨道，然后点击选择，或使用放置音符快捷键。",
  "guide.section.timeline.tip2": "事件画布用于编辑判定线变化；拖出范围可以让操作影响多个对象。",
  "guide.section.timeline.tip3":
    "播放头和播放控制使用同一谱面时间；长谱面检查时可以使用标记和跳转。",
  "guide.section.timeline.tip4":
    "在时间线对象上点击右键可以使用上下文操作；Ctrl+C/V、Delete 和 Ctrl+Z 遵循当前选择。",
  "guide.section.stage.title": "画布与预览",
  "guide.section.stage.summary":
    "画布展示谱面最终的视觉效果，也承载判定线、曲线、采样和预览覆盖层等直接操作工具。",
  "guide.section.stage.tip1": "需要对照谱面和实时游戏式结果时，可以切换预览区域。",
  "guide.section.stage.tip2": "拖动判定线控制点，并通过判定线信息覆盖层确认当前操作的是哪一条线。",
  "guide.section.stage.tip3":
    "采样工具会显示起点、终点和缓动；拖动辅助线时按住 Shift 可以临时隐藏辅助线。",
  "guide.section.stage.tip4": "曲线预览、批量控制、音频分析和 Extension 覆盖层也会显示在画布中。",
  "guide.section.metadata.title": "谱面信息",
  "guide.section.metadata.summary":
    "谱面信息是文档的第一个 Inspector 目的地，包含身份、作者信息、难度、时值和媒体引用。",
  "guide.section.metadata.tip1":
    "尽早填写曲名、曲师、谱师、难度和时值，让导出文件和谱面库卡片更容易识别。",
  "guide.section.metadata.tip2":
    "修改谱面信息属于普通谱面编辑，会随文档保存；它本身不会改变音符拍子。",
  "guide.section.metadata.tip3": "导入其他格式的谱面后，先在这里核对导入值，再开始编辑内容。",
  "guide.section.notes.title": "音符编辑",
  "guide.section.notes.summary":
    "“音符编辑”面板显示选中音符的属性；时间线和画布会同时以视觉方式展示相同的选择。",
  "guide.section.notes.tip1":
    "先选中音符，再在一个面板中修改拍子、轨道位置、类型、大小、颜色等字段。",
  "guide.section.notes.tip2":
    "Tap、Drag、Flick 和 Hold 的必填字段不同；Hold 使用起止时间，未完成放置时按 Esc 取消。",
  "guide.section.notes.tip3":
    "时间线适合精确定位拍子，画布适合建立空间直觉；两边的修改都可以撤销。",
  "guide.section.notes.tip4": "多选编辑可以对一组对象应用同一属性变化；大范围提交前请先检查预览。",
  "guide.section.events.title": "事件编辑",
  "guide.section.events.summary":
    "事件在一段拍子范围内改变判定线属性和视觉效果；Inspector 负责编辑选中事件及其缓动。",
  "guide.section.events.tip1":
    "先设置开始和结束拍，再调整数值；范围必须保持有序并处于谱面可用时间内。",
  "guide.section.events.tip2": "可以选择缓动预设，也可以编辑曲线来制作自定义的加速过程。",
  "guide.section.events.tip3":
    "着色器事件会在自己的区域展示参数；全局开关和事件顺序都应有意识地设置。",
  "guide.section.lines.title": "判定线与多线编辑",
  "guide.section.lines.summary":
    "判定线负责游玩区域的几何和事件。“判定线”抽屉编辑单条判定线，“多线编辑”用于并排比较多条线。",
  "guide.section.lines.tip1":
    "使用工具栏的判定线选择器跳转；Inspector 中的判定线表单是该判定线属性的编辑入口。",
  "guide.section.lines.tip2": "多线编辑适合批量应用表达式，或不离开当前谱面就比较多条线的数值。",
  "guide.section.lines.tip3":
    "保持判定线顺序和父子关系清晰；一处视觉变化可能影响挂在该线上的全部音符。",
  "guide.section.timing.title": "时值与 BPM",
  "guide.section.timing.summary": "时值点决定时间线、播放和导出谱面使用的拍子到时间的换算。",
  "guide.section.timing.tip1": "在左侧列表新建或选中时值点，再在属性列编辑 BPM 和偏移。",
  "guide.section.timing.tip2": "自动测时适合作为起点；放置密集配置前，请结合实际音频试听并核对。",
  "guide.section.timing.tip3":
    "修改时值会改变拍子的解释，不会直接改写音符拍子。大范围调整前建议先保存一个检查点。",
  "guide.section.assets.title": "资源库",
  "guide.section.assets.summary":
    "“资源”抽屉整理谱面图片、音频、皮肤和其他资源，并显示选中资源的属性。",
  "guide.section.assets.tip1": "在左侧列表选择资源，在属性列检查它的用途、路径或谱面引用。",
  "guide.section.assets.tip2":
    "分享或导出时尽量使用稳定的谱面本地资源，确保另一台机器能解析到相同文件。",
  "guide.section.assets.tip3": "导入资源显示异常时，先检查资源条目，再修改音符或判定线数据。",
  "guide.section.curve.title": "曲线音符",
  "guide.section.curve.summary":
    "曲线音符会把起点和终点选择转换成一串有形状的音符；“曲线音符”面板负责生成参数。",
  "guide.section.curve.tip1":
    "在时间线或画布中选择曲线起点和终点，再打开“曲线音符”设置密度、路径和方向。",
  "guide.section.curve.tip2": "提交前先预览生成结果；生成后的音符仍然是普通可编辑音符。",
  "guide.section.curve.tip3": "需要独立检查或调整路径时，使用“曲线轨迹”面板。",
  "guide.section.trajectory.title": "曲线轨迹",
  "guide.section.trajectory.summary":
    "轨迹工具描述曲线端点之间的路径，帮助你预览曲线在画布中的运动方式。",
  "guide.section.trajectory.tip1":
    "按要求选择起点和终点，并保持顺序明确，这样轨迹范围不会产生歧义。",
  "guide.section.trajectory.tip2": "用预览检查路径是否离开预期轨道，或意外穿过其他判定线区域。",
  "guide.section.trajectory.tip3": "轨迹确认后回到“曲线音符”面板，生成或调整真正的音符序列。",
  "guide.section.history.title": "历史与撤销",
  "guide.section.history.summary":
    "历史面板展示可逆修改，并允许你定位并回退某一次有意义的编辑，而不丢失文档其他内容。",
  "guide.section.history.tip1":
    "局部编辑最快使用 Ctrl+Z/Y；需要确认具体修改时，打开历史面板更合适。",
  "guide.section.history.tip2": "回退较早条目会产生新的状态，而不是悄悄重写文档过去的历史。",
  "guide.section.history.tip3":
    "协作时，远程修改和本地撤销权限保持区分，避免一个成员意外抹掉另一个成员的工作。",
  "guide.section.issues.title": "谱面错误",
  "guide.section.issues.summary":
    "谱面错误面板收集可疑重叠和无效组合，并允许你定位到受影响的对象。",
  "guide.section.issues.tip1": "点击错误条目跳转到对象，然后修正源音符或事件，不要只隐藏警告。",
  "guide.section.issues.tip2": "批量编辑、曲线生成或时值修改后，建议重新检查谱面错误。",
  "guide.section.issues.tip3":
    "空面板表示当前检查器没有发现已知类型的问题，不代表可以跳过视觉检查。",
  "guide.section.multiEdit.title": "多选编辑",
  "guide.section.multiEdit.summary":
    "多选编辑可以同时修改多个选中的音符或事件，并在提交前显示待应用的预览。",
  "guide.section.multiEdit.tip1":
    "在时间线上框选多个对象，或使用系统选择修饰键扩展选择，再打开多选编辑面板。",
  "guide.section.multiEdit.tip2":
    "只有选择中共有的字段才会显示；不同值会显示为混合状态，直到你选择新的值。",
  "guide.section.multiEdit.tip3": "先检查预览再一次性提交；整批修改会作为一条可撤销的历史记录。",
  "guide.section.audio.title": "音频、波形与频谱",
  "guide.section.audio.summary":
    "音频相关表面帮助你让谱面和歌曲对齐、观察瞬态，但它们本身不会直接修改谱面对象。",
  "guide.section.audio.tip1": "波形和频谱会跟随当前谱面音频及时间范围，用来定位起音和安静片段。",
  "guide.section.audio.tip2": "音频分析只是视觉参考；提交密集音符前仍应结合播放和时值点确认。",
  "guide.section.audio.tip3": "音频显示异常时先检查谱面信息和资源面板；修改音符不能修复缺失资源。",
  "guide.section.scripts.title": "扩展与脚本",
  "guide.section.scripts.summary":
    "“脚本”面板运行已安装 Extension 提供的动作，并显示动作声明的参数。",
  "guide.section.scripts.tip1": "运行前先阅读 Extension 的说明和所请求的能力。",
  "guide.section.scripts.tip2":
    "参数表单会在边界校验；动作失败时，除非动作报告已提交编辑，否则谱面不会被修改。",
  "guide.section.scripts.tip3":
    "Extension 的安装、启用和权限在设置中管理；脚本面板是执行入口，不是包管理器。",
  "guide.section.ai.title": "AI 活动",
  "guide.section.ai.summary":
    "AI 活动面板展示通过本地代码单元桥接发送的请求，让编辑器侧的审计记录可见。",
  "guide.section.ai.tip1": "只有启用了相关 AI 访问设置，并且客户端发出请求后，面板才会显示。",
  "guide.section.ai.tip2": "对大范围修改先检查请求和结果；桥接仍然遵守编辑器自己的事务规则。",
  "guide.section.ai.tip3":
    "AI 活动主要是会话记录。值得保留的生成结果请保存到谱面，不要把活动列表当作永久历史。",
  "guide.section.collaboration.title": "协作",
  "guide.section.collaboration.summary":
    "协作把多个编辑器连接到同一个房间，提供在线状态、编辑锁、邀请和资源同步。",
  "guide.section.collaboration.tip1":
    "在“协作”面板创建房间或加入邀请，然后先确认成员列表和角色再开始编辑。",
  "guide.section.collaboration.tip2":
    "编辑锁会保护其他成员正在修改的对象；锁未释放时请等待，不要反复重试被拒绝的编辑。",
  "guide.section.collaboration.tip3":
    "房间链接、密码和上传的媒体属于共享房间凭据；结束会话后请离开房间。",
  "guide.section.recording.title": "录制与导出",
  "guide.section.recording.summary":
    "录制用于检查或展示画布，导出用于交付谱面；工作文档仍然保持可编辑。",
  "guide.section.recording.tip1": "录制前先设置可见区域、预览比例和相机取景，让输出符合预期构图。",
  "guide.section.recording.tip2": "使用播放控制选择准确范围，并在开始录制前确认音频和视觉覆盖层。",
  "guide.section.recording.tip3":
    "把视频和导出谱面当作输出文件；继续保存源谱面，作为唯一可编辑的正式文件。",
  "guide.section.document.title": "保存、导出与恢复",
  "guide.section.document.summary": "文档命令区分可编辑工作谱面、导出包、备份和恢复快照。",
  "guide.section.document.tip1":
    "“保存”会把当前谱面写入工作项目；“另存为”创建新的目标位置，不会改变谱面内容。",
  "guide.section.document.tip2":
    "“导出”会创建用于交付的受支持格式文件；分享前请检查谱面信息、时值、资源和错误。",
  "guide.section.document.tip3":
    "应用或服务恢复草稿时，先与上次保存的项目比较，再决定是否替换已知正常的文件。",
  "guide.section.settings.title": "设置与外观",
  "guide.section.settings.summary":
    "设置控制应用行为、编辑器密度、快捷键、音频、Extension、语言、主题和帮助入口。",
  "guide.section.settings.tip1":
    "使用设置搜索快速定位选项；每个描述都会说明它影响首页、编辑器还是运行时。",
  "guide.section.settings.tip2":
    "快捷键页面只改变命令绑定，不会改变命令本身；迁移后不熟悉时可以恢复默认值。",
  "guide.section.settings.tip3": "外观和语言修改会即时生效；帮助页包含本引导、更新日志和产品信息。",
  "guide.section.shortcuts.title": "键盘工作流",
  "guide.section.shortcuts.summary":
    "键盘快捷键让精确编辑更快，同时所有工具栏动作也可以从菜单和可见控件中使用。",
  "guide.section.shortcuts.tip1":
    "音符画布激活时，Q/W/E/R 放置 Tap、Drag、Flick、Hold；未完成操作按 Esc 取消。",
  "guide.section.shortcuts.tip2":
    "Ctrl+Z/Y 撤销和重做；Ctrl+C/V 与 Delete 遵循当前选择。可以在快捷键设置中重新绑定。",
  "guide.section.shortcuts.tip3":
    "逐步教程使用左右方向键切换步骤；其余键盘工作流可以在快捷键设置中调整。",

  "tutorial.metadata.identity.title": "填写谱面身份信息",
  "tutorial.metadata.identity.body":
    "先填写曲名、曲师、谱师和难度。它们会出现在谱面库、导出结果和协作信息中；这里的修改只更新文档信息，不会自动改动音符。",
  "tutorial.metadata.timing.title": "补全制作信息",
  "tutorial.metadata.timing.body":
    "填写曲师、谱师、插画和难度。它们会出现在谱面库、导出结果和协作信息中；这里的修改只更新文档信息，不会自动改动音符。",
  "tutorial.metadata.resources.title": "核对媒体引用",
  "tutorial.metadata.resources.body":
    "在资源区域确认歌曲和背景文件已经关联到当前谱面。导入或移动文件后重新检查路径与预览，避免把缺失资源误判成音符或判定线问题。",

  "tutorial.timing.open.title": "认识时值工作区",
  "tutorial.timing.open.body":
    "左侧是时值点列表，右侧是当前选中点的属性。时值点属于谱面数据，会影响拍子如何换算成真实时间。",
  "tutorial.timing.select.title": "选择一个时值点",
  "tutorial.timing.select.body":
    "先点击列表中的时值点；编辑器会把播放位置移到它的拍子。顶部的偏移行代表整张谱面的音频对齐偏移，不是单个时值点。",
  "tutorial.timing.edit.title": "修改 BPM 和起始拍",
  "tutorial.timing.edit.body":
    "在属性区修改起始拍和 BPM，离开输入框后提交。新增点会使用当前播放位置和附近的 BPM；删除前确认后续音符仍有正确的节拍解释。",
  "tutorial.timing.verify.title": "用音频核对结果",
  "tutorial.timing.verify.body":
    "自动测时只适合作为起点。播放音频并观察时间线与画布；密集放置音符前，至少用几个明显的起音核对时值是否准确。",
  "tutorial.lines.choose.title": "选择判定线",
  "tutorial.lines.choose.body":
    "左侧树展示判定线和分组。点击一条线进入属性页；选择分组时，右侧会显示分组操作，而不是误把分组当成单条线。",
  "tutorial.lines.edit.title": "编辑判定线属性",
  "tutorial.lines.edit.body":
    "在属性页修改名称、锚点、层级、遮罩、贴图和 BPM 因子。这里直接修改谱面数据，改动会影响挂在该线上的音符和事件。",
  "tutorial.lines.organize.title": "整理分组和父子关系",
  "tutorial.lines.organize.body":
    "用分组保持多条线的结构，用父线和继承旋转表达跟随关系。批量选择时只显示安全的共同字段，混合值需要你明确指定后才会写入。",
  "tutorial.lines.check.title": "回到画布检查",
  "tutorial.lines.check.body":
    "修改判定线后回到画布观察位置、遮罩和贴图，再播放一小段确认音符仍在预期区域。遇到大范围修改，先用历史记录保留可回退点。",
  "tutorial.assets.browse.title": "浏览素材库",
  "tutorial.assets.browse.body":
    "左侧列表是当前谱面的素材条目，右侧属性页只编辑选中的素材。素材库管理文件引用，不会自动替你修改音符或判定线。",
  "tutorial.assets.inspect.title": "检查素材属性",
  "tutorial.assets.inspect.body":
    "选中素材后先查看类型、路径和引用关系。音频、背景和贴图的用途不同；不要只根据文件名判断它最终会出现在哪个画面。",
  "tutorial.assets.import.title": "导入并保持路径稳定",
  "tutorial.assets.import.body":
    "通过素材库的导入动作添加文件，尽量使用谱面项目内稳定的相对资源。分享或导出前，确认目标机器能够解析同样的文件路径。",
  "tutorial.assets.verify.title": "验证实际引用",
  "tutorial.assets.verify.body":
    "导入后回到谱面信息和画布检查音频、封面或贴图是否真的被使用。若预览缺失，先修复素材条目和路径，再去改谱面数据。",

  "onboarding.title": "快速上手",
  "onboarding.kicker": "快速上手",
  "onboarding.progress": "{current} / {total}",
  "onboarding.choice.title": "你想怎么开始？",
  "onboarding.choice.note": "之后可以在 设置 > 帮助 > 显示上手引导 中重新打开。",
  "onboarding.choice.rpe.title": "我熟悉 RPE",
  "onboarding.choice.rpe.description": "导入现有谱面，并了解这个编辑器与 RPE 的差异。",
  "onboarding.choice.new.title": "我没有写过谱面",
  "onboarding.choice.new.description":
    "新建一张谱面，按步骤了解基本信息、侧边栏、视角、放置音符和修改参数。",
  "onboarding.choice.none.title": "不需要指引",
  "onboarding.choice.none.description": "直接进入首页。",
  "onboarding.start.rpe.title": "导入你的 RPE 谱面",
  "onboarding.start.rpe.body":
    "随时点击高亮的更多菜单并选择导入。对话框支持 RPE 文件夹或其他受支持的谱面文件，主界面也接受直接拖入文件夹或文件。导入的谱面会出现在谱面库；打开任意一张，指引会自动继续。",
  "onboarding.start.new.title": "新建一张谱面",
  "onboarding.start.new.body": "点击高亮的“新建谱面”按钮。空白谱面打开后，指引会自动继续。",
  "onboarding.metadata.title": "填写谱面信息",
  "onboarding.metadata.body":
    "点击高亮的输入框，填写曲名、曲师、谱师和难度；这些字段之后都可以修改。",
  "onboarding.sidebar.title": "右侧工具栏",
  "onboarding.sidebar.body": "点击图标会展开标签并打开对应页面。每个入口对应一套工作流。",
  "onboarding.sidebar.history": "撤销历史和编辑记录。",
  "onboarding.sidebar.multiLine": "并排编辑多条判定线。",
  "onboarding.sidebar.curve": "绘制和编辑曲线音符。",
  "onboarding.sidebar.trajectory": "曲线轨迹工具和预览。",
  "onboarding.sidebar.scripts": "运行扩展脚本和动作。",
  "onboarding.sidebar.codeCell": "查看 AI 客户端发给编辑器的请求。",
  "onboarding.sidebar.collaboration": "联机房间和成员控制。",
  "onboarding.sidebar.recording": "录制和导出控制。",
  "onboarding.sidebar.generic": "打开这个页面。",
  "onboarding.view.title": "切换视图",
  "onboarding.view.body":
    "工具栏第二行可以显示或隐藏音符区、事件区和实时预览。画布太挤时可以用它整理工作区。",
  "onboarding.camera.title": "自由视角",
  "onboarding.camera.body":
    "在工具栏第二行打开自由视角：滚轮缩放，拖动平移，居中回正，重置恢复默认视角。",
  "onboarding.notes.title": "放置音符",
  "onboarding.notes.newBody":
    "将指针移到音符区选择拍子和轨道。按 Q/W/E/R 放置 Tap/Drag/Flick/Hold；Hold 需点击两次，Esc 取消。",
  "onboarding.notes.rpeBody":
    "将指针移到目标拍子和轨道，按 Q/W/E/R 放置 Tap/Drag/Flick/Hold。Hold 需点击两次，Esc 取消。",
  "onboarding.parameters.title": "修改音符参数",
  "onboarding.parameters.body":
    "在时间线上选中音符，然后在右侧检查器中修改拍子、位置、类型等字段。Ctrl+Z 撤销。",
  "onboarding.finish.title": "可以开始了",
  "onboarding.finish.body":
    "现在可以从首页新建或导入谱面。需要时随时在 设置 > 帮助 中重新打开这份指引。",
  "onboarding.action.previous": "上一步",
  "onboarding.action.next": "下一步",
  "onboarding.action.skip": "跳过指引",
  "onboarding.action.finish": "开始编辑",
} as const;
