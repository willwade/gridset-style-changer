# Gridset Style Changer

A browser-based tool for fixing common access issues in [Grid 3](https://www.smartboxassistivetechnology.com/products/grid-3/) gridsets (`.gridset`): small text and low-contrast colours.

Private AACTools project.

## What it does

Upload a `.gridset`, then:

- **Common fixes**
  - *Increase font size* — bumps every style's font size by a delta; styles that never set one get base + delta
  - *Make higher contrast* — brings text/background contrast up to 4.5:1 (WCAG AA) or 7:1 (AAA), either by nudging the existing text colour or by forcing black-on-white / white-on-black
  - *Set font size everywhere* / *Change font family*
- Fixes apply to the named styles in `Settings0/Styles/styles.xml` and, optionally, to inline `<Style>` overrides inside every `Grids/*/grid.xml`
- **Per-style editor** — edit colours (Grid 3 `#AARRGGBB`), font family and font size for each named style, with a live preview tile and contrast/size badges
- **Verification** — before download, the modified gridset is run through the `GridsetValidator` from [`@willwade/aac-processors`](https://github.com/AACTools/AACProcessors-nodejs); issues are shown inline (advisory, not a gate)
- **Download** — a new `.gridset` is generated; the uploaded original is never modified

Everything runs client-side. Files never leave the browser.

## Run locally

Any static server works (module scripts need http, not `file://`):

```bash
npx serve .
# or
python3 -m http.server 8000
```

## Deploy to Netlify

1. Netlify → *Add new site* → *Import an existing project* → GitHub → this repo
2. No build settings needed — `netlify.toml` sets publish to the repo root
3. Deploy

## How it works

- JSZip opens the gridset archive; only `Settings0/Styles/styles.xml` and `Grids/*/grid.xml` are edited, everything else is copied through byte-for-byte
- XML is parsed/edited with the browser's native `DOMParser`/`XMLSerializer`
- Contrast maths follows WCAG 2.x relative luminance; the "adjust text colour" mode steps the existing colour's HSL lightness away from the background until the target ratio is met, falling back to pure black/white when the background makes it impossible
- Verification imports `GridsetValidator` from the aac-processors browser build via esm.sh

## Future

- Full in-place gridset preview with [aac-board-viewer](https://github.com/willwade/aac-board-viewer)
- Undo/history
- Style presets (e.g. high-contrast schemes)

Not affiliated with Smartbox. Always test edited gridsets in Grid 3 before distributing them to users.
