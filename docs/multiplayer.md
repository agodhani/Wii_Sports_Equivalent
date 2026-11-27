# Online singles

Choose **Play Multiplayer**, copy the room's invite link, and send it to one
friend. Open the link in a second browser and choose camera or mouse/touch on
each side. Each player sees their own avatar and score first. The host scores
the match using the same first-to-seven rules as CPU play. No webcam video or
pose landmarks are sent to the peer or signaling server.

If the connection drops, the match pauses. The open tabs try to reconnect; if
the peer is still unavailable after eight seconds, the match ends and returns
to the home screen. Reloading or closing either tab does not preserve a match.

## Running and deploying

- `npm run dev` or `npm run build && npm run preview` serves the app and its
  WebSocket signaling endpoint (`/tennis-signal`). Use the same app URL on both
  devices; remote players need a reachable HTTPS URL. Localhost works for
  local testing.
- For a static deployment, run `npm run signaling` (port 5300 by default,
  configurable via `PORT`). Route `/tennis-signal` to it through a TLS/Upgrade
  proxy on the app origin, or set `VITE_SIGNAL_URL` to its full public
  `wss://…/tennis-signal` URL. Room membership is in memory, so route both
  peers' signaling to the same instance.
- STUN defaults to `stun:stun.l.google.com:19302`; set `VITE_STUN_URL` to
  replace it. For players whose networks cannot connect directly, optionally
  configure `VITE_TURN_URL` (comma-separated TURN URLs), `VITE_TURN_USERNAME`,
  and `VITE_TURN_CREDENTIAL`. These Vite values are included in the client
  build: use browser-safe, restricted credentials, never a TURN admin secret.
  Rebuild after changing `VITE_*` settings. TURN is optional.

The WebSocket server matches the two room members and relays WebRTC setup.
If the data channel fails or cannot open within five seconds, the room switches
to relaying gameplay over the signaling WebSocket, including after reconnects.
The game labels the connection **Direct** (WebRTC, including optional TURN) or
**Relayed** (signaling WebSocket). The host still owns ball physics, scoring,
and phase changes, and camera data is never sent.

Each instance holds up to 128 two-player rooms. Rooms expire two hours after
creation, even if both players are still connected. The relay accepts up to
4 KiB per message and 60 messages per second per player (120 per room), with a
60-message burst per player. Messages over the limits or sent to a backed-up
connection are dropped. Serve the app and signaling over HTTPS/WSS for remote
play.
