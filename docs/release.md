# Mobile builds and releases

EAS builds and (once stable) submissions are manual by design (issues #127 and #128).

## One-time setup

- `npm install -g eas-cli`, then `eas login` and `eas init` inside `apps/mobile` to create the EAS
  project and set `extra.eas.projectId` in `app.json`. Commit the project id; it is not a secret.
- Apple: an App Store Connect account, a distribution certificate and a provisioning profile (or let
  EAS manage them). Google: a Play Console service-account JSON with release permissions.
- Store those credentials **only in EAS** (`eas credentials`) or as GitHub secrets. Never commit
  certificates, keystores or service-account JSON.
- GitHub secrets used by `.github/workflows/release.yml`:
  `EXPO_TOKEN` (required), `EXPO_APPLE_ID`, `EXPO_APPLE_APP_SPECIFIC_PASSWORD` (only for submission),
  and `GOOGLE_SERVICE_ACCOUNT_JSON` (only for Android submission).
- Set `EXPO_PUBLIC_SENTRY_DSN` for the build environment to enable crash reporting.

## Profiles (`apps/mobile/eas.json`)

| Profile | Use | Output |
|---|---|---|
| `development` | debugging on a dev device | internal APK / dev-signed build (no `expo-dev-client` dependency yet) |
| `preview` | QA and Maestro flows | internal APK / TestFlight build |
| `production` | store release | app-store binaries |

## Dispatching a build

1. GitHub → Actions → `release` → **Run workflow**.
2. Pick the platform (`all`, `ios`, `android`), profile (`preview` or `production`) and whether to
   submit. Leave submit off for the first preview build.
3. The workflow runs `npm ci`, builds the SDK, then `eas build --profile <profile> --platform <platform>`.
   With submit enabled it runs `eas submit` for the matching platform.
4. Install the preview artifact (TestFlight or the internal Android track) and smoke-test sign-in and
   a solo match before promoting it.

## Maestro end-to-end flows

`.maestro/` contains sign-in, solo-play, daily and staked head-to-head flows. Put the flows and a
built app binary in the manual `mobile` workflow dispatch (E2E enabled) with a game server in `mock`
settlement mode. Maestro Cloud needs `MAESTRO_CLOUD_API_KEY` and `MAESTRO_CLOUD_PROJECT_ID` secrets.
Local runs: `npx maestro test apps/mobile/.maestro/solo-play.yaml` with the app installed on a
device/emulator and `EXPO_PUBLIC_API_URL` pointing at a reachable server.
