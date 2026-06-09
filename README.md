# NFHS-6 India State Choropleth

This is a static choropleth app for NFHS-6 state and union territory indicators.

At runtime it loads only local relative files:

- `data/nfhs_state_indicators.json`
- `data/india_states_ut.geojson`
- `vendor/d3.min.js`

The browser does not parse the PDF and does not ask for a file upload.

## Rebuild the JSON and GeoJSON

The raw factsheet PDF must exist at:

```bash
data/raw/nfhs6_factsheets.pdf
```

Rebuild the processed dataset with:

```bash
python3 scripts/build_nfhs_data.py
```

This script:

- extracts the India and State/UT factsheet rows
- uses only the printed `Total` values
- uses the India factsheet NFHS-6 `Total` as the national comparison value
- classifies indicator polarity deterministically
- validates dataset-to-GeoJSON region matching
- writes:
  - `data/nfhs_state_indicators.json`
  - `data/india_states_ut.geojson`

## Local preview

Any static file server will work. One simple option is:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8000
```

## Deploying publicly

This project is deployment-ready as a static site.

Important deployment points:

- All runtime asset paths are relative.
- The app does not depend on `localhost`.
- The app does not fetch files from your local machine.
- The app works from a subpath such as `https://USERNAME.github.io/nfhs-state-map/`.
- The `.nojekyll` file is included so GitHub Pages serves the site as plain static files.

### GitHub Pages

1. Create a GitHub repository, for example `nfhs-state-map`.
2. Push the contents of this folder to the repository root.
3. In GitHub, open `Settings` -> `Pages`.
4. Under `Build and deployment`, choose:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main` (or your default branch)
   - `Folder`: `/ (root)`
5. Save.
6. After Pages finishes publishing, open:
   - `https://USERNAME.github.io/nfhs-state-map/`

### Netlify

1. Create a new site from your Git repository, or drag and drop this folder in the Netlify dashboard.
2. If using Git-based deploys:
   - Build command: leave blank
   - Publish directory: `.`
3. Deploy the site.

### What must be committed

Commit these files and folders at minimum:

- `index.html`
- `styles.css`
- `app.js`
- `data/`
- `vendor/`
- `.nojekyll`

## Files

- `index.html`
- `styles.css`
- `app.js`
- `scripts/build_nfhs_data.py`
- `data/nfhs_state_indicators.json`
- `data/india_states_ut.geojson`
- `data/state_name_aliases.json`
- `vendor/d3.min.js`
- `.nojekyll`

## Notes

- The processed dataset contains 101 indicators and 35 state/UT regions, with Manipur intentionally absent because the NFHS-6 factsheet compendium does not include a Manipur fact sheet.
- Missing values from the printed factsheets are stored as `null` and shown in grey on the map.
- Equality comparisons use the printed indicator precision captured during preprocessing.
