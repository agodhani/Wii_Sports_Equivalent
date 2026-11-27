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
  Rebuild after changing `VITE_*` settings. Some networks will not connect
  without TURN.

The WebSocket server only matches the two room members and relays WebRTC setup.
After connection, swing inputs and match snapshots travel over the peer data
channel; the host owns ball physics, scoring, and phase changes.
