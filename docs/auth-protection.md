# 登录与注册防护

## 当前范围

本轮修复应用侧人机验证和防爆破，不改账号、密码存储、API Key 权限或数据库结构。生产网站目前没有启用 Turnstile；本轮使用隔离数据和 Cloudflare 官方测试密钥验证，尚未配置真实站点或部署防护改动。

| 入口 | 防护 |
|---|---|
| 密码登录 `/api/auth/callback/credentials` | 处理前按 Cloudflare IP 限制 20 次/分钟；启用 Turnstile 后必须通过服务端验证 |
| 注册 `/api/auth/register` | 5 次/分钟/IP，仍受原有注册开关控制；启用 Turnstile 后必须验证 |
| 上述表单请求 | 最多 32 KiB，令牌最多 2048 字符；不相信客户端 Content-Length，读取流时仍检查 |
| 已登录会话、API Key、OAuth 回调和退出登录 | 不增加验证码；原有鉴权、权限检查和 API 限流保持不变 |

认证表单原生方法为 POST，避免 JavaScript 不可用时把密码放进 URL。限流响应兼容 NextAuth 客户端的错误 URL，并带 `Retry-After`；页面提示稍后重试，不把限流误报成浏览器 URL 解析错误。

## Turnstile 配置

1. 在 Cloudflare 为本站创建真实 Turnstile 站点，允许实际使用的域名：`mail.xdwa.top`、`xdw.cc.cd`、`mail-aft.pages.dev`。不要允许任意域名，不把 localhost 加到生产站点。
2. 已登录管理员进入「个人中心 → 网站配置」，填写 Site Key、Secret Key 并开启 Turnstile。普通登录页只获得公钥，Secret Key 用于服务端校验；管理员配置接口沿用原有管理权限，响应禁止缓存。不要把密钥放进公开文档、日志或公共脚本。
3. 保存后，用新的浏览器会话检查登录和注册；保留原管理员会话用于恢复。KV 有传播延迟，不能承诺全节点瞬时切换。

开启后，缺密钥、配置读取失败、无令牌、验证服务超时、非正常响应、域名/action 不匹配都会拒绝放行。配置服务异常不会自动降级成免验证码。未传 `turnstile` 的旧版配置请求保留现有设置，不再意外关闭验证。

关闭状态只读取开关，不额外读取密钥。启用时后端仅向 Siteverify 发送应用密钥和不透明令牌，不发送用户名、密码、邮件内容或 `remoteip`。`login` 与 `register` 使用不同 action；前端会在切换、过期和失败后重新获取令牌。

正常用户可能自动通过托管挑战，不一定看到图片题；不能因此省略服务端 Siteverify。组件加载失败可手动重试，窄屏使用紧凑尺寸，组件卸载或更换 action 时会清理旧实例。

## 限制与恢复

- IP 节流和令牌去重只作用于单个运行实例，不是全局配额保证。重启、不同节点或容量淘汰会重置部分状态；没有新增逐请求 KV 写入计数。
- 令牌去重使用 5 分钟有效窗口和最多 2048 个哈希项，减少同实例并发重放；Cloudflare 的全球令牌重放识别也存在传播延迟，不能宣称绝对一次性执行。[服务端验证说明](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- 这不会让被拦截的 Functions 请求免费，也不能抵御所有分布式攻击。要保护平台额度，还需按实际套餐和流量配置入口 WAF/限流；不能给所有 API 返回 HTML 挑战，否则会破坏程序调用。
- 如果只保护自定义域名，还需考虑默认 `pages.dev` 入口。不要一刀切挑战 manifest、Service Worker、静态资源和 OAuth 回调；本轮没有更改线上 WAF 或关闭任何入口。
- 配置错误时，已有管理员会话仍可关闭开关或修正密钥；无有效会话时，可由站点所有者通过 Cloudflare KV 将 `TURNSTILE_ENABLED` 改回字符串 `false` 临时恢复，随后修正配置并重新验证。不要通过删除后端校验来恢复登录。

## 本地回归

```sh
pnpm test:security
pnpm test:pwa
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm build:pages
pnpm test:pwa:build
```

在[隔离预览](local-preview.md)的本地 Wrangler 配置中显式设置 `TURNSTILE_TEST_MODE = "true"`，再配置 [Cloudflare 官方测试键](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)。必须同时满足测试键配对、该标记和 loopback 域名；生产域名始终拒绝测试键。该测试配置不得发布。

使用同一预览 `AUTH_SECRET` 执行：

```sh
PREVIEW_URL=http://localhost:8795 pnpm exec tsx scripts/check-auth-security-preview.ts
```

脚本只允许 loopback，使用假账号，临时改变本地验证码与注册配置，并在结束时恢复配置。它验证缺令牌拒绝、官方测试令牌登录/注册、旧客户端配置兼容、非法类型、注册节流和请求大小限制；测试键不代表真实站点的反机器人效果。

本地已通过 67 项自动测试、既有 119 次 API 断言和 18 项新增安全 API 检查。真实浏览器检查了官方测试组件的显示与登录；故意损坏本地密钥后，页面禁用提交、服务端拒绝登录，已有管理员会话可修复设置。真实生产密钥、真实设备反机器人判定和线上 WAF 尚未验证。
