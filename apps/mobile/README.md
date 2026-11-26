# mobile

LyricsFlip for iOS and Android: Expo SDK 57, Expo Router and TypeScript. It talks to
[`apps/game-server`](../game-server).

```bash
npm install && npm run build   # from the repository root
cd apps/mobile
cp .env.example .env           # EXPO_PUBLIC_API_URL=http://<your LAN IP>:3001
npx expo start
```

Screens are in `app/`, and shared code in `src/`. The wallet is a testnet-only key on the device. Everything
else (features, push, deep links, React Native polyfills) is in [`docs/mobile.md`](../../docs/mobile.md).

The app has an in-app notifications inbox, a leaderboard, and match history. Crashes are reported to
Sentry when `EXPO_PUBLIC_SENTRY_DSN` is set, and offline state is shown with a banner.
Builds and releases are documented in [`docs/release.md`](../../docs/release.md).
