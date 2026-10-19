# 讯枝 · XunZhi RSS Reader

面向原生 HarmonyOS 的 RSS 阅读器，使用 ArkTS、ArkUI 和 ArkData RDB。借鉴 NetNewsWire 的阅读优先、本地响应、开放订阅迁移等设计理念，探索适合鸿蒙手机和平板的原生体验。

当前为个人使用的开发版本，尚未达到完整首版验收标准。

## 当前进度

- **P0 端云探针**：Mate 60 Pro 与华为云空间的测试记录双向同步、重启持久化已验证；双设备验收待完成。
- **P2 阅读闭环已实现**：RSS / Atom / JSON Feed、网页订阅发现、文件夹、OPML 导入导出、未读/全部/今天/星标筛选、本地搜索、正文阅读、字号调节、原文与系统分享入口。
- **必要本地数据层**：订阅/文件夹/已读/星标与文章缓存分库；刷新不覆盖阅读状态，抓取失败保留已有内容。
- **未完成**：真实订阅的云同步、账号隔离及冲突处理、平板布局验收，以及本轮真实 Atom 公网复验。P0 探针成功不代表业务数据已经同步。

当前手机已安装 P2 修复构建。2026-10-18 已通过正文/字号、状态筛选/搜索、离线冷启动阅读/状态持久化/刷新失败保留、文件夹、OPML、原文/分享与 RSS/JSON Feed 网页发现的真机交互检查；修复了正文空白、OPML 分段读取、HTTP 重定向及摘要标点问题。最终本地/重定向原生测试 **11/11 通过**；独立公网复验 **3/4 通过**，阮一峰 Atom 连续超时，不能视为全量通过。P0 状态测试 **4/4 通过**。详细范围与未完成项见 [P2_ACCEPTANCE.md](P2_ACCEPTANCE.md)。

## 开发环境与启动

当前工程使用 DevEco Studio 的 HarmonyOS SDK **26.0.0.105**，模型版本 26.0.0。手机在 HarmonyOS 7 上验证；声明支持 phone/tablet 不等于已经完成平板适配。

1. 克隆项目，并在根目录执行：

   ```sh
   cp build-profile.example.json5 build-profile.json5
   ```

2. 用 DevEco Studio 打开工程，安装对应 SDK 并同步 OHPM 依赖。
3. 在项目签名设置中配置自己的设备和调试签名。模板不含签名凭据；本地 `build-profile.json5` 被 Git 忽略。
4. 运行 `entry` 模块。阅读器默认没有订阅，可通过“订阅”添加地址或导入 OPML。

原仓库的应用包名为 `com.apexracing.rssreader`。其他开发者应使用自己注册的应用身份和签名；云探针还需要匹配的 AGC schema、服务权限和设备云空间开关。仅克隆源码不会获得原应用的云服务访问权。配置说明见 [P0_CLOUD_SYNC.md](P0_CLOUD_SYNC.md)。

## 构建与测试

以下命令假定 DevEco 的 `hvigorw`、`hdc` 已加入 PATH，SDK/Node/Java 环境已配置：

```sh
hvigorw --mode module -p product=default -p module=entry@default assembleHap --no-daemon
hvigorw --mode module -p product=default -p module=entry@ohosTest assembleHap --no-daemon
```

完成本机签名后，安装主包和测试包并运行：

```sh
hdc install entry/build/default/outputs/default/entry-default-signed.hap
hdc install entry/build/default/outputs/ohosTest/entry-ohosTest-signed.hap
hdc shell aa test -b com.apexracing.rssreader -m entry_test -s unittest OpenHarmonyTestRunner -s class ReaderP2,ReaderFiles,ReaderRedirect,ReaderNetwork -s timeout 60000
node --test tests/sync-status.test.mjs
```

Node 测试使用支持直接加载 TypeScript 的 Node 版本，本机验证版本为 24.14.1。原生 RDB 测试使用独立的 `p2_validation_user.db` / `p2_validation_cache.db`，不清理真实阅读资料库或 P0 云表。

## 目录

- `entry/src/main/ets/pages/Index.ets`：阅读器界面。
- `entry/src/main/ets/reader/`：解析、抓取、本地存储、OPML 文件操作。
- `entry/src/main/ets/pages/Probe.ets`、`probe/`：独立 P0 云同步探针。
- `entry/src/ohosTest/ets/test/`：真机解析、存储及公网请求测试。
- [PORTING_PLAN.md](PORTING_PLAN.md)：范围和阶段验收计划。
- [PROGRESS.md](PROGRESS.md)：问题、修复与验证记录。

签名文件、服务密钥、个人路径配置、AGC/手机截图、依赖缓存及构建产物均不上传。项目是独立的鸿蒙实现，与 NetNewsWire 官方无隶属关系。
