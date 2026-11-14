# Grandma's Stories - textured button kit

## What's inside
- textured-buttons.css  - the button styles (shape, depth, hover/press, textures)
- textures/             - 8 seamless textures, each in three files:
    <name>-512.webp  standard screens
    <name>.webp      retina / high-DPI screens (1024px)
    <name>.jpg       fallback / design tools (Figma, Canva etc.)
  Textures: corduroy, shag, walnut, tweed, floral, leather, knit, linen

## Setup (3 steps)
1. Copy textured-buttons.css and the textures/ folder into your project, side by side.
   (If you put textures elsewhere, update the url("textures/...") paths in the CSS.)
2. Link the stylesheet in your page <head>:
     <link rel="stylesheet" href="textured-buttons.css">
3. Optional - load the heading font (falls back to Georgia if not loaded):
     <link href="https://fonts.googleapis.com/css2?family=Young+Serif&display=swap" rel="stylesheet">

## Using a button
Every button gets the base class `tx-btn` plus one texture class:
  <a class="tx-btn tx-corduroy" href="/start">Start <span class="tx-arrow">&#8594;</span></a>
  <a class="tx-btn tx-leather tx-soft tx-stitched" href="/album">Our family album</a>
  <a class="tx-btn tx-linen tx-soft" href="/archive">Connect to our family archive</a>
Works on <a> and <button> elements.

Texture classes: tx-corduroy, tx-shag, tx-walnut, tx-tweed, tx-floral, tx-leather, tx-knit, tx-linen
Modifiers:
  tx-soft      rounded-rectangle corners (default is a pill)
  tx-stitched  dashed sewn seam inside the edge

## Responsive behaviour
- Height, padding and font size scale automatically with screen width (CSS clamp).
- Textures tile at a fixed physical size, so ribs/weave stay realistic on every device.
- Set width yourself in your layout, e.g. full-width on mobile:
    .actions .tx-btn { width: 100%; }

## Customising
Override the variables on any button or variant:
  --tex-size   size of one texture tile (bigger = coarser ribs/weave)
  --tint       colour wash over the texture, e.g. rgba(0,0,0,.2) to darken
  --ink        label colour
  --edge       seam/outline colour
Example: .tx-corduroy { --tex-size: 120px; }  /* finer corduroy */

## Accessibility
- Keyboard focus ring is built in (gold outline).
- Hover lift is disabled for users with "reduce motion" turned on.
- Light textures (floral, knit, linen) use dark text; dark textures use cream text.
