import { defineEventHandler, deleteCookie } from 'h3'

export default defineEventHandler(async (event) => {
  deleteCookie(event, 'session_user_id', {
    path: '/',
  })
  return { success: true }
})
