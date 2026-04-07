# Gossamer frontend

Vite + React + Cytoscape graph of `/api/graph`.

- **Design contract:** node/edge colors and labels should align with **`GET /api/graph-type-registry`** from the backend (see [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)).
- **Dev:** `npm install` then `npm run dev` (proxies `/api` to `http://127.0.0.1:8000` — start the backend first).
- **Production build:** `npm run build` → static assets in `dist/`.

For agent-oriented repo rules see [../AGENTS.md](../AGENTS.md).
