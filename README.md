# Shadeside Farms — Operations Dashboard

Farm management dashboard for a 12-acre regenerative farm near Lahore, Punjab, Pakistan.

## Stack

- Vanilla JS, HTML, CSS — no build step, no framework
- [Supabase](https://supabase.com) for database and API
- [Chart.js](https://www.chartjs.org) for charts

## Setup

1. Clone the repo
2. Copy `config.example.js` to `config.js`
3. Fill in your Supabase project URL and anon key in `config.js`
4. Open `index.html` in a browser (or serve with any static file server)

```bash
cp config.example.js config.js
# edit config.js with your credentials
```

## Modules

| Module | Files |
|---|---|
| Animals (groups, intake, weights, feeding, health, breeding) | `js/an_*.js` |
| Feed (recipes, concentrates, ration plans, purchases, prices) | `js/fd_*.js` |
| Finance (cost & sales, farm expenses) | `js/finance_expenses.js`, `js/health.js` |
| Land | `js/land.js` |
| Setup (species, workers, locations, ingredients, etc.) | `js/setup_*.js` |
| Shared utilities | `js/shared.js`, `js/an_helpers.js`, `js/fd_shared.js`, `js/setup_shared.js` |

## Notes

- `config.js` is gitignored. Never commit it.
- The Supabase anon key is a client-side public key by design, but should still be kept out of version control. Protect your data with Supabase Row Level Security (RLS).
