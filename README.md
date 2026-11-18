# Kids activities (by Sim Lab)

A static page plus a scraper that refreshes its data every Monday.

## Set up (once)
1. Create a GitHub repository and push this folder to the `main` branch.
2. In the repository go to Settings, then Pages, and set Source to "GitHub Actions".
3. Open the Actions tab, pick "Refresh and publish" and press "Run workflow".
4. When it finishes, the page is live at `https://<your-user>.github.io/<repo>/`. Share that link.

Every Monday the workflow scrapes all sources, commits `data/events.json` and republishes. You can also run it by hand at any time.

## Run locally
```
npm install
npx playwright install chromium
npm run all        # scrape, then build dist/index.html
```

## Where to change things
- `config/exclude.json`: titles and URL patterns of paid courses or adult offers to drop.
- `data/manual.json`: hand-picked entries that are never overwritten (Zoo, Opernhaus tour and so on).
- `scripts/scrape.mjs`: one function per source.
- `template/index.html`: the page itself. The line `const EVENTS=/*EVENTS*/[]/*END*/;` is replaced at build time.

## Known limits
- The scraper was written without being able to run it against the live sites. Check the first run's log in the Actions tab. If a source reports "nothing found" or "FAILED", the old data for it is kept and its parser needs a small fix.
- gz-zh.ch is filtered by keywords (see `GZ_KIDS` in the scraper) and by `config/exclude.json`.
- kinderregion.ch only yields the highlight events. Its full list needs a dedicated parser.
- stadt-zuerich.ch lists no dated events and is not scraped.
