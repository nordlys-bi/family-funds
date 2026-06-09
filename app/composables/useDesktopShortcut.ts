import { onBeforeUnmount, onMounted } from 'vue'

export function useDesktopShortcut(key: string, handler: () => void) {
  const normalizedKey = key.toLowerCase()

  const isDesktop = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches

  const listener = (event: KeyboardEvent) => {
    if (!isDesktop()) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.key.toLowerCase() !== normalizedKey) return

    const target = event.target as HTMLElement | null
    if (target) {
      const tagName = target.tagName
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) {
        return
      }
    }

    event.preventDefault()
    handler()
  }

  onMounted(() => {
    window.addEventListener('keydown', listener)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', listener)
  })
}
