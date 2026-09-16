import { combinePresetAndAppleSplashScreens, defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Splash-Screens fuer alle Apple-Geraete aus derselben Quellgrafik generieren:
// gleiche Hintergrundfarbe + zentriertes Icon fuer jede Groesse, keine
// handgemachten Grafiken pro iPhone-/iPad-Modell (issue #123).
export default defineConfig({
  headLinkOptions: {
    preset: '2023',
  },
  preset: combinePresetAndAppleSplashScreens(minimal2023Preset, {
    resizeOptions: { fit: 'contain', background: '#0b0f19' },
    // Kein Dark-Splash-Set konfiguriert (nur eine Variante, siehe Issue).
    // Ohne festen `name` haengt die Default-Benennung davon ab, ob der
    // jeweilige Code-Pfad `dark` explizit als false mitgibt oder weglaesst -
    // die generierten Dateien heissen dann anders als die <link>-Hrefs
    // (fehlendes "-light-"), was zu 404s fuehrt. Fester Name haelt beide
    // Seiten identisch.
    name: (landscape, size) =>
      `apple-splash-${landscape ? 'landscape' : 'portrait'}-${size.width}x${size.height}.png`,
  }),
  images: ['public/favicon.svg'],
})
