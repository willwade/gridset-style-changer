# Guided style consolidation

Open [consolidate_stlyes.html](consolidate_stlyes.html) before optionally using the
[style changer](index.html). The filename intentionally follows the requested URL.
Both pages use the same stylesheet and run entirely in the browser.

## Goal and scope

Make cells with the same purpose consistently editable, without deliberately
changing their current appearance. A smaller style count is not the goal.
Optional empty/covered-cell cleanup relies on a user's visibility decision and
can change appearance if that assumption is wrong; it is not exact equivalence.
Structural cleanup and visual redesign are separate:

- **Consolidation:** review inheritance, name recurring variants, merge approved
  equivalent definitions, and prune recognised obsolete definitions.
- **Visual redesign:** choose fonts, sizes and palettes in the existing editor
  after downloading the consolidated file. This first version does not infer
  roles, automatically merge similar colours, or provide a role-based redesign UI.

Preserving current values does not preserve every future editing relationship.
All choices start unchecked; every step can be skipped. Applications are atomic,
and Undo restores the last application, including across gridsets.

Each list with two or more choices has an unchecked **Select all** checkbox that
selects or clears just that list, and shows a partial state after manual changes.
Step 2 has separate controls for exact restoration and appearance-dependent
cleanup, so selecting all exact matches never approves the riskier cleanup. In
Step 5, protected styles are informational and are never selected.

## Style hierarchy and constraints

Each gridset has an independent namespace in `Settings0/Styles/styles.xml`.
The working property-resolution model is:

1. Unresolved Grid 3 built-in or theme values.
2. The gridset's named `Default` style.
3. A named style selected by `BasedOnStyle`, including explicit base chains.
4. A cell's explicit `Content/Style` properties.

The engine resolves only stored values. It never substitutes AACProcessors'
style presets for Grid 3 runtime defaults. Missing and explicit values remain
distinct; `ThemeFont` stays symbolic.

Grid backgrounds, images, transparency, highlighting and special-content
rendering add context beyond this property hierarchy. `BackColour` and
`TileColour` are separate properties. Colours use `#RRGGBBAA`, alpha last.
No approximate colour, font or numeric comparison is used in this version.

User settings, including access/highlighting colours, are outside consolidation.
A `.grid3user` is reviewed one gridset at a time; export includes all gridsets.
The app supports nested `.gridset` entries and exploded gridset directories.

## Walkthrough

### 1. Capture a baseline and identify roles

Keep an original copy. Upload a `.gridset` or `.grid3user`, select a gridset and
inspect the named-style inventory, properties and explicit reference counts.
Decide which names represent the same purpose before considering a merge.

Useful roles include keyboard, prediction, history, quick phrases, message
banking, vocabulary categories, navigation, menus, workspace and auto-content.
Identical appearance does not establish identical purpose. The inventory is
informational; it does not automatically assign roles or rename existing styles.
Role decisions are expressed through variant names and approved merge groups.

### 2. Restore inheritance

Review local properties that exactly repeat their resolved inherited values.
Select only groups that should follow future edits to their bases.

Removing these properties preserves current stored effective values, but removes
explicit pins. Keep a pin if its independence is intentional.

Step 2 also offers separate, unchecked **appearance-dependent cleanup** groups:

- **Static empty cells:** remove differing local `FontName`, `FontSize` and
  `FontColour` only. Empty captions/images and no commands are required.
  Workspace, LiveCell, AutoContent, unknown content and command-bearing cells
  are excluded. Background, tile, border and shape formatting remains relevant
  even without content and is retained.
- **Potentially covered cells:** remove differing local formatting only when the
  complete cell rectangle fits inside another spanning cell with a different
  origin. Missing X/Y default to zero and spans default to one. Invalid geometry,
  partial overlaps and duplicate origins do not establish coverage. This is a
  geometric suggestion, not proof of z-order, opacity or actual invisibility.
  Review the listed covering cell and confirm the result in Grid 3.

Checking these groups explicitly acknowledges that effective properties change,
text may appear later and covered cells may be revealed. Named base references
remain; cells, commands and content are never deleted. Default-based overrides
are eligible under these same rules, but a bare Default reference is retained.
No visual-equivalence claim is made for differing colours, transparency or fonts.

The verifier records exact approved replacement values (including unset values)
per grid/style position and property. These approvals survive subsequent steps,
undo snapshots and export verification. Unapproved properties, other cells,
surviving named styles and all non-style content remain strictly checked.

### 3. Name repeated variants

Review groups with the same base and identical local formatting, occurring at
least twice. Give deliberate variants meaningful names. Restore inheritance
first so redundant properties do not create unnecessary variants.

Each selected group becomes a new named style, and its cells become references
to that style. The new definition combines the explicit base-chain properties
and local overrides, but does not materialise missing Default or built-in values.
It introduces no named-to-named inheritance. This keeps it independent of future
edits to its former named base, while missing values continue to inherit Default.
The UI warns about that change in editing relationships.

The first version creates a distinct new variant, rather than silently choosing
an existing equivalent style. Reuse is a separate, explicit merge decision.

### 4. Review equivalent named styles

Candidates have equal resolved stored properties, excluding `Name` and
`BasedOnStyle` metadata. Compare the original definitions and explicit pins.
Choose a canonical retained style only if the entire group should share future
editing. Otherwise keep the group separate. Default must be retained when it
belongs to a group.

Merges rewrite explicit references, not unrelated text. Protected styles are not
offered as removable merge sources. A merge that creates a cycle, changes a
surviving definition or alters effective cell values is rejected.

### 5. Review exceptions and prune last

Remaining local styles may be legitimate one-offs. Keep them unless a recurring
variant or shared role is appropriate. Revisit earlier steps if necessary.

Only unreferenced, unprotected definitions can be selected for pruning.
Conventional Default, Workspace, Auto content, Auto content cell, Vocab cell,
Keyboard key and category-style keys are protected. Keys mentioned in other
XML text/attributes or references outside grid/style documents are also protected.
The protection list is conservative, not a complete Grid 3 implicit-use schema.
Recognise the definition as obsolete before deleting it.

### 6. Verify and export

Export checks every gridset against its original baseline, then reopens the
generated archive and checks the serialised output again:

- All explicit grid-style effective property sets are unchanged except the exact
  replacement values explicitly approved in Step 2's empty/covered-cell groups.
- Cells without Style still have the same Default-derived property set.
- Surviving named definitions have the same effective properties.
- Non-style grid content and other gridset XML remain unchanged.
- Missing references, duplicate keys, unsupported structured/repeated/attributed
  or foreign-namespace properties, styles outside cell Content and inheritance
  cycles block consolidation rather than guessing their meaning.

Only dirty XML entries are replaced. Other archive entries and user settings
are retained. The original upload is not modified.

AACProcessors' `GridsetValidator` additionally runs on each output gridset.
Its structural results are advisory and shown explicitly, including dependency
failures or a 30-second deadline; they do not substitute for the mandatory equivalence checks.
It is not an exhaustive renderer or style-graph verifier.

Download the consolidated file, open the style changer using the provided link,
and upload that result. There is no automatic cross-page file transfer or storage.
Check representative grids in Grid 3, especially transparent cells, image
backgrounds, ThemeFont, workspace, prediction and auto-content cells.
Test a canonical-style edit: intended cells should follow, unrelated roles should
not. A repeat review should not propose the exact transformations already applied;
new suggestions can legitimately arise from earlier consolidation decisions.

## Example-driven priorities

These counts describe the supplied examples at analysis time, not fixed targets.

| Metric | Text Talker | Super Core 30 |
|---|---:|---:|
| Grids | 38 | 560 |
| Cells | 2,550 | 18,500 |
| Named styles, including Default | 38 | 194 |
| Unreferenced named candidates | 17 | 4 |
| Cells with local overrides | 902 | 1,274 |
| Local property assignments | 1,408 | 1,751 |
| Assignments equal to inherited values | 225 | 185 |

### Text Talker

1. Review unused definitions, but protect conventional special-purpose keys.
2. Restore redundant keyboard tile-colour inheritance where intended.
3. Name recurring Chat History dark-tile and Prediction small-text variants.
4. Keep Quick Phrases and Message Banking independently editable unless a user
   explicitly wants them linked, even when their definitions match.
5. Optionally review similar dark colours and typography later in the editor.

After redundant properties are removed, 208 cells share a Chat History dark-tile
variant. The 67 Prediction size-12 cells are another candidate. Changing the
original base instead would affect cells that deliberately retain its appearance.

### Super Core 30

1. Preserve the heavily used semantic category style library.
2. Name the 546-cell Auto content blue-border variant and the 110-cell ACTIONS
   size-32 variant if those groups should be centrally editable.
3. Restore matching LITTLE WORD border assignments where appropriate.
4. Review the few duplicates and Default copies; do not automatically couple
   ACTIONS-moving with DESCRIBE-looks merely because they currently match.
5. Preserve category colour distinctions and symbolic ThemeFont values.

The earlier user archive illustrates the same distinction: repeated local
formatting can be a bigger opportunity than named-style count. In its Control
gridset, 775 cells repeat transparent background/border, black text, Roboto and
size 12 over an empty Default. Promoting that explicit formatting is justified;
simply deleting it is not.

## AAC Tools boundary

Reusable domain code is isolated from page controls:

- [js/consolidation.js](js/consolidation.js): analysis, reference indexing,
  inheritance resolution, protected-style policy, baseline checks and atomic
  transformations. It uses DOM documents and context objects, with no network,
  UI, browser storage or download behaviour.
- [js/archives.js](js/archives.js): shared gridset/user archive loading and selective
  writing, used by both pages rather than duplicating user-file handling.
- [js/consolidate-app.js](js/consolidate-app.js): wizard decisions, session undo,
  display, validation orchestration and downloads only.

These are migration candidates for AACProcessors, not a second general AAC
processing library. The current library has colour/style construction utilities,
cell classification and structural validation, but no inspected consolidation API.
Before moving the engine, agree typed context/action/result contracts, replace
the browser DOM adapter with the library's XML facilities, move protection policy
and tests together, and expose browser-safe exports. Archive adapters should use
the library's ZIP and IO abstractions instead of global JSZip.

Do not implement consolidation by round-tripping through generic
`GridsetProcessor.loadIntoTree()` / `saveFromTree()`: generic styles do not preserve
every Grid 3 field or the distinction between background and tile colours, and
the save path regenerates other content.

## Tests

Run a local static server and open [tests/consolidation.html](tests/consolidation.html)
and the existing [colour regression tests](tests/colours.html).
No build step or additional production dependency is required.
