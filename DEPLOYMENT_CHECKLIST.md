# Deployment Checklist

Diese Checkliste hilft dir, `family-funds` sauber auf **Vercel** mit **Supabase** und **Clerk** in Produktion zu bringen.

## 1. Vorbereitung

- [ ] GitHub-Repository ist vorhanden und aktuell
- [ ] Lokaler Build funktioniert: `npm run build`
- [ ] `.env.example` ist aktuell
- [ ] `.env` ist nicht im Git-Repository

## 2. Supabase einrichten

- [ ] Neues Supabase-Projekt anlegen
- [ ] Datenbank-Region passend zu deinem Zielmarkt wählen
- [ ] `DATABASE_URL` aus Supabase notieren
- [ ] `DIRECT_URL` aus Supabase notieren
- [ ] Prüfen, ob du den Pooler für `DATABASE_URL` verwenden willst
- [ ] Prisma-Migrationen lokal oder in CI gegen Supabase ausführen:
  - [ ] `npx prisma migrate deploy`
- [ ] Optional Seeds einspielen, falls du Demo-Daten brauchst:
  - [ ] `npx prisma db seed`

## 3. Clerk einrichten

- [ ] Clerk-Anwendung ist vorhanden
- [ ] Publishable Key notiert
- [ ] Secret Key notiert
- [ ] Webhook-Endpunkt anlegen:
  - [ ] URL: `https://<deine-vercel-domain>/api/webhooks/clerk`
- [ ] Events aktivieren:
  - [ ] `user.created`
  - [ ] `user.updated`
- [ ] Webhook Signing Secret notiert

## 4. Vercel einrichten

- [ ] GitHub-Repository mit Vercel verbinden
- [ ] Framework-Erkennung prüfen
- [ ] Build Command setzen oder bestätigen: `npm run build`
- [ ] Install Command setzen oder bestätigen: `npm install`
- [ ] Environment Variables in Vercel setzen:
  - [ ] `DATABASE_URL`
  - [ ] `DIRECT_URL`
  - [ ] `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - [ ] `NUXT_CLERK_SECRET_KEY`
  - [ ] `NUXT_CLERK_WEBHOOK_SIGNING_SECRET`
  - [ ] Optional: `NUXT_PUBLIC_CLERK_SIGN_IN_URL`
  - [ ] Optional: `NUXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`
  - [ ] Optional: `NUXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`
- [ ] Preview- und Production-Umgebungen mit denselben Kernvariablen ausstatten

## 5. Erster Deploy

- [ ] Ersten Production-Deploy aus Vercel auslösen
- [ ] Build-Logs auf Fehler prüfen
- [ ] Browser-Test auf der Produktions-URL durchführen
- [ ] Login unter `/login` testen
- [ ] Haushaltswechsel testen
- [ ] Neue Clerk-User testen
- [ ] Webhook-Sync testen

## 6. Nach dem Deploy

- [ ] Sicherstellen, dass neue Clerk-User lokal in Supabase landen
- [ ] Prüfen, ob der Default-Haushalt beim ersten Login angelegt wird
- [ ] Budget- und Transaktionsseiten testen
- [ ] Klares Monitoring für spätere Fehler einplanen

## 7. Optionaler Feinschliff

- [ ] Vercel Preview-Deploys für Pull Requests aktivieren
- [ ] Supabase Backup-Strategie prüfen
- [ ] Clerk Webhook Retry-Verhalten verstehen
- [ ] Falls nötig, `README.md` mit echter Domain ergänzen

