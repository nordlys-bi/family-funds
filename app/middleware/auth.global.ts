export default defineNuxtRouteMiddleware(async (to, from) => {
  // Prevent infinite redirect
  if (to.path === '/login') return

  const { isLoggedIn, fetchUser } = useAppAuth()
  
  // Fetch session if not loaded yet
  await fetchUser()

  if (!isLoggedIn.value) {
    return navigateTo('/login')
  }

  // If logged in, ensure household context is loaded
  const { households, fetchHouseholds } = useHousehold()
  if (households.value.length === 0) {
    await fetchHouseholds()
  }
})
