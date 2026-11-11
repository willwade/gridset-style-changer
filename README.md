# Gridset Style Changer

A browser-based tool for fixing common access issues in [Grid 3](https://www.smartboxassistivetechnology.com/products/grid-3/) gridsets (`.gridset`), including gridsets stored in `.grid3user` files: small text and low-contrast colours.

Private AACTools project.

## What it does

Upload a `.gridset` or a `.grid3user` file, then:

- **Common fixes**
  - *Increase font size* — bumps every style's font size by a delta; styles that never set one get base + delta
  - *Make higher contrast* — brings text/background contrast up to 4.5:1 (WCAG AA) or 7:1 (AAA), either by nudging the existing text colour or by forcing black-on-white / white-on-black
  - *Change styles throughout* — the same colour, transparency, font and size controls as the named-style tiles. Edits are staged until **Apply** is clicked; only edited fields change throughout the currently targeted styles. Colour swatches preserve each style's transparency; percentage edits preserve each style's RGB colour. Editing both applies both together.
  - The common tile shows values shared by the targeted styles; blank values indicate mixed or unset properties. Pending edits survive scope changes. The font-size fix refreshes the size field, and the contrast fix refreshes background, tile and text colours, replacing pending edits to those fields. Its preview is illustrative when values differ.
- Fixes apply to the named styles in `Settings0/Styles/styles.xml` and, optionally, to inline `<Style>` overrides inside every `Grids/*/grid.xml`
- **Include Default style** (checked by default) also targets `<Style Key="Default">` in `Settings0/Styles/styles.xml`, adding it if absent. Empty or missing properties normally use Grid 3's built-in defaults; contrast fixes write explicit default text/background colours when these are missing. Uncheck this to leave the Default style untouched by common fixes. Explicit cell overrides can still take precedence.
- For `.grid3user` files, the checkboxes under Common fixes select which gridsets receive bulk fixes. The separate dropdown under Named styles selects the gridset to edit individually; named-style edits affect only that gridset, regardless of the bulk-fix checkboxes
- **Per-style editor** — choose colours from a swatch matrix and set transparency independently for background, tile, border and text. Grid 3 colours use `#RRGGBBAA`: alpha is last (`00` transparent, `FF` opaque), not first. Changing a swatch preserves its existing alpha. Font family and font size also have a live preview and contrast/size badges
- **Verification** — before download, the modified gridset is run through the `GridsetValidator` from [`@willwade/aac-processors`](https://github.com/AACTools/AACProcessors-nodejs); issues are shown inline (advisory, not a gate)
- **Download** — a new `.gridset` or `.grid3user` is generated; the uploaded original is never modified

Everything runs client-side. Files never leave the browser.

Each colour control is one line: a swatch picker and transparency percentage (0–100%).
Hover over the percentage input for an explanation, or the swatch for the stored colour.
Selecting a colour closes the matrix. Swatches show RGB independently of transparency
so even fully transparent colours remain identifiable; previews still use transparency.
The common tile retains shared RGB and transparency independently after Apply, so
mixed transparency does not hide a colour applied throughout.
Font choices use dropdowns with a Custom font option in both Common fixes and individual styles.

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

## Tests

With a local static server running, open [the colour regression tests](tests/colours.html).
They check the real AAC-processors colour converters, alpha round-trips, compositing,
measured contrast targets, the colour matrix and transparency controls, high-contrast
edits to named and inline styles, and exported XML.

## How it works

- JSZip opens gridset archives and the outer `.grid3user` archive; only modified style and grid XML entries are replaced, preserving other archive entries
- XML is parsed/edited with the browser's native `DOMParser`/`XMLSerializer`
- Colour conversion uses the AAC-processors browser colour utilities, with `#RRGGBBAA` for reading and writing.
- Contrast maths follows WCAG 2.x relative luminance. Previews and contrast composite tile over background over a white canvas, then text over that result; inherited styles, images and actual grid backgrounds may change the final appearance.
- The "adjust text colour" mode searches lighter and darker HSL lightness values and writes opaque text to meet the target. Compliant text colours are retained; inherited colours may be made explicit to protect cells from simultaneous changes to base styles. When text alone cannot meet the target, it uses the better of black/white and explicitly reports how many styles still fall short. Black-on-white and white-on-black modes write opaque colours.
- Automatic contrast resolves `BasedOnStyle` and Default inheritance, including explicit cell overrides, and composites against each grid's `BackgroundColour`. If the resulting background is not known (for example, a transparent cell over an image or an unspecified grid background), it writes opaque background/tile colours and reports this rather than assuming the cell is safely black-on-white. All target appearances are captured before edits, so changing Default does not hide problems in later cells.
- Forced black-on-white and white-on-black modes always write both `BackColour` and `TileColour`, including for empty Default styles and cells without an existing background property.
- Verification imports `GridsetValidator` from the aac-processors browser build via esm.sh

## Future

- Full in-place gridset preview with [aac-board-viewer](https://github.com/willwade/aac-board-viewer)
- Undo/history
- Style presets (e.g. high-contrast schemes)

Not affiliated with Smartbox. Always test edited gridsets in Grid 3 before distributing them to users.
