# FORK_CHANGES

本 fork（阅读档案 / Reading Archive）对上游 readest 文件的**每一处修改**都登记在此。
新功能代码全部位于独立目录 `apps/readest-app/src/features/archive/` 与 `apps/readest-app/src/app/archive/`，不在此列。

原则：上游文件改动必须极小、位置稳定、带 `Fork feature` 注释锚点，便于 rebase。

## 上游文件改动清单

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `apps/readest-app/src/services/database/migrations/index.ts` | 顶部新增一条 import；`migrations` 表新增 `archive: ARCHIVE_MIGRATIONS` 键 | archive.db 的 schema 迁移注册（迁移框架的既定扩展点） |
| `apps/readest-app/src/types/settings.ts` | 新增 `ArchiveSettings` 接口；`SystemSettings` 增加 `archive: ArchiveSettings` 字段 | 档案模块设置组（PRD 0.4 模块开关） |
| `apps/readest-app/src/services/constants.ts` | import `ArchiveSettings`；新增 `DEFAULT_ARCHIVE_SETTINGS`；`DEFAULT_SYSTEM_SETTINGS` 增加 `archive` 默认值 | 同上 |
| `apps/readest-app/src/services/settingsService.ts` | import `DEFAULT_ARCHIVE_SETTINGS`；`loadSettings` 中合并 `settings.archive` 缺省字段 | 老配置升级时补默认值 |
| `apps/readest-app/src/components/settings/SettingsDialog.tsx` | import ArchivePanel/PiBooks；`SettingsPanelType` 增加 `'Archive'`；tabConfig/panelMap/resetFunctions 各加一项；渲染分支加 `<ArchivePanel />` | 设置面板入口 `Settings > Archive` |
| `apps/readest-app/src/services/commandRegistry.ts` | import 加 `PiBooks`；`panelIcons` 增加 `Archive: PiBooks` 条目 | 设置面板图标（类型要求全集覆盖） |
| `apps/readest-app/src/app/library/page.tsx` | 顶部 import `ensureArchiveEntries`；`initLibrary` 在 setLibrary 后 fire-and-forget 调用 | PRD A1 导入即自动建档 |
| `apps/readest-app/src/app/library/components/LibraryHeader.tsx` | import PiBooks/useRouter/useSettingsStore；hooks 区加 router/archiveEnabled；头部按钮区条件渲染一个入口图标按钮 | 书库页 → 档案页导航入口 |
| `apps/readest-app/src/app/library/components/SettingsMenu.tsx` | 「Settings」菜单项前插入条件渲染的「Reading Archive」MenuItem | 菜单入口 |
| `apps/readest-app/src/utils/sel.ts` | `getPosition` 增加可选第 5 参 `preferDir?: 'up' \| 'down'`，仅在两端均在视口内时覆盖空间权衡 | 模块 W：移动 Web 端原生选择工具栏避让 |
| `apps/readest-app/src/app/reader/components/annotator/Annotator.tsx` | import `isWebAppPlatform`；[selection] effect 与 `repositionPopups` 两处调用 getPosition 时在「移动 Web + 横排文本」下传 `preferDir: 'down'` | 同上（划线工具栏改到选区下方，避开浏览器原生弹层） |
| `apps/readest-app/src/app/reader/components/ReaderContent.tsx` | import SessionIndicator/useArchiveSession；hooks 区调用 `useArchiveSession(bookKeys[0], hash)`；渲染区挂 `<SessionIndicator />` | 模块 B/C1：阅读会话自动追踪 + 角落计时入口 |
| `apps/readest-app/src/__tests__/services/command-registry-extended.test.ts` | `react-icons/pi` mock 增加 `PiBooks` | 适配 panelIcons 新增条目 |

## Fork 新增目录

- `apps/readest-app/src/features/archive/` — 数据层（db/）、业务（library/、sync/）、UI 组件、hook
- `apps/readest-app/src/app/archive/` — `/archive` 列表页与 `/archive/detail` 详情页路由
- `FORK_CHANGES.md`

## 关闭模块 = 回到上游

`Settings > Archive > Enable Reading Archive` 关闭后：
- LibraryHeader / SettingsMenu 的入口隐藏；
- library 页初始化跳过建档同步；
- `/archive` 路由重定向回书库。
其余行为与上游一致。已写入的 archive.db 数据保留在磁盘（`<AppData>/Readest/Data/archive.db`），不影响任何上游功能。

## Rebase 提示

冲突高发点为 `migrations/index.ts`（上游会持续追加 migration）。解法：保留双方条目即可——
我们的 `archive:` 键与其余 schema 数组互不相干。
