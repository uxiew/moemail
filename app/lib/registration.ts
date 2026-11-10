import type { Adapter } from 'next-auth/adapters'
import { users } from './schema'
import type { Db } from './db'
import { hashPassword } from './utils'

export const REGISTRATION_ENABLED_KEY = 'REGISTRATION_ENABLED'

type RegistrationStore = { get(key: string): Promise<string | null> }

export async function isRegistrationEnabled(store: RegistrationStore): Promise<boolean> {
  return await store.get(REGISTRATION_ENABLED_KEY) === 'true'
}

// OAuth 也会创建账号；只保护注册路由会留下另一条新用户入口。
export function withRegistrationControl(adapter: Adapter, store: RegistrationStore): Adapter {
  const createUser = adapter.createUser
  if (!createUser) return adapter
  return {
    ...adapter,
    async createUser(user) {
      if (!await isRegistrationEnabled(store)) throw new Error('Registration is disabled')
      return createUser(user)
    },
  }
}

export class UsernameTakenError extends Error {
  constructor() {
    super('用户名已存在')
  }
}

export async function registerUser(db: Db, username: string, password: string) {
  const [user] = await db.insert(users)
    .values({ username, password: await hashPassword(password) })
    .onConflictDoNothing({ target: users.username })
    .returning({ id: users.id, username: users.username, name: users.name, email: users.email, image: users.image })
  if (!user) throw new UsernameTakenError()
  return user
}
