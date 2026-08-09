# Future Requirements — Webcam Tennis

Status: draft, unscoped. Each section below is a candidate feature, not a
committed plan — none of this has been through brainstorming/spec/plan yet.
Written to capture what's been discussed so a real spec can start from here
instead of a blank page.

## Current state (for context)

Single-player only. The player swings at a ball whose hit/miss and aim are
resolved abstractly: `src/game/hit.ts`'s `resolveHit()` checks whether a
swing landed inside a ±0.15s timing window around the ball's arrival, and
computes the return shot from swing timing/direction/speed — there is no
physical collision between a racket mesh and the ball. The racket rendered
in `src/render/scene.ts` (`setArm`) is cosmetic: it shows where your arm is
tracked, but doesn't participate in hit detection. CPU difficulty (easy/hard)
was just added, selected from a new home screen (`Hud.showHome`).

---

## 1. Racket-relative hit detection

**Problem.** Hits currently resolve on *when* you swing, not *where* your
racket actually was relative to the ball. A well-timed swing that's aimed
nowhere near the ball's flight path still counts as a hit.

**Proposal.** Test whether the ball's court-space position falls within a
small volume around the racket head (`racketHead` in `scene.ts`) at the
moment of closest approach, instead of (or in addition to) the timing
window. This is a meaningfully different game: it rewards *positioning*
the racket, not just timing the swing, which is closer to real tennis and
to what a physical racket prop would feel like.

**Open questions worth resolving before a spec:**
- Full replacement of `resolveHit`, or a hybrid (timing window gates *when*
  a hit can occur; racket proximity decides *if* one does)?
- Racket-head position is derived from pose tracking, which has real noise —
  how forgiving does the hit volume need to be to not feel unfair given that
  noise, especially at the tracking quality established in the last tuning
  pass (`src/swing/detector.ts`, `src/tracking/pose.ts`)?
- Does this replace `side`/`direction` shot-aiming logic, or does aim now
  come from the racket's velocity vector at contact (closer to real physics,
  more work)?

**Dependencies.** None blocking — this only touches `hit.ts` and the contact
logic in `src/main.ts`'s rally block. Good candidate for a standalone
prototype before committing to it as the primary hit model.

---

## 2. Multiplayer (two players, one each side)

**Problem.** Only a CPU opponent exists today.

**Proposal.** Peer-to-peer over WebRTC data channels — see
`docs/notes/2026-08-07-latency-and-shipping.md` Part 3 for the fuller
architecture comparison against an authoritative server. Recommendation
stands: peer-to-peer, with a TURN server as NAT-traversal fallback.

**What changes in the codebase:**
- `src/game/match.ts` and `src/game/cpu.ts` — the CPU opponent's role
  (`cpuReturn`, reach/error modeling) is replaced by a second real player's
  swing events arriving over the network instead of being computed locally.
- Need a strategy for **ball-position agreement** between two players with
  different network latency: does one peer own ball physics as the source
  of truth (host-authoritative) and broadcast state, or does each peer
  simulate independently and reconcile (lockstep / rollback)? This is the
  central multiplayer design question and needs its own brainstorming pass.
- The home screen's "Play Multiplayer" button (`src/render/hud.ts`,
  `#home-multi`) already exists as a disabled placeholder — wiring it up is
  the visible finish line for this feature.

**Open questions:**
- Matchmaking: direct link/room-code sharing (simplest, fits the "no
  install" philosophy) vs. any kind of lobby/discovery?
- What happens to a match if one player's connection drops mid-rally — does
  it pause like tracking-loss does today, or end the match?

---

## 3. Doubles

Two distinct modes hide under "doubles." They have very different scope, so
they're split rather than treated as one feature.

### 3a. Doubles, Wii Tennis-style (one player controls both avatars on their side)

**Problem.** A team of two on-screen characters, but still one human, one
webcam, one tracked swing — the way Wii Tennis doubles actually works: your
Mii and your partner Mii both stand on your side, the game auto-positions
both, and whichever one is nearest the ball swings when you swing.

**Proposal.** This is a **local single-player feature, not a networking
feature** — it doesn't depend on (2) at all, and could ship before
multiplayer exists (e.g. player-plus-partner vs. a CPU pair). It extends
what already exists rather than requiring new tracking or new avatars from
new humans:
- A second avatar on the player's side in `src/render/scene.ts` alongside
  the existing `player` mesh, auto-positioned the same way `playerX`
  already auto-runs toward the ball today (`src/main.ts`'s rally block) —
  now splitting court coverage between two avatars instead of centering one.
- At contact time, the single `SwingEvent` from the one tracked player
  applies to whichever avatar is currently nearest the ball — the same
  "is this swing in range" logic `resolveHit`/the contact-window check
  already does, just arbitrating between two positions instead of one.
- The CPU side could symmetrically get a second `cpuReturn`-controlled
  avatar, so single-player-vs-CPU can be doubles too, independent of
  multiplayer ever landing.

**Open question.** Coverage logic: split the court in half and give each
avatar a fixed zone, or always send the nearer avatar and let positioning
emerge from play? The latter feels more like real doubles but needs the
same kind of tuning pass swing detection just went through.

### 3b. Four-player doubles (each of four humans controls one avatar) — lowest priority

**Problem.** The full 2v2 version: four separate people, four webcams, four
tracked swings.

**Proposal.** Depends on (2) — this is multiplayer networking extended to
four participants, plus 3a's court-coverage concept but with each avatar
driven by its own remote player instead of one player's swing arbitrating
between two. Meaningfully bigger scope than everything else in this
document: 4 camera feeds, 4 pose trackers, 4 swing detectors, and a
4-peer networking topology instead of 2. Build only after (2) works
end-to-end and 3a has proven the two-avatars-per-side rendering and
coverage logic locally.

**Open question.** Four separate devices (most likely, one per person), or
could two people ever share one webcam frame? The latter needs `numPoses`
in `src/tracking/pose.ts` raised above 1 and per-player landmark
disambiguation — a materially harder tracking problem, and not necessary
for the common case of four people on four laptops.

---

## 4. Lower latency / higher frame rate

**Problem.** Covered in detail in
`docs/notes/2026-08-07-latency-and-shipping.md` Part 1 — pose inference
currently runs synchronously inside the render loop (`src/main.ts`'s
`step()` calls `tracker.process()` every frame), so a slow inference pass
directly stalls rendering rather than just lowering effective FPS.

**Proposal.** Decouple pose inference from the render loop — run it on its
own timer or in a Web Worker, with the render loop always reading the
latest available `PoseFrame` rather than waiting on a fresh one. This was
flagged as the single highest-leverage latency fix in the last review round
and is worth doing regardless of whether multiplayer happens, since
multiplayer will make latency budget even tighter (network round-trip stacks
on top of local inference latency).

**Open question.** Web Worker inference needs `OffscreenCanvas`/transferable
video frames — worth a quick spike to confirm MediaPipe's WASM+GPU delegate
works inside a worker in the target browsers before committing to the
approach.

---

## Suggested sequencing

Roughly in order of what unblocks the most other work:

1. **Lower latency** (§4) — improves every other mode, including CPU play,
   and de-risks multiplayer's latency budget before network latency stacks
   on top.
2. **Racket-relative hit detection** (§1) — standalone, improves single
   player regardless of what else ships, good next prototype.
3. **Doubles, Wii Tennis-style** (§3a) — also standalone and local-only; can
   land any time after (1)/(2), independent of whether multiplayer exists yet.
4. **Multiplayer, singles** (§2) — the real architecture decision (host-
   authoritative vs. lockstep) needs its own brainstorming session before
   any code.
5. **Four-player doubles** (§3b) — lowest priority. Depends on both (4) and
   the coverage logic proven in (3a); the largest scope item in this
   document, so it's last regardless of how the rest of the order shifts.

Each of these should go through a normal brainstorm → spec → plan cycle
before implementation, same as the original game build
(`docs/superpowers/specs/2026-08-06-webcam-tennis-design.md`,
`docs/superpowers/plans/2026-08-06-webcam-tennis.md`).
