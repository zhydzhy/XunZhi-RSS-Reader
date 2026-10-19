# Progress

## 2026-10-17 — 移植范围与同步方案调查

- 问题：当前工程只有 ArkTS Hello World，尚无 NetNewsWire 业务代码；首版要求同步服务，并覆盖手机、折叠屏、平板和鸿蒙电脑。
- 原因分析：最初列出的同步选项仅包含现成 RSS 服务，遗漏华为原生端云同步，不能据此确定账户和存储架构。
- 处理：核实项目 target/compatible SDK 均为 26.0.0，本机 SDK 为 API 26、26.0.0.105 Release。确认本地 ArkData API 存在 relationalStore.cloudSync 和 DISTRIBUTED_CLOUD；华为另提供 Cloud Foundation Kit 云数据库/云函数。系统端云同步、开发者托管云数据库、近场设备协同需分别评估，不互相等同。同步方案尚未定案，未改动应用实现。
- 后续与预防：优先核实应用接入华为用户云空间的开通条件、四类设备支持、账号隔离及冲突语义，再做两设备同步验证；不得以 SDK 有接口或云备份可用作为同步验收依据。界面按可用窗口大小设计单栏/多栏，并验证折叠、旋转和桌面缩窗。
- 验证边界：已检查工程与 SDK 声明、官方资料；未完成构建、设备连接确认、服务开通或真实跨设备同步。
- 相关 git commit ID：无（当前目录未初始化 Git，本次仅新增调查日志）。

参考：
- https://developer.huawei.com/consumer/cn/
- https://developer.huawei.com/consumer/cn/doc/harmonyos-releases/deveco-studio-new-features-2600
- https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/api/capi-relational-store-h
- https://developer.huawei.com/consumer/cn/sdk/cloud-foundation-kit/
- https://developer.huawei.com/consumer/cn/multidevice/adaptive-apps/
- https://github.com/Ranchero-Software/NetNewsWire

## 2026-10-17 — 原生云同步条件核实与实施计划

- 问题：仅凭 API 存在无法确定第三方应用开通门槛或四端支持；旧文档路径的正文抓取多次为空/超时。
- 原因分析：华为文档中心迁移且动态加载正文；ArkData、用户云空间、Cloud Foundation Kit 和近场同步容易混淆；API 声明的起始版本早于用户云空间服务开放版本。
- 处理：比较搜索索引、英文指南、官方页面浏览器读取、SDK 声明四种核验路径，使用浏览器取得新版官方指南正文；确认仅中国大陆、HarmonyOS ≥ 6.1.0、云空间 ≥ 6.3.0，官方支持手机/Tablet/PC。检查 HarmonyOS SDK 的 phone/tablet/2in1 均声明 CloudSync.Client/Config，不能只看 OpenHarmony 设备文件。
- 重要决定：用户选择华为原生云同步，首版覆盖手机/折叠屏/平板/鸿蒙电脑。新增 PORTING_PLAN.md，列出 AGC 开通步骤、同步 schema 约束、数据范围、分阶段交付和验收矩阵；先做 P0 原生同步验证，不先铺完整 UI。
- 用户设备：Mate 60 Pro（用户报告最新鸿蒙 7）与 MatePad Pro 13.2 2024（鸿蒙 6，具体子版本未知）。平板须核对是否 ≥ 6.1.0，且当前工程最低 SDK 26 不能直接覆盖 API 23；计划建议 target 26、compatible 6.1.0(23)，本轮未改配置。
- 预防：SDK 接口/服务开通/真实同步成功分别记录；生产 schema 仅增不改，验证后再发布；用户状态与高频文章缓存分开；账号切换和删除冲突必须实测；未取得真机证据的形态不得写“验收通过”。
- 验证：官方云侧指南（2026-09-14）、同步概述（2026-06-08）、端侧指南（2026-10-13）及本机 SDK 26.0.0.105；未登录 AGC、未部署、未运行构建或同步测试。折叠屏/PC 真机待补。
- 相关 git commit ID：无（目录尚未初始化 Git；本轮只新增计划并更新本日志）。

## 2026-10-17 — 收敛为手机/平板个人阅读器

- 问题：原计划包含四端适配与上架准备，超出用户当前需要；按一比一移植理解目标会限制鸿蒙原生设计。
- 原因分析：用户进一步明确优先个人日用，只适配手机和平板；希望借鉴 NetNewsWire 的开发逻辑与设计，长期做到鸿蒙生态中的优秀 RSS 阅读器。
- 处理：更新 PORTING_PLAN.md，首版保留华为原生同步，延期折叠屏/电脑，移除生产部署与上架验收；增加阅读优先、本地响应、原生交互、平板布局和可靠状态的体验标准。P5 改为个人设备安装、升级保数据与日用反馈，记录调试签名有效期。
- 预防：产品品质目标以真实阅读流程和数据可靠性验收；不把功能对齐、源码相似或系统能力数量当作目标。个人使用仍保留签名、AGC、版本与数据恢复要求。旧进度条目作为历史保留，以本条与当前计划为准。
- 验证：检查阶段、设备声明计划、测试矩阵和前置条件均收敛到手机/平板；应用实现与构建配置未修改，未运行构建或真机测试。
- 相关 git commit ID：无（目录尚未初始化 Git；本轮仅修订计划和日志）。

## 2026-10-17 — P0 云同步验证程序与操作指南

- 问题：此前只有计划和 Hello World，无法在手机/平板验证原生同步；用户不熟悉 AGC 设置，需要可直接照做的配置和设备步骤。
- 原因分析：真实云同步同时依赖应用身份/签名、开发环境 schema、设备版本/云空间开关及 ArkData 端侧接入，单独调用 API 不能证明跨设备成功。
- 处理：新增 ProbeStore、P0 ArkUI 验证页与 SyncStatus；独立 `reader_probe.db/SyncProbe` 提供 UUID 记录增改删、自动/手动云同步、云变更重读、原始进度及统计。选中记录更新不存在时拒绝重新创建，避免误复活删除数据；列表键包含内容版本，避免同 UUID 更新后仍显示旧内容。同步错误不丢本地记录。
- 配置：启用 cloudStructuredDataSyncEnabled，最低兼容改为 6.1.0(API 23)，声明 phone/tablet 与网络权限；关闭 scaffold 的整包备份，避免验证数据库通过备份恢复混淆同步证据。无账号凭据、无额外 SDK 依赖、无生产云部署。
- 用户操作：新增 P0_CLOUD_SYNC.md，明确 AGC 容器/四字段/去重主键、关联注册应用的自动签名、两台设备安装与异网/断网/冲突验证；同步更新 PORTING_PLAN.md 的实现状态。账号隔离未实现/实测，禁止将探针当作个人真实数据阅读器使用。
- 验证：DevEco SDK 26.0.0.105 的 assembleHap 成功，检查未签名 HAP 内最低版本、手机/平板类型、云同步标志均正确；Node 主机测试 4/4 通过，覆盖非终态 code=0、终态仍需对端核对、错误码和部分失败。ArkData 真机 CRUD/同步、布局、签名及 AGC 均未验收，P0 仍待完成。
- 预防：只在 FINISH + SUCCESS 且逐表无失败/剩余项时显示本轮完成，不能把 Promise 返回或本地写入显示成跨设备成功。使用关联 AGC 的同一应用身份及 debug 环境，不能用未关联签名或系统备份代替端云同步。
- 相关 git commit ID：无（目录未初始化 Git；当前文件尚未提交）。

## 2026-10-17 — 本机构建环境与 ArkTS 兼容修正

- 问题：基线打包因找不到 Java Runtime 失败；新增代码首次编译因 catch 的任意类型重抛不符合 ArkTS 规则失败。一次组合补丁因同时删除/添加同路径被校验拒绝，没有产生部分修改。
- 原因分析：终端未设置 DevEco 自带 JBR；ArkTS 要求抛出 Error 类型；补丁工具不接受单补丁内同一路径的两种操作。
- 处理：构建命令显式指定 DevEco JBR 的 JAVA_HOME；重抛使用 `error as Error` 保留原始 BusinessError 信息；修改现有页面使用一次文件替换。重建通过。
- 预防：将可复现的 JBR/Node/SDK 命令写入 P0_CLOUD_SYNC.md；不安装额外 Java，不更改全局 shell 配置。SDK 关于 DISTRIBUTED_DATASYNC 的警告已核对仅适用于 DISTRIBUTED_DEVICE，本工程使用 CLOUD，不增加无关近场权限；调用异常统一在页面边界显示。未隐藏或宣称零警告。
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-17 — 对齐用户已注册的“讯枝”应用

- 问题：用户 AGC 截图显示已在 rss-reader 项目创建“讯枝”，包名为 com.apexracing.rssreader，与工程占位包名不同。
- 原因分析：此前包名只是 P0 临时默认值；继续使用会导致签名关联到错误应用或查不到已注册应用。
- 处理：更新 AppScope bundleName、应用名称、桌面名称“讯枝 P0”、验证页包名和两份计划/操作指南；沿用 reader_probe/SyncProbe schema。截图中的凭据没有复制进工程或日志。
- 预防：签名前按 AGC 注册身份核对包名，不能以相同显示名称代替身份匹配；截图只证明应用创建，不能据此判定云空间已开通或 schema 已建立。
- 验证：重新 assembleHap 成功；读取 HAP 内 module.json，确认 com.apexracing.rssreader、云同步标志与 phone/tablet。当前依然未签名，未运行真机同步；此轮为名称/配置变更，不重复业务单元测试。
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-17 — Chrome 完成讯枝云空间开发环境配置

- 问题：用户要求代为在 Chrome 配置云同步；官方指南旧 AGC 菜单与当前账号的新版开发者中心不一致，开放能力管理搜索“云空间”无结果。
- 原因分析：新版控制台将服务入口放在“应用管理 → 讯枝 → 开放能力配置 → 云空间服务”；按旧入口寻找会误判无接入资格。
- 处理：在用户已登录的 Chrome 中确认 com.apexracing.rssreader，创建 reader_probe 容器与 SyncProbe 数据类型；保存 id/value/writer:String、updatedAt:Double，端侧去重主键仅 id。保存后重新打开详情，回读字段类型及主键；保存截图 p0-agc-schema.png 并更新操作指南。未部署生产、未重置环境、未写入测试数据、未处理任何账号密钥。
- 验证：页面显示开发环境、SyncProbe 四字段和主键 id，以及“容器有变更待实施到生产环境”；与 ProbeStore.ets 逐项核对一致。云端配置已完成，不等于端云调用或两台设备同步通过；签名、安装及真机结果仍待完成。本轮没有应用代码变更，不重跑编译或单元测试。
- 预防：按当前 UI 查找服务入口，以保存后回读为准；不因开放能力搜索无结果误开其他云服务。云侧自带系统字段 ID 与本地自定义主键 id 区分大小写，不添加 ID 到本地业务表。
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-17 — Chrome 全屏窗口自动化恢复

- 问题：截图连续两次报 ScreenCaptureKit -3811，坐标点击又遇到 noWindowsAvailable/timeout；后续一次点击报告 -3812，但实际页面已打开详情。
- 原因分析：原生窗口控制与全屏/窗口状态关联异常；未证实系统底层原因，不能将工具错误视为云端操作失败。
- 处理：依用户规则检索 Apple ScreenCaptureKit 文档及同类公开问题，比较前置窗口、退出全屏、重新绑定控制、重启会话等恢复路径；先 Raise 恢复截图，再重新绑定并退出 Chrome 全屏恢复点击，避免重启浏览器、改权限或丢失页面。-3812 后先回读 AX 状态，确认动作已生效，不重复提交。
- 预防：遇到工具回报不确定结果先读真实页面；对保存保持单次提交并等明确结果。菜单可用时优先语义操作，组合文本无独立按钮时使用新截图定位。
- 参考：https://developer.apple.com/documentation/screencapturekit/scstreamerror/code/failedtostart ；https://github.com/openai/codex/issues/38348
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-17 — 手机连接、关联签名与安装

- 问题：DevEco 已连接手机而受限终端 HDC 报 Connect server failed；IDE 同步完成前仍显示旧包名。直接用严格 JSON 解析 JSON5 配置遇到尾逗号错误。
- 原因分析：HDC 本机 socket 访问受沙箱限制；IDE 项目模型尚未刷新；JSON5 不是严格 JSON。
- 处理：查阅官方 HDC 文档，比较显式 socket、端口冲突检查、版本检查、重启服务，选择保留现有服务并授权访问 127.0.0.1:8710；等待项目同步完成，核对正确包名后操作签名。用户自行完成登录并明确确认关联讯枝及生成/更新调试 Profile；DevEco 已勾选关联注册应用并保存。配置检查只提取文件路径字段，未输出密码或私钥。
- 验证：Profile 为 debug，bundle 为 com.apexracing.rssreader，appIdentifier 为 6918745207619240963（不同于 AGC APP ID，不能混为一谈），包含 2 个设备条目；assembleHap/SignHap 成功，HDC 安装 entry-default-signed.hap 返回 install bundle successfully。Mate 60 Pro API 26；设备 fullname 为 OpenHarmony-7.0.0.105。云同步尚未验收。
- 预防：签名前等待 IDE 模型同步并核对应用身份；HDC 失败先检查现有 socket，避免反复重启服务或让用户重插；敏感签名配置只输出白名单元数据。安装成功不等于云同步成功。
- 参考：https://gitee.com/openharmony/docs/blob/cfe2f20652890eb686ba2a5555287f465d8758bf/zh-cn/application-dev/dfx/hdc.md
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-17 — 真机 code=3 定位到签名与云 schema 身份不匹配（处理中）

- 问题：手机本地初始化/新增通过，但手动同步三次均为 stage=2、code=3、details={}；AGC 查询无数据。用户打开讯枝 P0 同步开关后仍失败，重启应用未解决。
- 原因分析：设备云空间 7.0.0.303 满足版本要求，UI 确认开关已开启。设备日志明确显示 `get schema appId not equal: reader_probe`、`server schema is empty`，distributeddata 随后 `load schema fail`。此前只验证包名/签名文件存在即把关联签名写为完成，证据不充分；当前 Profile appIdentifier 6918745207619240963 与目标 AGC APP ID 6917619307183759711 尚未对齐。
- 处理：按重复错误规则检索官方签名/云空间指南及开发者复现，比较开关刷新、版本核验、关联签名、云结构配置和网络条件五个排查方向；先做无损应用重启，失败后读取限定应用日志，定位身份。重新启用关联签名后截图确认两复选框已选，但 DevEco 仍复用旧 Profile（IDE 日志：signature already exists）；继续核对 AGC 注册 ID/Profile。未删除本地记录、未重置云容器。
- 预防：点击关联选项后同时核对复选框、实际 Profile 身份及端侧 schema 加载结果；签名编译与安装成功不能证明关联云应用正确。HDC shell 正则含管道时要保留设备端引号，避免被设备 shell 当作命令管道。
- 本地证据：测试 UUID 4c3f26cb-e1c0-407c-8c8f-53d553d787a7，writer=phone，重启仍存在；输入经镜像键盘变为 p-0phe-no2210-6701100，以实际值核对，不以预期输入冒充结果。全屏 UI 定位异常经退出全屏并重新绑定恢复，列表滚动由用户完成。
- 相关 git commit ID：无（目录未初始化 Git）；本条覆盖上一条中“关联签名完成”的过早判断，云同步未通过。

## 2026-10-17 — 修正应用签名身份并打通手机上传

- 问题：DevEco 关联选项复用旧 Profile，导致手机与 reader_probe 云 schema 的应用 ID 不同。
- 原因分析：原自动签名 appIdentifier 为 6918745207619240963；注册讯枝为 6917619307183759711。以设备 `get schema appId not equal` 日志定位，不以 UI 勾选推断关联成功。
- 处理：在用户已明确授权的范围内，通过 AGC Profile 管理创建 Xunzhi-P0-Mate60-Debug，选注册讯枝、现有 auto_debug 证书和当前 Mate 60 Pro 单台设备，不申请额外 ACL。下载后核对 appIdentifier、debug 类型、设备数及证书 SHA256 与本地证书链叶证书一致。保存到忽略的 .local-signing/，仅替换 build-profile 的 profile 路径；原私钥和证书不变。
- 验证：SignHap 成功，HDC 覆盖安装成功，无需卸载且本地测试记录仍在；设备 bm dump appIdentifier 为 6917619307183759711。18:13:54 请求、18:13:57 完成，stage=2/code=0，SyncProbe 上传 total/success/successful=1、failed/remained=0；下载为0。已保存 p0-agc-debug-profile.png 与 p0-phone-upload-success.png。AGC 回读与云到端方向继续验证；不能据此宣布跨设备 P0 完成。
- 预防：每次关联/重签同时比对 AGC APP ID、Profile appIdentifier、安装后 bundle appIdentifier 和证书；自动签名缓存不刷新时使用明确应用身份的手动 Profile，避免删除缓存/卸载应用。UI 捕获错误时先重新绑定并检查实际状态；DevEco 全屏导致点击无窗口，退出全屏恢复，未重复提交云侧创建。
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-17 — 手机与华为云空间双向验证通过

- 问题：端侧同步完成统计仍需独立云端证据，单向上传不能证明下载和持久化。
- 原因分析：调用返回及本地 UI 均可能被误当成云端成功；必须以云端回读、相同 UUID 的反向修改和重启后的记录验证。
- 处理：AGC 开发环境查询 SyncProbe，回读手机 UUID 4c3f26cb-e1c0-407c-8c8f-53d553d787a7 和原始值；在云端将同记录改为 cloud-edit-001、writer=AGC、updatedAt=1792232106050，保存并回读，再从手机手动请求同步。未修改 schema、生产环境或真实用户数据。
- 验证：18:15:36 手机 stage=2/code=0，download total/success/successful=1、failed/remained=0；本地同 UUID 显示 cloud-edit-001 / AGC。aa force-stop 后重新启动，18:16:14 本地仍显示同记录。保存云端/手机证据，更新 P0_CLOUD_SYNC.md、PORTING_PLAN.md。没有业务代码变更，不重复状态单元测试。
- 预防：将“端云单手机通过”和“双真机 P0 完整通过”分别记录；本轮未验证平板、删除传播、离线重连、冲突、账号隔离或后台自动同步时延。保留虚构记录用于后续设备复核；签名有效至2027-10-17，仅包含本次手机。
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-17 — P2 阅读闭环首轮实现与编译修复

- 范围：用户明确选择“补齐必要数据层，直接推进 P2”。保留原 P0 页面和数据库，将阅读器设为启动页；新增 RSS/Atom/JSON Feed、网页订阅发现、OPML、文件夹、筛选搜索、ArkWeb 正文、分享与本机独立用户/缓存库。正式业务云 schema/账号隔离尚未完成，界面明确本机存储，不复用测试云表承载真实订阅。
- 问题：Select 参数中的内联对象数组/spread 触发 ArkTS 编译器 `Debug Failure. No error for last overload signature`，未指明源码行；测试模块首次导入相对路径多退一级导致连锁类型错误。
- 根因：ArkUI 选择器参数缺少显式 SelectOption 类型，编译器重载错误处理崩溃；ohosTest/ets/test 到 src 只需三级上溯。
- 处理：查阅编译日志与 SDK 声明，检索官方编译排障及相关错误；比较清缓存、改 SDK、简化复现、显式参数类型四个方案，选择最小复现定位 UI 后以 SelectOption[] 方法构造参数，不变更 SDK。订阅映射返回值显式标注 Subscription。主 HAP 已签名构建通过；测试包正在构建，尚未声称功能通过。
- 预防：ArkUI API 的复合对象使用声明类型；异常编译器崩溃先隔离源代码范围，不反复清环境。测试直接导入正式解析/存储实现，用原生 XML/RDB 真机测试，避免仅在 Node 模拟层通过。现有源文件快照位于 /tmp/xunzhi-p2-baseline/source-before-p2.tgz，不包含签名凭据；未初始化 Git。
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-17 — P2 原生解析与测试上下文修正

- 问题：Atom xml:base 丢失使相对文章链接解析到错误目录；OPML 往返断言把排列顺序误当关系丢失；测试 RDB 上下文报 Illegal context / must be a context of stageMode。
- 根因：原生 ConvertXML 属性使用 base 键；OPML 导出按文件夹分组，允许排序变化；测试 delegator 的应用上下文不能直接作为该设备上的 RDB 模块上下文。
- 处理：兼容 xml:base/base 并通过真实解析断言；OPML 按 URL 对齐后比较完整关系。按重复错误规则检索官方单元测试与 Context 指南，比较直接应用上下文、模块上下文、监听启动 Ability、注入测试 Ability 四种方式，选择官方示例的实际 Ability 上下文。AbilityMonitor 类型使用 SDK 实际导出的 abilityDelegatorRegistry 命名空间。构建失败时曾误装旧测试产物，后续仅在确认 BUILD SUCCESSFUL 后安装；不把该次旧产物运行计为修复验证。
- 附带边界修正：拒绝缺 channel 的 RSS；Atom 默认文本正文转义；OPML 数量限制逐条检查；阅读页显示错误，阻止刷新与状态操作交错。
- 预防：平台 XML、RDB 必须在真机测试，不能仅依赖 JS 类型转换；导入导出比较语义关系；构建与安装必须按成功结果串行进行。
- 相关 git commit ID：无（目录未初始化 Git）。

## 2026-10-18 — GitHub 首次源码导入

- 问题：本地未初始化 Git，根 build-profile 含本机签名配置，AGC/手机截图可能暴露账号或设备信息；直接上传整个目录不适合公开仓库。
- 根因：工程原先只在本机调试，未区分共享配置与个人签名/验证材料。
- 处理：确认用户指定的 zhydzhy/XunZhi-RSS-Reader 为公开空仓库且当前账号有 ADMIN 权限；初始化 main 和 HTTPS origin，使用 GitHub noreply 邮箱。忽略本地 build-profile、签名/服务配置、截图、缓存和产物；提供去除 signingConfigs 与产品签名引用的 build-profile.example.json5。添加 README，明确业务云同步及完整 UI 验收仍未完成，保留本机配置与数据。
- 验证：51 个暂存文件的凭据模式扫描和实际本机签名值匹配均无命中；忽略规则覆盖配置、Profile、截图及 HAP；本轮 P0 状态测试 4/4 通过。此前 P2 11 项真机测试通过，包括真实 Atom/JSON Feed 的 304；未在本次上传任务重复真机测试。
- 预防：新机器从模板复制配置并自行签名；提交前检查暂存文件，签名截图仅本机留存；推送后核对远端 main 与本地 HEAD。
- 相关 git commit ID：88da740c746751c66359c94a58824867538e04c6（首次源码导入）。

## 2026-10-18 — P2 真机验收准备与 OPML 分段读取修复

- 问题：设备起初未连接；连接后 HDC 可测试但 DevEco 镜像停在 Connecting。代码检查发现 OPML 分段读取将已读总数再次作为相对 offset，短读后可能跳过内容。
- 根因：SDK ReadOptions.offset 是当前文件指针加偏移，旧循环按绝对文件偏移使用；既有小样例通常一次读取完成，未覆盖多段读取。
- 处理：提取文件描述符读取入口供真实文件测试直接调用，按 64 KiB 顺序读取且不额外偏移，保留大小限制、完整读取检查、UTF-8 解码与调用方关闭文件。新增大于多块的中文 OPML 文件回归。测试中重复启动/监听同一 Ability 导致超时，改为在同次运行复用上下文。
- 验证：主/测试包签名构建成功，覆盖安装；ReaderP2 与 ReaderFiles 9/9 真机通过。界面验收仍在进行，结果见 P2_ACCEPTANCE.md，不把原生用例通过等同于界面通过。
- 预防：文件操作核对平台偏移语义；回归必须跨越多个读取块且含多字节字符；同次测试复用有效 Ability 上下文。设备截图仍不上传公开仓库。
- 相关 git commit ID：待本轮验收结束提交；基线 897474fd40c023f94303fc65a89d202bdc1fcacd。

### 同轮镜像连接排障（已恢复）

- 用户确认手机已连接且无投屏提示，并明确选择继续排查 DevEco 镜像；不改用 HDC/UiTest 截图或操作界面。
- 对照官方设备/测试说明和本机成功日志，比较手机授权/解锁、IDE 重启、HDC 服务重连、投屏组件缓存重建四条路径。HDC 安装与测试正常、无手机提示、IDE 重启无效，暂不重启正常的 HDC 服务。
- 日志差异：上次缺少临时 libscreen_casting.z.so 时回退部署兼容库并成功启动；本次已有相同库时初始化未推进到投屏服务启动。只将该 IDE 临时库改名备份，随后重启 IDE 让其自行部署，镜像已恢复并完成多项交互验证；不改签名、应用数据库或设备安全设置。

## 2026-10-18 — 正文空白修复与镜像恢复

- 问题：真实少数派 RSS 添加成功，但阅读页长期空白，原版调整字号仍空白；DevEco 镜像曾停在初始化。
- 根因：WebviewController.loadData 在 baseUrl/historyUrl 为空且非 base64 时要求 URL 编码，原始 HTML 中 CSS 的 # 截断数据。镜像日志显示缓存投屏库存在时未推进启动；备份临时库后 IDE 重新部署兼容组件恢复，属于本机工具问题。
- 处理：正文首次加载及两处字号重载统一 encodeURIComponent；比较 URL 编码、base64、显式 baseUrl、导航回调及首次 src 加载路径，最终隔离验证只需编码修复，撤回导航/生命周期试验改动。仅将设备 /data/local/tmp 的投屏库改名备份，重启 IDE；未更改签名或数据库。
- 验证：签名构建和覆盖安装成功；通过 DevEco 镜像实际添加少数派 10 篇，最小修复版首次打开中文标题/作者/正文正常。继续验收状态、文件及分享，结果见 P2_ACCEPTANCE.md。
- 预防：HTML 字符串正确不等于 WebView 能正确加载；平台 URL 编码语义及包含 #、%、中文的真实内容必须做界面回归。等待异步渲染后判断空白，避免将首次截帧误判为加载失败。镜像输入英文网址使用手机英文软键盘，电脑键盘转发会乱序；不绕过用户选择使用其他 UI 自动化。
- 相关 git commit ID：待本轮验收提交；基线 897474fd40c023f94303fc65a89d202bdc1fcacd。

## 2026-10-18 — 网页订阅发现的 HTTP 重定向修复

- 问题：界面添加 jsonfeed.org 时出现重定向次数超限。新增 ReaderRedirect 真机回归后，原版稳定复现 1 error/0 pass。
- 根因：maxRedirects=0 在真实平台直接以 2300047 拒绝 301，未返回可供手动处理的响应；原来的 3xx 分支因此无法执行。比较自动跟随、headersReceive 捕获、官方 REDIRECTION 拦截器三条路径，选择返回重定向响应并复用现有逐跳校验。
- 处理：为每个请求绑定 REDIRECTION 拦截器，返回 false 后由原循环验证 Location、协议及最多 5 次跳转；删除 maxRedirects=0。保持原始订阅 ID 与最终解析基址分离，不新增网络库。
- 验证：主/测试构建成功。首次修复后网站跳转及发现断言通过，后续测试误以为非 www 的 /feed.json 也会跳转，实际公网返回 404；改为抓取网站真正声明的 feed 地址。另一个 Atom 公网请求超时，单独复验，不把网络失败计为通过。
- 预防：网络集成必须覆盖实际 3xx；不能以模拟 URL 参数测试替代平台 HTTP 跳转。公网路径以站点声明为准，保留失败日志及复验结果。
- 相关 git commit ID：待本轮验收提交；基线 897474fd40c023f94303fc65a89d202bdc1fcacd。

## 2026-10-18 — 摘要排版实体及本轮验收记录

- 问题：JSON Feed 官方文章列表直接显示 `We&rsquo;ve`；正文正常，摘要不正常。
- 根因：摘要去标签函数只转换基础 HTML 实体，未覆盖弯引号等排版字符。
- 处理：补充八种常见排版实体映射，保持单次解码；新增真实短句与双重转义回归。主机断言先失败后通过，最终真机摘要已显示 `We’ve`。
- 验证：最终主/测试签名包构建、覆盖安装成功；ReaderP2、ReaderFiles、ReaderRedirect 共 11/11 通过。之前独立公网复验 3/4 通过，阮一峰 Atom 连续两次连接超时；电脑侧只得到 403，不能据此证明手机超时根因。
- 排障与预防：参考官方 HTTP 请求/API 文档，比较网络路径诊断、延长超时、换真实 Atom 源、固定 Atom 样例四种办法；保留正常超时上限和失败证据，使用已有样例确认解析逻辑，不把换源或历史结果当作该公网请求成功。官方入口：https://developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-http 。
- 界面：通过 DevEco 镜像验证 RSS/JSON 添加、网页发现、正文及字号、长文翻页、系统返回、已读/星标/筛选/搜索、文件夹、OPML 导出导入及取消、原文与分享面板。覆盖安装与应用重启后星标、已读和文件夹仍保留。详细证据和未完成项见 P2_ACCEPTANCE.md。
- 预防：解析测试之外保留真实摘要界面回归；公网失败与本地回归分开报告；镜像鼠标拖动会选择文字，长文滚动用镜像键盘 Page Down 后确认末段可见。
- 相关 git commit ID：待本轮验收提交；基线 897474fd40c023f94303fc65a89d202bdc1fcacd。

## 2026-10-18 — 修改网址时清理旧发现结果

- 问题：发现 jsonfeed.org 后把输入改成非法地址 `/`，旧候选按钮仍显示，容易误认为属于新地址。
- 根因：输入 onChange 只更新地址，未清空依赖旧地址的候选结果。
- 处理：编辑地址时立即清空 candidates；错误地址已能提示输入合法 HTTP/HTTPS 地址，既有订阅保留。
- 预防：发现结果与搜索/网址输入变更一起失效；界面回归覆盖“发现成功→修改地址”，不只测首次成功。
- 验证：最终签名构建与覆盖安装成功，真机重新发现候选后编辑地址，三个旧候选立即消失，两条既有订阅及 Test 关系保留。
- 相关 git commit ID：待本轮验收提交；基线 897474fd40c023f94303fc65a89d202bdc1fcacd。
