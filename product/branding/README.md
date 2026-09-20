# Branding Assets

OpenAgents (codex-desktop placeholder name) app icons. Layout aligned with
`grok-code-product/product/branding/` (D17 ruling, `00-FINDINGS.md` §7.3).

> **Placeholder art**: a solid indigo rounded square with a white ring. It is a
> deliberately generic placeholder that shares nothing with the Microsoft VS Code
> logo (LICENSE-CLEARANCE.md §1: the VS Code name/logo are not MIT-licensed).
> Replace `icon.svg` and regenerate to rebrand.

## Files

| File | Purpose |
|---|---|
| `icon.svg` | Source of truth (vector) |
| `icon_16x16.png` … `icon_1024x1024.png` | PNG rasters at standard sizes |
| `OpenAgents.icns` | macOS icon bundle (16–1024, incl. @2x) |
| `OpenAgents.ico` | Windows icon (16/32/48/256) |
| `open-agents.png` | 512×512 Linux icon (matches `product.linuxIconName`) |

## Where they land at package time

`resources/darwin/code.icns`, `resources/win32/code.ico` (+ `code_70x70.png`,
`code_150x150.png`), `resources/linux/code.png`. The copy step is owned by the
D09 packaging pipeline (the `apply-mixin` port of grok-code-product's
`apply-patches.sh` branding half); D06 ships the assets and the validation
(`scripts/apply-mixin.mjs --check` verifies they exist).

## Regenerating

D17 §4 ruled `grok-code-product/scripts/generate-icons.sh` is reused, not
rewritten. It is ported (issue #8 acceptance 10) as
`scripts/generate-icons.sh`: rsvg-convert rasterizes the SVG, `iconutil`
builds the `.icns` (macOS), and the `.ico` step uses ImageMagick when
installed and falls back to `python3` + Pillow otherwise (both hard-fail per
the D17 mixin ruling - the original script's silent `|| echo WARNING` skip is
deliberately removed). All committed rasters in this directory were generated
by running it:

```bash
brew install librsvg   # once; iconutil ships with macOS
bash scripts/generate-icons.sh
```

## Dev-mode limitation (D06 acceptance 7)

A `npm run launch` dev run boots the unpackaged Electron binary, so the Dock
shows Electron's own icon; `product/branding` only reaches the OS surfaces once
D09 packages an `.app`/bundle that references these assets. What D06 verifies:
the assets exist, are well-formed (`iconutil`/PIL round-trip), and the mixin
gate fails when they are missing.
