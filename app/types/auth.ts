export interface UserSession {
  id: string
  oidcSubject: string
  email: string
  displayName: string | null
}
