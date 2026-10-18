Headless still renders (needs Node 18+, `npm i playwright-core`, and a local Chrome/Chromium):

```bash
python3 -m http.server 8765 &      # from the repo root
node tools/render.mjs http://localhost:8765/ ./docs/renders
# optional: W=1920 H=1200 DPR=1 env vars, 3rd arg = comma-separated shot names
```
