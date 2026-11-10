# Cloudflare 配额与安全复核

## 当前结论

2026-11-11 收尾验证保留 Next.js 15、React 19 和现有 Cloudflare Pages 部署方式，没有部署、操作远端 D1 或修改线上 WAF。

- Next.js 更新到 **15.5.29**，React/React DOM 更新到 **19.0.9**，ESLint 配置与 Next 对齐。
- 构建工具固定为 **Node.js 24.22.2、pnpm 12.8.1**，由项目 `.mise.toml` 和部署 CI 指定；全局默认版本未改。
- 原来的 `x-middleware-subrequest` + 伪造用户 ID 绕过在 Next 15.1.1 本地复现为 200；更新后的 Next 开发运行时和实际 Pages 产物均返回 401。
- 注册接口不删除，改用管理员开关；具体操作和首次管理员初始化见[注册配置](local-preview.md#注册开关)。

没有线上请求分布或 D1 扫描量数据，不能断言哪种配额先耗尽，也不能承诺“减少 80%”。D1 按扫描行数计量，不能用 ORM 方法次数代替实际读取行数。

## 原方案的处理

| 项目 | 当前处理 |
|---|---|
| robots.txt、30 秒轮询 | 基线已有，不重复添加。爬虫规则不是鉴权或限流。 |
| 后台轮询与失效请求 | 请求串行、隐藏暂停、卸载取消，401/403/404/410 停止；网络错误退避。配置接口失败也不再无间隔重试。 |
| 双布局 | 桌面/手机只挂载当前布局；分享详情同样处理，避免重复 iframe 和标签指向隐藏控件。 |
| 删除 count | 保留 `total` API 契约及界面显示；以后依据 `rows_read` 决定是否增加兼容的按需计数，不伪造总数。 |
| 角色写入 JWT | 不做长期权限快照；保留实时角色查询，中间件复用身份解析结果。 |
| 过期收件 | 查询有效邮箱后再解析 MIME；过期或不存在则拒收，不写库、不触发 webhook，也不输出正常邮件正文/主题日志。 |
| 清理任务 | 保留新提交的子查询及 10 批 × 100 个邮箱上限。改按 `RETURNING id` 统计父邮箱，避免把级联删除的邮件/分享记录计入邮箱数量。 |
| KV 限流 | 不做逐请求 KV 写入计数。采用已有的实例内内存节流，但补上 10,000 个键的容量上限。 |
| 身份头及角色查询 | 保留已提交的净化、API Key 权限检查、`PROMOTE_USER` 检查；实际请求验证普通用户不能修改配置或查询角色管理接口。 |
| 注册 | 默认为关闭；关闭阻止新建账号但不影响已有账号登录，OAuth 创建账号也经过同一开关。 |
| 语言 | 与现有中文界面一致，只启用 `zh-CN`，保留英文资源文件。 |

### 限流与清理的边界

- 内存计数只属于当前 isolate。重启、跨节点和容量淘汰会重置部分计数，**不是全局配额或账单保障**。
- 私有 API 在认证后节流，认证查询和 Functions 请求本身仍消耗额度。公开分享接口在查库前按 Cloudflare IP 节流；不采用任意客户端传入的 `X-Forwarded-For`。
- 当前阈值保持为：分享 30 次/分钟/IP、生成邮箱 10 次/分钟/用户、其他 API 60 次/分钟/用户。
- 清理每次最多删 1,000 个邮箱，不等于最多写入 1,000 行；关联邮件、分享记录、索引也会消耗 D1 写入额度。
- 本地 D1 原本能执行 `DELETE ... LIMIT`，不能把原 SQL 语法当作已经证实的线上根因。

## 验证证据

```sh
mise install
pnpm install --frozen-lockfile
WRANGLER_SEND_METRICS=false pnpm test:quota
pnpm exec tsc --noEmit --incremental false
NEXT_TELEMETRY_DISABLED=1 pnpm lint
NEXT_TELEMETRY_DISABLED=1 pnpm build
```

- 29 项自动测试覆盖轮询、权限终止状态、退避、并发/取消、限流窗口与缓存容量、注册开关、并发用户名冲突，以及真实本地 D1 的清理上限、级联删除、空批次和部分失败恢复。
- 本地 HTTP 回归验证 Cookie/API Key、身份头伪造、框架绕过、管理员权限、注册开关、重复用户名和限流。保留攻击用例，不能删断言让测试变绿。
- Pages 路径实际执行了 **Vercel build → next-on-pages 转换 → Wrangler Pages dev**，生成 31 个 Edge 路由，不仅是 Next 编译通过。
- Node 24.9.0 冷构建多次 `SIGSEGV`，热构建曾通过一次；同一应用在 24.22.2 干净构建成功。固定已验证工具链，但不把这个对照夸大为已确认某个 V8 缺陷的根因。
- next-on-pages 1.13.16 的声明范围止于 Next 15.5.2；已验证当前组合，不抹掉这个上游维护风险，也不擅自迁移到另一套部署架构。
- 浏览器检查实际 Pages 的登录、邮箱、分享及移动端布局；复现见[本地预览](local-preview.md)及[浏览器检查](../tests/browser/README.md)。

## 尚未验证

没有推送或部署，没有运行远端 CI，也没有连接真实 OAuth 账号、投递真实邮件或做线上负载测试。上线前仍需核对真实配额指标、清理积压、边缘规则，以及大邮件和投递重试策略。

## 官方依据

- [Next.js 安全更新](https://nextjs.org/blog/november-2026-security-release)：15.x 维护线的安全补丁为 15.5.29。
- [中间件绕过公告](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw)：不能仅修应用层身份头而保留受影响的框架版本。
- [Pages Functions 配额](https://developers.cloudflare.com/pages/functions/pricing/)：与 Workers Free 共享每天 100,000 次请求；未执行函数的静态资源不计入。
- [D1 计量](https://developers.cloudflare.com/d1/platform/pricing/)：免费每天 5,000,000 行读取、100,000 行写入，应看实际扫描和写入指标。
- [KV 限制](https://developers.cloudflare.com/kv/platform/limits/)及[一致性](https://developers.cloudflare.com/kv/concepts/how-kv-works/)：不适合逐请求、原子读改写的计数器。
