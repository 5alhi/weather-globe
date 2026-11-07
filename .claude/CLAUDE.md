# Owner's standing rules

## Prefer code and free services over anything that uses AI tokens

Whenever a job can be done with code or a free service (GitHub Actions, cron, webhooks, scripts, free APIs), that is
the default choice, and the one to suggest first when asked how to do something. Don't build recurring work on Claude
routines, scheduled agents or anything else that consumes tokens when a programmatic way exists, even if writing the
code costs more than 50 or more runs would: usage limits are likely to be hit, and nothing should depend on them.
Use AI only where judgment is truly needed, and say why when proposing it.

## How the Weather Globe is set up

- Live site: https://weather-globe.salhi.com (non-commercial, Open-Meteo free terms). `/version.txt` shows the
  deployed upstream commit. The page keeps josephsalhi.com as its canonical address on purpose.
- Upstream: vazyvazy123/weather-globe (Joseph Salhi's, not the owner's). Never push, comment or open issues/PRs there.
- Fork: 5alhi/weather-globe. Its `main` is upstream plus the owner's own files (the hourly sync workflow and this
  file); keep other changes on branches so syncs never conflict. The sync can't merge upstream changes to workflow
  files: then use the fork's "Sync fork" button.
- Deploy: 5alhi/weather-globe-deploy (private). Coolify builds its Dockerfile on every push to `main`.
  `.github/workflows/auto-update.yml` deploys hourly with no AI: see that repo's README.
- The Claude routine "Weather Globe: review and deploy updates" is paused and replaced by the workflow above.
- Coolify's dashboard needs the owner's own sign-in. Never handle the owner's passwords or tokens.
