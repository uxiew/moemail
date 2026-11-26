# 新邮件后台系统通知

## 开启与关闭

登录后进入「个人中心 → 新邮件系统通知」，点击「开启此设备通知」，允许浏览器/系统通知。关闭网页后仍可收到提醒，点击通知会打开邮箱；登录已失效时仍需重新登录才能读邮件。

- iPhone / iPad 需要 iOS 16.4 或更高版本，先添加到主屏幕，再从应用图标打开并授权。安装应用不等于允许通知。
- 每个账号最多 5 个设备订阅，不同浏览器或域名分别计数。可以关闭本设备或所有设备的通知；从界面退出登录时会取消当前浏览器订阅，并关闭已显示的新邮件通知，不影响其他设备。
- 权限被拒绝后，应用不会反复弹系统授权框；需要到浏览器/系统设置中允许，再点击「重新检查」。旧订阅或密钥轮换后，先清理旧订阅再重新开启。
- 已安装的旧版应用需要先完成后台更新；页面会确认后台具备通知能力后才允许开启，避免把仍在运行的旧缓存后台当作已就绪。
- 原生安装提示优先，手机备用安装入口延迟 30 秒。具体浏览器边界见 [PWA 说明](pwa.md)。

## 数据与投递边界

通知固定为「MoeMail：你有新邮件，点击打开邮箱」。收件 Worker 在邮件成功入库后，用 `waitUntil` 调度 Web Push，失败不影响收件；前端无需持续轮询来维持后台通知。

推送请求是**空载荷**，文案由 Service Worker 本地生成；不发送邮箱地址、发件人、主题、正文或邮件 ID，不需要保存浏览器的载荷加密密钥。订阅表只保存账号关联、设备推送端点、公钥版本及时间；推送端点是敏感数据，不记录到日志，不返回给其他账号。既有 Webhook 是独立功能，若启用仍按原规则执行。

系统推送服务会处理设备订阅和投递元数据，当前支持 Google/Apple/Mozilla/Microsoft 推送域名。服务端拒绝其他地址、不跟随跳转，订阅变更要求登录会话、同源 JSON 请求，API Key 不能管理通知。

- 每封有效邮件最多向 5 个设备各发送一次；429/5xx 且短暂可重试时最多重试一次，每次请求超时 5 秒，不做无限重试或持续轮询。
- 404/410 自动清理失效订阅；其他失败保留订阅，后续邮件仍可尝试。没有持久通知队列，服务故障可能漏掉提醒，但邮件仍在邮箱中。
- 通知 TTL 为 1 小时，可合并同类提醒，不保证逐封、立即送达；离线、省电、系统免打扰及强制停止浏览器都会影响投递。这里没有新增邮件离线缓存。

## 管理员配置与发布

保持项目现有 Node/pnpm/Pages 构建工具，不需要新依赖或新的付费服务。新增索引查询、数据库订阅写入和外部推送请求仍会消耗现有 Cloudflare 额度。

1. 记录当前 Pages/收件 Worker 版本、D1 Time Travel 恢复书签，并导出数据库结构。Time Travel 的数据备份自动启用，恢复窗口取决于套餐，不要把过期书签当作永久备份。确认待应用迁移只有本次新增的 `0019_web_push_subscriptions.sql`；它只创建订阅表和索引，不修改既有邮件数据。出现其他待应用迁移时先审查，不盲目全部执行。
2. 生成一次 VAPID 密钥（用于向推送服务证明应用身份）：

   ```sh
   mkdir -p .wrangler/private
   chmod 700 .wrangler/private
   pnpm exec tsx scripts/generate-push-keys.ts .wrangler/private/web-push-keys.json
   ```

   文件权限为 0600，已存在时拒绝覆盖。该目录被 Git 忽略；不要把密钥粘贴到日志、文档或提交中。

3. 通过 Cloudflare secrets 配置以下字段，Pages 和收件 Worker 的公钥必须一致：

   | 配置 | Pages | 收件 Worker |
   |---|---|---|
   | `WEB_PUSH_PUBLIC_KEY` | 必需 | 必需 |
   | `WEB_PUSH_PRIVATE_KEY` | 不配置 | 必需，PKCS#8 的 base64url 编码 |
   | `WEB_PUSH_SUBJECT` | 不配置 | 必需，使用网站公开 HTTPS URL，不使用个人邮箱 |

   缺少配置时功能关闭，不查询通知订阅表、不影响收件。轮换密钥会使旧订阅无法继续投递，用户需要重新开启；不要每次部署都重新生成密钥。

4. 先应用已确认的 D1 新迁移，再配置密钥、发布收件 Worker 和 Pages；保持现有 D1/KV、Auth secrets 和其他 Worker 配置。仅配置 Pages 公钥不会让收件 Worker 自动具备推送能力。使用 `wrangler secret ... --config <收件Worker配置>`，不要在 Pages 配置上执行 Workers 专用命令。
5. 回滚时分别恢复先前 Pages/收件 Worker 版本，保留新增表和密钥，不删除订阅数据、不把全库恢复当作常规回滚；否则可能覆盖上线后的邮件。旧版本忽略新表和新配置。

2026-11-26 已发布。具体生产版本、迁移及回滚点统一记录在[本次部署说明](deployment.md#2026-11-26-原生安装与后台推送)。

## 验证

```sh
WRANGLER_SEND_METRICS=false pnpm test:push
pnpm test:quota
pnpm test:build
pnpm test:pwa
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm build:pages
pnpm test:pwa:build
```

`test:push` 使用真实本地 D1 和假数据，覆盖 VAPID 签名独立验签、设备数量并发上限、账号隔离、密钥轮换、失效订阅、超时/部分失败边界、跳转拒绝及通知固定文案；不向外部推送服务发送测试请求。

在[隔离预览](local-preview.md)中配置临时公钥后，可用相同本地 `AUTH_SECRET` 运行 `PREVIEW_URL=http://localhost:8790 pnpm exec tsx scripts/check-push-preview.ts`。脚本只允许 loopback，测试认证、CSRF、非法地址、重复提交、跨账号操作、设备上限及取消订阅；会清理种子账号订阅，不得用于生产。

在本地已登录的个人中心运行 `tests/browser/assert-push-mobile.js`，检查未安装的 iOS 即使没有暴露 Push API，也会先得到添加到主屏幕的指引，而不是被误判为浏览器不支持。

2026-11-26 验证了 53 项自动测试及本地 29 项订阅 API 检查。实际测试 Chrome 临时授权后完成真实订阅、关闭网页、真实推送服务 201 接收、后台通知生成与取消订阅；推送签名由本地 workerd 生成，网络投递复用已有系统代理（本地 workerd 直连该服务超时）。浏览器授权由测试 CDP 会话提供，不等同于用户在手机系统上点过允许；真实 iPhone/Android、真实 SMTP 投递和长期到达率仍需单独验收。

参考：[Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)、[VAPID RFC 8292](https://www.rfc-editor.org/rfc/rfc8292)、[Cloudflare email 处理上下文](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/)。
