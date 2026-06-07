import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  if (event.context.user) {
    return {
      user: event.context.user,
    }
  }
  return { user: null }
})
