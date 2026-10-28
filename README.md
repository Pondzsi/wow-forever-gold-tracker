# Forever Gold Tracker

A local dashboard for gold, prices, crafting profit, professions and farming/fishing sessions in WoW: Forever.
Design and scope: [docs/v1-spec.md](docs/v1-spec.md).

## Start

Double-click `start-dashboard.bat`. It opens http://localhost:5173 in your browser.
Keep the black window open while you use the dashboard.

Or from a terminal:

```bash
npm run dev
```

## Your data

- Data is saved in your browser (IndexedDB) for `http://localhost:5173`.
- Always use the same browser and the same address, or you will see an empty dashboard.
- Clearing browser data deletes it. Use **Settings & backup → Download backup** regularly.

## Money input

Any of these work: `12g 34s 56c`, `12g`, `50s`, `123456c`, or `12.3456` (gold).

## Development

```bash
npm test          # unit tests (money and profit calculations)
npm run typecheck # TypeScript check
npm run build     # production build into dist/
```
