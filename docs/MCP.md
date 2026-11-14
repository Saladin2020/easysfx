# Easy SFX MCP server

```bash
npm run mcp            # stdio
npm run mcp:http       # Streamable HTTP → http://127.0.0.1:8829/mcp
EASYSFX_WORKSPACE=/path/to/workspace npx tsx src/mcp/server.ts
```

Cursor / Claude config:

```json
{ "mcpServers": { "easysfx": { "command": "npx", "args": ["tsx", "/path/to/easysfx/src/mcp/server.ts", "--workspace", "/path/to/workspace"] } } }
```

| Tool | What it does |
| --- | --- |
| `workspace_info` | banks, the default bank's sounds + tracks, presets, voices, parameter ranges, tracker cheat sheet — call first |
| `list_sounds` | sounds (preset, seed, variants, voice) and tracks (bpm, length, order) of a bank |
| `get_sound` | resolved params per variant + stats for a sound; definition + length for a track |
| `write_sound` | add/replace a sound: preset + seed (+ voice, variants), param overrides, optional `mutate`; `dryRun` validates only |
| `write_track` | add/replace a 1–4 channel track; refuses to save with errors (JSON path + message) |
| `render_audio` | render to `exports/renders/<id>.wav|ogg|mp3` + waveform PNG (returned as an image) |
| `export_bank` | `godot`, `pixi`, `wav`, `json` or `all` |

All paths stay inside the workspace (plus `EASYSFX_ALLOWED_DIRS`). Off-loopback HTTP needs the bearer token
printed at startup (or `EASYSFX_TOKEN`). Nothing calls a network or paid API.
