import { defineEventHandler } from 'h3'
import { clearSessionCookie } from '../../utils/auth-session'

export default defineEventHandler(async (event) => {
  clearSessionCookie(event)
  return { success: true }
})
