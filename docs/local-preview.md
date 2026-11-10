# 本地预览与回归

## 启动真实页面

在仓库根目录运行。以下数据、账号和密钥只用于本地测试，不要部署或连接远端资源。

```sh
mise install
export PREVIEW_STATE="$(mktemp -d /tmp/moemail-preview.XXXXXX)"
export MOEMAIL_LOCAL_STATE_DIR="$PREVIEW_STATE/v3"
export AUTH_SECRET="local-test-only-not-a-production-secret"
export NEXT_TELEMETRY_DISABLED=1
export VERCEL_TELEMETRY_DISABLED=1
export WRANGLER_SEND_METRICS=false
export DO_NOT_TRACK=1
pnpm exec tsx scripts/seed-local-preview.ts
pnpm dev --hostname 127.0.0.1
```

始终访问 `http://localhost:3000/zh-CN`，不要与 `127.0.0.1` 混用，否则登录 Cookie 不共享。

- 邮箱预览账号：`preview_duke`。
- 管理员设置账号：`preview_emperor`。
- 两者密码均为 `LocalPreviewOnly123!`。
- 分享页：`http://localhost:3000/zh-CN/shared/preview-share-token`。
- 有普通、长地址、空邮箱和 25 封假邮件；不会调用外部邮件投递服务。

项目使用 Node.js 24.22.2 / pnpm 12.8.1，不修改全局默认版本。Node 24.9.0 在本机冷构建时曾多次出现 `SIGSEGV`；不要把只成功一次的热构建当作兼容性证明。

`MOEMAIL_LOCAL_STATE_DIR` 只改变开发服务器的本地 D1/KV 存储目录；隔离模式不加载 `.env` 或远端绑定，缺省开发行为不变。种子脚本拒绝覆盖已有数据库、拒绝远端绑定；重复预览时换一个新的空目录。上述环境变量只在当前终端生效，不写 `.env`。

## 检查真实 Pages 产物

先停止 `pnpm dev`，不要让两个本地服务同时使用同一个数据库目录。在上面的同一终端中：

```sh
pnpm build:pages
pnpm exec wrangler pages dev .vercel/output/static \
  --ip 127.0.0.1 --port 8788 --persist-to "$PREVIEW_STATE" \
  --binding AUTH_SECRET="$AUTH_SECRET" \
  --binding AUTH_TRUST_HOST=true \
  --binding AUTH_URL=http://localhost:8788
```

访问 `http://localhost:8788/zh-CN`。HTTP 本地预览必须明确 `AUTH_URL`；否则 Auth.js 的内部会话请求可能按 HTTPS 选 Cookie，表现为登录拿到了 Cookie，后续接口仍返回 401。不要把这个 localhost 配置部署到生产。

当前保留 next-on-pages 1.13.16。其 peer 范围上限是 Next 15.5.2；安全更新的 15.5.29 超出声明范围。本项目已验证 Vercel 构建、Pages 转换、本地 Worker API 和浏览器流程，但这不是上游支持承诺；后续升级必须重跑这些检查。

## 注册开关

进入「个人中心 → 网站配置 → 允许新用户注册」，修改后点击「保存配置」。

- 只有管理员（皇帝）可以保存；服务端同样校验权限。
- 缺省关闭。开启后登录页显示注册选项卡；关闭后注册 API 返回 403，已有账号仍能登录。
- OAuth 创建新账号也受开关控制，已有 OAuth 账号的登录不受影响。
- KV 键为 `REGISTRATION_ENABLED`，只有字符串 `true` 开启。沿用现有 KV 配置架构，跨节点生效可能有缓存延迟；页面没有刷新时仍以服务端检查为准。
- 如果是全新部署，需要先临时将该 KV 键设为 `true`，注册并完成既有的首位管理员初始化流程，然后在设置页关闭注册。
- 旧版配置 API 调用没有传 `registrationEnabled` 时保持原值；传字符串、对象等非布尔值会返回 400。

## 验收

```sh
pnpm test:quota
pnpm exec tsc --noEmit --incremental false
pnpm lint
```

保持上面的开发服务器运行，在另一个带相同 `AUTH_SECRET` 的终端执行：

```sh
pnpm exec tsx scripts/check-local-preview.ts
# 测试 Pages 产物时改用：
PREVIEW_URL=http://localhost:8788 pnpm exec tsx scripts/check-local-preview.ts
```

不要同时打开多个测试客户端反复跑限流检查；每个固定窗口是 60 秒。脚本先预热分享路由，避免开发模式首次编译重建 middleware isolate 干扰计数，再用独立的模拟 Cloudflare IP 验证阈值。

该脚本只允许 localhost/127.0.0.1，使用种子账号验证 Cookie/API Key、身份头净化、权限、注册开关、重复用户名和登录。发现中间件绕过时必须失败，不能删掉该断言来让测试变绿。

真实浏览器按下面顺序检查，每个页面加载完成后在 Console 执行 `tests/browser/assert-live-ui.js`：

1. 首页、登录页：登录表单只在登录页出现；输入框对齐，Enter 能提交。
2. 邮箱页：1440×900 下三栏标题同高；390×844 下长地址和正文不撑宽页面。查看邮件、滚动分页、返回列表。
3. 切换两封 HTML 内容相同的邮件：正文都应显示；切换浅色/深色后正文同步，且没有新增页面横向滚动条。
4. 分享页：仅挂载当前断点的详情；手机上点击「纯文本格式」能切换，不会操作隐藏控件。
5. 管理员设置：输入框对齐，开关保存后重新加载仍保持；普通用户不可保存。
6. 开启后匿名注册；关闭后新账号注册被拒绝，但已有账号仍可登录。

浏览器模拟接口的轮询专项回归仍见 [原有说明](../tests/browser/README.md)，不能用它替代上述真实 API 流程。
