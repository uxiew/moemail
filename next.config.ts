import withPWA from 'next-pwa'
import createNextIntlPlugin from 'next-intl/plugin'
import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';

async function setup() {
  if (process.env.NODE_ENV === 'development') {
    const localState = process.env.MOEMAIL_LOCAL_STATE_DIR
    await setupDevPlatform(localState ? {
      persist: { path: localState },
      envFiles: [],
      remoteBindings: false,
    } : undefined)
  }
}

setup()

const withNextIntl = createNextIntlPlugin('./app/i18n/request.ts')

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      }
    ],
  },
};

const withPWAConfigured = withPWA({
  dest: 'public',
  register: false,
  skipWaiting: true,
  // 邮箱和登录页面必须走网络，不能在退出登录后回放旧账号的 API/HTML 缓存。
  cacheStartUrl: false,
  dynamicStartUrl: false,
  runtimeCaching: [],
  // App Router 的内部构建清单不会发布到 Pages；预缓存它的 404 会使整个 SW 安装失败。
  buildExcludes: [/app-build-manifest\.json$/],
  disable: process.env.NODE_ENV === 'development',
}) as any

const configWithPWA = withPWAConfigured(nextConfig as any) as any

export default withNextIntl(configWithPWA)
