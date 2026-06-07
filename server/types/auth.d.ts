import { User } from '@prisma/client'

declare module 'h3' {
  interface H3EventContext {
    user?: {
      id: string
      oidcSubject: string
      email: string
      displayName: string | null
    }
  }
}

export {}
