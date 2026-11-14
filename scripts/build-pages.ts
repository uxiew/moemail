import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// next-on-pages 的包管理器检测会退回 dlx，绕过锁文件下载新版 Vercel。
// 显式执行项目内 CLI，再让适配器只转换刚生成的产物。
const projectFile = '.vercel/project.json';
if (!existsSync(projectFile)) {
  mkdirSync('.vercel', { recursive: true });
  writeFileSync(projectFile, JSON.stringify({
    projectId: '_',
    orgId: '_',
    settings: { framework: 'nextjs' },
  }));
}

execFileSync('vercel', ['build'], { stdio: 'inherit' });
execFileSync('next-on-pages', ['--skip-build'], { stdio: 'inherit' });
