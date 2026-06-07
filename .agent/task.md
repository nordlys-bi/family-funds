# Tasklist: Meilenstein 2 (Clerk OIDC-Integration)

- [ ] `@clerk/nuxt` und `svix` installieren
- [ ] `nuxt.config.ts` anpassen: Clerk-Modul bedingt laden (nur wenn Keys vorhanden)
- [ ] `.env.example` aktualisieren
- [ ] Server-Middleware `auth.ts` auf Dual-Mode umstellen (Clerk JWT vs. Mock-Cookie)
- [ ] Clerk Webhook-Endpoint erstellen (`/api/webhooks/clerk`) mit Svix-Verifikation + Auto-Haushalt
- [ ] `useAuth.ts` Composable erweitern (Dual-Mode: Clerk-Session vs. Mock-Session)
- [ ] `login.vue` erweitern (Clerk `<SignIn />` vs. Mock-Auswahl)
- [ ] Route-Middleware `auth.global.ts` auf Dual-Mode anpassen
- [ ] Default-Layout (`layouts/default.vue`) für Clerk-Modus erweitern (UserButton)
- [ ] Testen: Dev-Server ohne Clerk-Keys → Mock-Modus muss weiterhin funktionieren
