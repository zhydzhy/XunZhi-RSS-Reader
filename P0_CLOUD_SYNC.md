# P0：手机与平板原生云同步验证

状态（2026-10-17）：验证程序、签名打包与 Mate 60 Pro 安装已完成；手机上传与云端修改回传均成功（各 1 条、stage=2/code=0、失败/剩余 0），AGC 与手机 UUID/内容一致，回传记录在结束进程重启后仍存在。同步状态的 4 项主机测试通过。当前只有手机，跨设备 P0 尚未完成。

## 1. 先准备设备

- 两台设备的系统均需 **HarmonyOS ≥ 6.1.0**，云空间版本均需 **≥ 6.3.0**。平板若仍是 6.0.x，需先确认可升级到符合条件的版本。
- 系统完整版本在“设置 → 关于手机／关于平板”查看；云空间版本在云空间的“关于”或应用信息页查看。应用验证页也显示系统版本与 API。
- 服务当前仅支持中国大陆。设备登录同一华为账号，云空间有足够空间。若希望在 AGC 查询调测数据，两台设备使用与开发者后台相同的账号。
- 开启设备开发者模式及 USB 调试，USB 连接电脑，在设备上确认信任。签名时建议同时连接手机和平板，让 Profile 包含两台设备。

官方依据：[云空间接入指南](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/data-sync-with-cloud)。

## 2. AGC 创建项目和应用

1. 打开 [AppGallery Connect](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html)，使用已实名认证的开发者账号登录。
2. 进入“开发与服务 → 我的项目”，新建项目，例如 `Harmony RSS`。
3. 在项目中添加 **HarmonyOS 应用**，显示名称为 `讯枝`，包名使用 **`com.apexracing.rssreader`**，与工程完全一致。若平台提示包名冲突，先记录可用包名，再同时修改工程及本文；不能两端各填不同名字。
4. 本账号当前为新版 HarmonyOS 开发者中心：进入“应用管理”，选中“讯枝”，从左侧 **开放能力配置 → 云空间服务** 进入。实测此入口可直接创建容器；开放能力管理中搜索“云空间”没有结果，不应因此改用云数据库。
5. 旧版 AGC 的入口仍为“API 管理／开放能力管理 → 云空间”和“全部功能 → 构建 → 云空间服务”；以实际控制台版本为准。

这里使用“云空间服务”，不是 Cloud Foundation Kit 的“云数据库”。本轮只配置开发环境，不需要上架，也不执行“实施变更到生产环境”或“重置开发环境”。如果没有云空间入口，先核对已进入目标应用，并按新版“开放能力配置”或旧版“全部功能”寻找；仍没有时保留页面截图和账号实名状态，不能用另一个名称相似的服务替代。

## 3. 创建与代码匹配的测试 schema

以下配置已于 2026-10-17 在 Chrome 中保存，重新打开详情核对通过，无需重复创建。配置截图仅保存在开发者本机，未上传公开仓库。

在云空间服务的**开发环境**中：

- 创建容器：**`reader_probe`**（不加 `.db`）。
- 数据类型配置 → 新建 Record Type：**`SyncProbe`**。
- 添加以下四个自定义字段；名称区分大小写。

| 字段 | AGC 类型 | 本地类型 | 用途 |
|---|---|---|---|
| `id` | String | TEXT PRIMARY KEY | 每条测试记录的 UUID |
| `value` | String | TEXT | 虚构测试内容 |
| `writer` | String | TEXT | 手填设备标签，不收集设备唯一标识 |
| `updatedAt` | Double | DOUBLE | 本地写入时间，毫秒 |

展开“高级设置 → 端侧去重主键”，勾选 **`id`**，保存开发环境配置。其他字段不设主键；不添加 NOT NULL 约束。P0 使用普通 String，方便查看虚构数据；正式阅读器的数据保护和 schema 另行设计。

本地建表语句与此一致：

```sql
CREATE TABLE IF NOT EXISTS SyncProbe
(id TEXT PRIMARY KEY, value TEXT, writer TEXT, updatedAt DOUBLE);
```

数据库为 `reader_probe.db`，与未来阅读器业务库分开。不要在 P0 输入订阅隐私、账号口令或个人正文。该应用启用了原生自动同步：系统开关启用后，写入测试记录可能自动上传，无需先点击手动同步。

## 4. DevEco Studio 关联应用、签名与安装

1. 用 DevEco Studio 打开此工程，连接并解锁两台设备；确认设备选择栏能看到两台设备。
2. 打开 **File → Project Structure → Project → Signing Configs**。
3. 点击 **Sign In** 登录同一开发者账号，选择对应团队；启用 **Associate with registered application（关联注册应用）** 的自动签名流程。DevEco 按 bundle name 查找 AGC 应用，因此应匹配刚创建的 `com.apexracing.rssreader`。
4. 完成签名后，核对 Profile 的包名、有效期、设备范围及关联应用。若启用云空间前已经生成过 Profile，开通后刷新该应用的签名配置。
5. 保持 **debug** 构建，分别选手机和平板运行 `entry`。两台设备都必须使用同一 AGC 应用、同一开发环境；云空间依据证书 debug/release 类型区分环境，不能混用。
6. 两台设备安装后在“设置 → 云空间”找到应用同步开关并打开。应用桌面名称为“讯枝 P0”，云空间中可能显示工程应用名 `讯枝`；以包名/对应应用确认。
7. 打开应用，分别将设备标签改成 `Mate60` 和 `MatePad`。出现“数据库就绪”仅表示本地初始化通过，不表示 AGC 或云端已成功。

关键点：使用**关联注册应用**的签名，不只勾选未关联应用的自动签名。两设备共用已注册应用身份。依据：[华为自动签名指南](https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-signing-auto)。签名文件由 DevEco 在本机管理，不需要把私钥、密码或证书发到聊天中。

当前已安装 `entry/build/default/outputs/default/entry-default-signed.hap`。本机使用 AGC 手动生成的 `Xunzhi-P0-Mate60-Debug`，Profile 位于忽略目录 `.local-signing/`，仅授权当前 Mate 60 Pro，有效至 2027-10-17。加入平板时须先扩展设备范围并重新下载 Profile。

本次 DevEco 自动签名复用了未关联身份的旧 Profile；仅勾选关联应用不足以确认完成。已改用明确选择注册讯枝的手动 Profile，复用原私钥/证书。AGC APP ID、Profile 与安装后 appIdentifier 均核对为 **6917619307183759711**。重新运行前保留当前 profile 路径，避免被旧自动签名配置覆盖。

## 5. 两台真机验证顺序

系统自动同步时间不固定。每个步骤先观察自动同步；未到达时可在写入端请求云同步，等待本轮完成后，在接收端请求云同步并“重读本地”。不要连续快速点击；用 2 分钟作为本次观察窗口并记录实际耗时，这不是服务时延承诺。超时记为待排查，不能判通过。

| 测试 | 操作 | 通过标准 |
|---|---|---|
| 手机 → 平板 | 手机填 `phone-001` 并新增 | 平板出现同一个 UUID，内容和 writer 完全一致 |
| 平板 → 手机 | 平板点击该记录，改为 `pad-edit-001`，更新选中 | 手机同一 UUID 的值更新，没有额外记录 |
| 删除传播 | 手机删除选中记录 | 平板该 UUID 消失，重启两端后也不恢复 |
| 离线恢复 | 手机断网，新增 `offline-001`，结束进程并重开；再恢复网络 | 断网及重启后本地仍在，联网后平板出现同 UUID |
| 确认经过云端 | 手机和平板使用不同网络，关闭蓝牙；重复新增和修改 | 数据仍互通；若手机蜂窝网络被系统策略阻止，使用另一个 WLAN，单独记录蜂窝限制 |
| 系统开关关闭 | 暂停一端的应用云同步开关，写入新的测试记录并请求同步 | 新记录不传播，应用不以本地写入或请求返回宣称成功；重新开启后收敛。遇到“删除数据”提示不要确认 |
| 并发冲突 | 两端断网，对同一已同步记录分别更新，再恢复网络 | 最终两端同 UUID 同值；记录操作时间、联网顺序和最终值，不预设客户端时间字段决定胜者 |
| 删除与更新冲突 | 两端已有同记录；离线一端删除、另一端更新后再联网 | 记录最终存在/删除结果，两端应一致；业务是否接受该规则留待正式数据模型决定 |
| 布局 | 手机竖屏、平板横竖屏及分屏运行上述操作 | 按钮自动换行、内容可滚动，记录和错误可读，选中状态合理 |

云同步返回的 Promise 仅代表调用受理。应用事件会显示原始 stage/code、逐表上传/下载统计；只有 `stage=2, code=0` 且无失败/剩余项才显示本轮完成，仍要核对接收端 UUID 和内容。

账号隔离仍是单独的验收项：当前 P0 未实现应用级账号切换隔离，不应带真实数据进入个人日用。后续用可控测试账号/设备验证退出及更换账号，确认旧数据不会传入新账号；不要为排查普通错误直接退出主力设备的华为账号。

## 6. 出错时带回这些信息

复制应用“最近事件”，加上发生步骤、两台设备的完整系统/云空间版本、AGC 容器和字段截图即可。只需诊断信息，不需要账号密码或证书。

| 现象 | 优先检查 |
|---|---|
| 无法安装 | 平板是否 ≥ 6.1.0；调试 Profile 是否包含该设备、是否过期；签名是否成功 |
| 找不到应用云空间开关 | 安装是否为当前包；AGC 云空间是否启用；关联应用签名；系统/云空间版本 |
| code=1 且 details={} | 容器名、表名、四个字段及类型、去重主键是否一致；不要先重置云环境 |
| code=2 | 网络连通性，恢复网络后重试 |
| code=3 | 系统同步开关、登录状态、服务资格与版本；若日志为 `get schema appId not equal`，核对 AGC APP ID、Profile 与已安装 appIdentifier，不能只检查包名 |
| code=4 | 云资源占用，稍后重试，不连续请求 |
| code=5/6 | 数据限制／剩余云空间 |
| code=7 | WLAN/蜂窝网络策略，切换允许的网络 |
| 一端完成、另一端没有记录 | 接收端也请求同步；核对同账号、同 AGC 应用身份、同 debug 环境、同 schema |
| AGC 看不到数据 | 调测页面只能看当前开发者账号自己的数据；设备使用其他账号时不以此判失败 |

## 7. 开发者复现与证据记录

不需要安装新的依赖；使用本机 DevEco 自带运行时：

```sh
JAVA_HOME=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home \
NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node \
DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk \
/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
  --mode module -p product=default -p module=entry@default assembleHap --no-daemon

/Applications/DevEco-Studio.app/Contents/tools/node/bin/node --test tests/sync-status.test.mjs
```

编译器会提示 `DISTRIBUTED_DATASYNC`；SDK 文档明确它只对 `DISTRIBUTED_DEVICE` 必需，本工程使用 `DISTRIBUTED_CLOUD`，不为消除提示而增加近场设备权限。ArkData 可抛异常的静态警告由页面操作边界统一捕获、显示原始错误码。Node 的无 package type 提示不影响测试，不修改用户家目录的 package.json。

| 证据项 | 当前结果 |
|---|---|
| ArkTS 编译 / HAP 打包 | 通过，SDK 26.0.0.105；SignHap 成功，已签名 |
| 包内配置 | cloudStructuredDataSyncEnabled=true；phone/tablet；最低 6.1.0(API 23) |
| 同步状态主机测试 | 4/4 通过；不冒充 ArkData 或设备集成测试 |
| AGC 应用 / 开发 schema | Chrome 已保存并回读“讯枝”开发环境 reader_probe/SyncProbe：id、value、writer 为 String，updatedAt 为 Double，端侧去重主键 id；未部署生产 |
| 调试签名 / 安装 | 通过；手动关联讯枝 Profile，覆盖安装保留本地测试记录；appIdentifier 已核对 |
| 手机版本 / 云空间版本 | Mate 60 Pro；设备上报 OpenHarmony-7.0.0.105 / API 26；云空间 7.0.0.303；用户已开启讯枝同步开关 |
| 手机 → 云端 | 通过；上传 1、失败/剩余 0，AGC 回读 UUID 4c3f26cb-e1c0-407c-8c8f-53d553d787a7 和原值 p-0phe-no2210-6701100、writer=phone |
| 云端 → 手机 | 通过；AGC 将同 UUID 改为 cloud-edit-001、writer=AGC、updatedAt=1792232106050；18:15:36 手机下载 1、失败/剩余 0；结束进程重启后仍一致 |
| 平板版本 / 云空间版本 | 当前未连接，待记录完整版本并加入 Profile |
| 双向增改删 / 断网恢复 / 异网 | 待真机验证 |
| 冲突语义 / 账号隔离 | 待受控验证；P0 尚未通过 |

完成设备步骤后在此表和 PROGRESS.md 记录实际结果、失败码及复现条件，再决定是否进入 P1。

### 2026-10-17 手机端云验证证据

- AGC 调试 Profile（本机留存：`p0-agc-debug-profile.png`）：注册讯枝，单台 Mate 60 Pro，现有证书，debug 环境。
- 手机上传统计（本机留存：`p0-phone-upload-success.png`） 与 AGC 回读（本机留存：`p0-agc-upload-record.png`）：同 UUID 4c3f26cb-e1c0-407c-8c8f-53d553d787a7。
- AGC 修改详情（本机留存：`p0-agc-cloud-edit.png`） 与 手机下载统计（本机留存：`p0-phone-download-success.png`）：cloud-edit-001 / AGC，下载成功1。
- 两方向均通过手动请求验证；没有据此声称自动后台时延、双设备同步、离线重连、删除传播、冲突或账号隔离通过。当前保留1条虚构记录供平板接入复核。
