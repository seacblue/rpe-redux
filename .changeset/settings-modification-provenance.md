---
"rpe-redux": minor
---

### 中文

**新增功能**

- 设置项和快捷键绑定现在会记录用户是否主动修改过。即使改回默认值，该记录也会保留；点击“恢复默认”会清除记录。导入、迁移和自动修复不会把值标记为用户修改。

### English

**Features**

- Settings values and shortcut bindings now record whether the user explicitly modified them. The record survives a value returning to its default, and the row's reset action clears it. Imports, migrations, and automatic repairs do not mark a value as user-modified.
