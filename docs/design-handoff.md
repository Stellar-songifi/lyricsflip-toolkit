# Design handoff — auth screens

Source of truth for visual design is Figma; this file captures the tokens engineers need without opening the file.

- [Figma — game design](https://www.figma.com/design/6phOWkHKQgLRhRwmBBQDXB/LyricsFlip?node-id=0-1&t=0U8SlbaJijr7XNeG-1)
- [Figma — contributors page](https://www.figma.com/design/cUgNi0Ck7HS6QHLim7xOTY/Projects?node-id=89-259&t=VGBgLi8VhPgV9N5u-1)
- [Notion documentation](https://www.notion.so/LyricFlip-Documentation-188644d19c538007af9be7fafb912b9c?pvs=4)

## Colours

| Token         | Hex       | Usage                          |
| ------------- | --------- | ------------------------------- |
| `brand-600`   | `#5B21B6` | Primary buttons, active states |
| `brand-400`   | `#8B5CF6` | Hover/secondary accents        |
| `accent-300`  | `#FDE68A` | Card back, highlights           |
| `bg-canvas`   | `#0F0B1A` | App background (dark)          |
| `bg-surface`  | `#1A1425` | Card / panel surface           |
| `text-primary`| `#F5F3FF` | Primary text on dark surfaces  |
| `text-muted`  | `#A78BFA` | Secondary text, captions       |
| `success`     | `#34D399` | Correct guess                  |
| `error`       | `#F87171` | Wrong guess, timeout            |

These map to `apps/mobile/src/lib/theme.ts`. The web game in `Stellar-songifi/lyricsflip` uses them in its Tailwind config.

## Typography

| Role      | Font                         | Weight | Notes                     |
| --------- | ----------------------------- | ------ | -------------------------- |
| Display   | Space Grotesk                | 700    | Card titles, scores        |
| Body      | Inter                        | 400/500| Everything else            |
| Mono      | JetBrains Mono                | 500    | Countdown timer, XP counter|

## Motion

- Card flip: 400ms, ease-in-out, using Framer Motion's `rotateY`.
- Correct guess: scale pulse (1 → 1.05 → 1), 250ms.
- Timer runs on a linear progress bar that turns from `accent-300` to `error` in the final 3 seconds.

This file only covers what's needed to build the auth screens today. Pull full specs from Figma for anything not listed here.
