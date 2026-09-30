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
