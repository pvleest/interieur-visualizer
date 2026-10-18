# Interieur-visualizer

A small, data-driven **3D interior design visualizer** built with [Three.js](https://threejs.org/).
A floor plan (rooms, walls, door and window openings) and the furniture and fixtures are described in one JSON file. The page renders it as an interactive 3D "dollhouse" in the browser. It is a static site: no build step and no server code. Three.js is vendored in `vendor/`.

**Live demo:** https://pvleest.github.io/interieur-visualizer/

The demo plan (`plans/vleugel.json`) is an interior design concept for a kitchen, a garage, and a new extension with a utility room (*bijkeuken*) and a bedroom. All dimensions are indicative.

![Overview](docs/renders/01-overzicht.png)

| Keuken | Garage |
|---|---|
| ![](docs/renders/02-keuken.png) | ![](docs/renders/03-garage.png) |
| **Bijkeuken** | **Slaapkamer** |
| ![](docs/renders/04-bijkeuken.png) | ![](docs/renders/05-slaapkamer.png) |

## Features

- Orbit **dollhouse view** with the ceilings off. Walls between the camera and the focus point are cut away automatically (toggle *Wanden: auto / laag / hoog*).
- **Preset cameras** per room and a top-down **plan view**, all defined in the config.
- **First-person walk mode** (*Rondlopen*): drag to look and use WASD or the arrow keys, or the on-screen pad on a phone. Simple collision keeps you inside the rooms and doorways, and the ceilings are shown.
- **Clickable labels** and objects show a details panel with the dimensions (w × d × h). Hovering shows a tooltip.
- A side panel lists the design choices per room and a table of room and element dimensions.
- Procedural materials (oak, warm greige matte fronts, composite worktop, poured concrete floor, epoxy, tiles, linen) with soft shadows and image-based lighting.
- Responsive layout: on a phone the panel becomes a bottom sheet.
- Headless render mode for high-quality stills: `?ui=0&view=keuken&labels=0&dpr=1`.

## URL parameters

| Param | Example | Meaning |
|---|---|---|
| `plan` | `plans/vleugel.json` | Plan file to load (relative URL). |
| `view` | `keuken`, `overzicht`, `walk` | Initial camera view (`walk` with `room=<id>`). |
| `ui` | `0` | Hide all UI (for renders). Sets `window.__ready = true` once rendered. |
| `labels` | `0` | Start with labels hidden. |
| `labelroom` | `*` | Show item labels for all rooms (default: only the room in focus). |
| `dpr` | `2` | Force a device pixel ratio. |

## Config format (`plans/*.json`)

All units are **centimetres**. The plan uses a 2D coordinate system `[x, z]`: x points right (east), and z points "down" on the drawing (south). Height (y) is measured from the floor.

```jsonc
{
  "meta": { "title": "…", "subtitle": "…", "style": "free text shown in the panel" },
  "defaults": { "wallThickness": 20, "wallHeight": 260, "ceilingHeight": 260, "floor": "concrete" },

  "rooms": [{
    "id": "keuken", "name": "Keuken",
    "polygon": [[120,341],[601,341],[601,640],[120,640]],   // interior outline
    "floor": "oak",               // oak | concrete | epoxy | tile | any material name / #hex
    "ceilingHeight": 260,
    "dims": "481 × 299 cm",       // optional display text (default: bounding box)
    "lights": [{ "pos": [360,470], "intensity": 4 }],        // optional ceiling lights
    "notes": ["design choice 1", "…"]                        // shown in the "Ontwerp" tab
  }],

  "walls": [{
    "id": "garage-keuken",
    "from": [-30,326], "to": [910,326],      // centre line
    "thickness": 30, "height": 260,
    "openings": [
      // offset = distance along the wall from `from` to the start of the opening
      { "type": "door",   "offset": 220, "width": 90,  "height": 211, "swing": 1, "hinge": "start", "open": 85 },
      { "type": "window", "offset": 45,  "width": 90,  "sill": 100, "height": 100, "panes": 1, "sillSide": -1 },
      { "type": "slider", "offset": 498, "width": 230, "height": 230 },
      { "type": "glassdoor", "offset": 250, "width": 100, "height": 215 },
      { "type": "garage", "offset": 85, "width": 230, "height": 215 }
    ]
  }],

  "context": [{ "polygon": [[…]], "material": "#d6d3cc", "label": "Woonkamer (bestaand)" }],

  "items": [{
    "type": "fridge",            // see the item types below
    "room": "keuken",            // used for labels and the panel
    "pos": [150,375],            // centre of the footprint
    "rot": 90,                   // degrees around the vertical axis; 0 = front faces +z (south)
    "elev": 0,                   // bottom height above the floor
    "size": [60,60,250],         // width (local x), depth (local z), height
    "material": "oak",           // front / main material
    "label": "Koelkast",         // optional clickable label
    "note": "Shown in the details panel",
    "attachTo": "aanbouw-gevel"  // optional: hide together with that wall's windows when it is cut away
  }],

  "views": {
    "overzicht": { "label": "Overzicht", "pos": [880,1080,1180], "target": [40,0,250] },
    "keuken": { "label": "Keuken", "pos": [470,560,1010], "target": [370,70,470],
                "walk": { "pos": [430,610], "yaw": 25 } },          // yaw 0 = looking north (−z), 90 = west
    "plattegrond": { "label": "Plattegrond", "pos": [60,1900,420], "target": [60,0,330], "labels": "*" }
  }
}
```

Wall normal: for a wall from `from` to `to`, `swing: 1` opens a door towards the left-hand side when you walk from `from` to `to` (normal `(-dz, dx)`). `hinge` is `start` or `end`.

### Item types

| Type | Notes / extra fields |
|---|---|
| `base` | Base cabinet with a recessed plinth and a black handle profile (gola). `doors` or `drawers` (+ `cols`). |
| `tall`, `wardrobe` | Tall cabinet. `rows: [{h, cols}]` from bottom to top (a row without `h` fills the remaining height). |
| `wall` | Wall cabinet. `doors`. |
| `fridge`, `freezer`, `ovenColumn`, `dishwasher` | Integrated appliance columns with matching fronts. |
| `worktop`, `panel`, `plinth` | Slabs: worktop (composite by default), backsplash or any panel, raised plinth with a drawer. |
| `sink`, `hob`, `hood` | Placed with `elev` = worktop height. |
| `washer`, `dryer` | Front-loader appliances. |
| `basketDrawers` | Three laundry-basket drawers with labels (`labels: [[text, colour], …]`). |
| `ironingCabinet` | Tall cabinet with an open door and a fold-out ironing board. |
| `openShelf` | Open shelving with crates (`shelves`, `crates: false`). |
| `workbench` | Drawer base, butcher-block top, pegboard with tools, upper cabinet with LED. |
| `bed`, `nightstand`, `wallLight`, `pendant`, `rug`, `curtain`, `slatPanel`, `rail`, `table`, `chair`, `plant` | Furniture and decoration. |
| `ledStrip` | Emissive strip (`size: [length, width]`). |
| `walkway` | Translucent floor marking: `polygon` in absolute coordinates, with `pos: [0,0]`. |

**Materials:** `oak`, `oakDark`, `greige`, `greigeLight`, `black`, `composite`, `tile`, `steel`, `linen`, `curtain`, `rug`, `pegboard`, `concrete`, `epoxy`, or any `#rrggbb`.

Adding a builder means adding a function to `BUILDERS` in `js/items.js`. It returns a `THREE.Group` in centimetres, with its origin at the centre of the footprint on the floor and the front facing +z.

### Workflow for a new design

1. Read the room sizes and openings from the floor plan, and write `rooms` and `walls`.
2. Place `items` per room; the "Maten" tab and the plan view help you check that everything fits.
3. Add `views` per room, open `index.html?plan=plans/<file>.json`, and adjust the views.
4. Optional: export stills with the headless render script (see `tools/render.mjs`, which uses Playwright with Chromium).

## Local development

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

---

## Nederlandse samenvatting

Een eenvoudige, data-gedreven **3D-interieurvisualizer** die in de browser draait. De plattegrond staat in één JSON-bestand in `plans/`: ruimtes, wanden met deuren en ramen, vloeren, en een lijst kasten, apparaten en meubels met positie, maat, draaiing en materiaal.

- **Overzicht**: een poppenhuisweergave van de hele vleugel, waarbij de wanden die in de weg staan automatisch omlaag gaan.
- **Plattegrond**: een bovenaanzicht met alle labels.
- **Keuken, Garage, Bijkeuken, Slaapkamer**: een vaste camera per ruimte.
- **Rondlopen**: slepen om rond te kijken, en W, A, S, D, de pijltjes of de knoppen op je telefoon om te lopen.
- Klik op een element of label voor de maten en een toelichting. In het paneel staan de ontwerpkeuzes per ruimte en een maattabel.

Voor een nieuw ontwerp kopieer je `plans/vleugel.json`, pas je de maten en de inrichting aan, en open je `index.html?plan=plans/<nieuw>.json`.

*Dit is een conceptvisualisatie: de maten zijn indicatief en moeten vóór bestellen of verbouwen worden gecontroleerd.*
