# 已有站点上线与回滚

## 上线前

1. 使用 `.mise.toml` 的 Node/pnpm 版本，运行 `pnpm install --frozen-lockfile`、`pnpm test:quota`、`pnpm test:build`、类型检查、lint 和 `pnpm build:pages`。Pages 构建与运行验收见[本地预览](local-preview.md)。
2. `pnpm exec wrangler whoami` 确认账号，再用 `wrangler pages deployment list --project-name <项目名> --environment production --json` 记录旧部署 ID；两个 Worker 用 `wrangler deployments list --name <Worker名> --json` 记录当前 100% 流量的版本 ID。
3. 将线上配置下载到独立目录，核对 Pages、邮件 Worker 和清理 Worker 指向同一个 D1；保留线上 KV、密钥、兼容日期、路由和 Cron。**不要把本地假数据配置或 `AUTH_URL=http://localhost:8788` 部署上去。**
4. 检查 diff、提交并正常推送；远端有新提交时先合并，不强推。

`pnpm-workspace.yaml` 明确批准锁文件中所需的安装脚本。出现 `ERR_PNPM_IGNORED_BUILDS` 时，先审查新增版本再更新清单，不使用全局放行或关闭检查。

## 更新已有资源

- 使用项目锁定的 Wrangler（`pnpm exec wrangler`），不要用 `pnpm dlx wrangler` 临时下载不同版本。
- Pages 用 `wrangler pages deploy .vercel/output/static --project-name <项目名> --branch main --commit-hash <提交SHA> --commit-message <简短说明>`。必须在核对过的生产配置所在目录执行。
- 两个 Worker 分别先执行 `wrangler deploy --config <生产配置> --dry-run`，再用相同配置部署并加 `--keep-vars`。两次部署都要成功；记录新版本 ID，不以某一条成功代替整体成功。
- 仅更新代码时不要运行一键初始化脚本：`scripts/deploy/index.ts` 还会创建缺失资源、应用 D1 迁移和推送密钥，并且 Worker 失败只告警。该脚本和原有 `Deploy` workflow 适用于已明确接受这些动作的初始化/迁移操作，不是无副作用的更新入口。
- 不手工触发生产清理 Cron、不导入测试种子、不用 `check-local-preview.ts` 测生产。部署清理代码后，既有定时任务会继续按原计划执行。

## 验收与回滚

上线后复查三个部署记录、Pages 生产 URL、登录页和未登录私有 API 的 401；浏览器检查页面与静态资源能加载。真实 OAuth、邮件投递和管理员设置属于另行验收，不能用匿名探测替代。

- Pages：在项目 Deployments 中选旧的成功生产部署，执行 **Rollback to this deployment**；预览部署不能用作生产回滚目标。[Cloudflare 回滚说明](https://developers.cloudflare.com/pages/configuration/rollbacks/)
- Worker：`pnpm exec wrangler rollback <旧版本ID> --name <Worker名> --message <回滚原因>`，分别处理邮件和清理 Worker；回滚后重新检查部署记录。
- 代码回滚不恢复已删除的 D1 数据，也不撤销独立修改过的 KV/密钥。本次无迁移更新不应改这些资源。
- 旧 Pages 版本含已知鉴权漏洞，只作为紧急恢复手段；回滚后需立即限制访问并继续修复，不能长期停留在旧版本。

## 2026-11-14 上线记录

应用源码提交：`42b2ba2a9781151202550cfe3db2180043ce44c4`，已推送 `main`。通过本机锁定工具链直接部署，未触发初始化 workflow；后续上线记录的文档提交不改变该应用产物。

| 组件 | 新部署 / 版本 ID | 上线前回滚点 |
|---|---|---|
| Pages `mail` | `c2ba9244-3301-447a-8ea6-c9fa1ab81cfb` | `af371e91-2299-4c99-a93c-6b923b59fd5b` |
| `mail-email-receiver-worker` | `609ab9bc-742b-4bf7-beb3-b19ca8d470d9` | `3fa50661-7c0c-41dc-9214-df0070e9d6f6` |
| `mail-cleanup-worker` | `3e026251-25de-49c2-adbd-6863f6d2edc3` | `20116b87-516a-492d-b10e-985ca600d081` |

- [生产站点](https://mail.xdwa.top/zh-CN/login)、[备用域名](https://xdw.cc.cd/zh-CN/login)、[Pages 默认域名](https://mail-aft.pages.dev/zh-CN/login) 均通过 5 项检查：登录页 200、匿名邮箱 API 401、伪造身份及 middleware 头仍为 401、匿名配置 API 401、空注册请求 403（注册已关闭，无账号写入）。
- Pages 生产记录对应上述源码提交；两个 Worker 均由新版本承接 100% 流量，部署后从 Cloudflare 重新读取确认。
- 29 项业务回归、3 项构建入口回归、类型检查通过；lint 只有两条既有 Hook 依赖警告。干净安装、Vercel 39.1.1 构建、Pages 转换通过，生成 31 个 Edge 路由；两个 Worker 的 dry-run 通过。
- 真实浏览器检查登录页：1440×900、390×844 均只有一份表单，无横向溢出；两个输入框分别同为 460px、306px 宽，移动端没有注册入口。
- Pages 的 D1/KV 绑定、兼容日期/标志及密钥名称列表保持一致；未执行密钥写入。两个 Worker 的下载配置与上线前一致；清理计划保留 `0 0 * * sat`（每周六 00:00 UTC），没有改成示例文件的每小时执行，也没有手动触发清理。
- 未验证真实 OAuth 登录、真实邮件投递、生产管理员开关操作及长期配额表现；这些不能由部署成功或匿名探测代替。
