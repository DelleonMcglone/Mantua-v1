# Task 069 — Voice (Phase 12, V-001 … V-011)

> Numbering follows the owner's master list of 2026-09-16
> (`docs/tasks/mantua-v1-task-list.md`), where Phase 12 is the voice layer.

**Branch:** `claude/admiring-tesla-4yvv4o`
**Prompt history:** `docs/promptHistory/2026-09-18-voice.md`

## Description

Give the Mantua command interface a microphone. A user holds a button,
speaks, and the words they said arrive in the command interface as text —
the same text they could have typed. ElevenLabs' Scribe v2 Realtime model
does the transcription, streaming partial results while the user is still
speaking.

The single design decision the whole phase rests on: **voice is an input
method, not a command path.** There is no voice parser, no voice intent
type, and no voice execution route. The microphone produces text; the text
enters the existing pipeline unchanged.

## Success criteria

1. The ElevenLabs API key lives only on the server. The browser receives a
   single-use token that expires in fifteen minutes and is consumed on
   first use, and nothing else. (V-001)
2. Holding the microphone button in the command bar records; releasing it
   stops. Transcribed text is submitted through the same function the Send
   button calls. (V-002)
3. Words appear while the user is still speaking, with provisional text
   visibly distinct from settled text. (V-003)
4. A spoken command reaches exactly the same parse and routing code as a
   typed one. No module under `client/src/features/voice/` imports a parse,
   confirm, sign or execute path, and a test asserts it. (V-004)
5. Trading, research, portfolio and market-discovery commands all work by
   voice, because all four already work from the command interface. (V-005)
6. Two kinds of correction are handled: the model revising its own partial
   transcript, and the speaker correcting themselves mid-sentence. (V-006)
7. A press too short to contain speech, or one that produces no committed
   transcript, submits nothing. (V-007)
8. A voice-originated request is subject to every agent permission,
   spending cap and mode policy a typed one is, because it is the same
   request. (V-008)
9. **A spoken utterance can never be the confirmation for a money action.**
   The server refuses to mint a confirmation from a voice-sourced message,
   so speaking the word "confirm" cannot execute anything. Confirmation
   stays a deliberate press. (V-009)
10. Every failure — permission refused, no microphone, token rejected,
    quota exhausted, a dropped socket, silence — leaves the user with a
    working text input and one plain sentence saying what happened. (V-010)
11. A browser test drives a scripted microphone through two journeys: a
    spoken research question that returns analysis, and a spoken trade that
    reaches the ticket and executes only after the Confirm press. (V-011)

## Failure conditions

- The API key, or any long-lived credential, reachable from the browser.
- A voice-specific execution, confirmation or parse path of any kind.
- A spoken word that causes a trade to execute without a press.
- Audio recorded to disk or to the database.
- The microphone capability granted more widely than the app's own origin.
- Voice failing in a way that leaves the user unable to type.
- A new client or server dependency for audio capture or transport.

## Edge cases

| Case                               | Behaviour                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Microphone permission denied       | One line, text input retains focus. Voice button shows unavailable until the page is reloaded.     |
| No input device                    | Same as denied; the button never enters the recording state.                                       |
| Deployment has no API key          | The token route answers 503; the button is not rendered at all.                                    |
| Token rejected by the socket       | "Voice isn't available right now." Falls back to typing.                                           |
| Press shorter than 350 ms          | Treated as a mis-press. Nothing submitted, no message.                                             |
| Press with no speech in it         | "I didn't catch that." Nothing submitted.                                                          |
| Socket drops mid-sentence          | Whatever was committed before the drop is kept and offered; the rest is lost and the user is told. |
| Model revises a partial transcript | Provisional text is replaced in place.                                                             |
| Speaker says "no, make that fifty" | The correction is applied to the pending text before submission, and the result is what gets sent. |
| Speaker says "confirm"             | Never mints a confirmation. The user is told to press Confirm.                                     |
| Quota exhausted                    | "The voice allowance is used up." Falls back to typing.                                            |
| Two presses overlapping            | The second press is ignored while the first session is closing.                                    |

## Implementation checklist

### Server

- [x] `ELEVENLABS_API_KEY` added to the env schema as an optional secret
      with a whitespace guard, documented with what its absence degrades to.
- [x] `server/src/lib/voice/scribe-token.ts` — the single-use token mint
      against a `fetch` seam, with every upstream failure mapped to one
      outcome and one sentence. Pure apart from the seam.
- [x] `server/src/lib/voice/scribe-token.test.ts` — the mapping, the
      missing-key case, a malformed body, and a transport fault.
- [x] `server/src/routes/voice-token.ts` — `POST /api/voice/token`, behind
      `requireAuth` and a dedicated per-user limiter, answering only the
      token, its expiry and the model id.
- [x] `server/src/routes/voice-token.test.ts` — including an assertion that
      the response body carries no other field.
- [x] Registered in `server/src/app.ts`.
- [x] `Permissions-Policy` changed from `microphone=()` to
      `microphone=(self)` in the API middleware and in `vercel.json`, with
      the pinning test updated.
- [x] `wss://api.elevenlabs.io` added to the CSP `connect-src`, in the
      policy module and in `vercel.json`.
- [x] The voice interlock in `buildTurnContext`: a voice-sourced message
      never mints a confirmation, and the model is told so in the turn
      prompt.
- [x] `source` threaded through the chat route and `runAgentChat`.

### Client

- [x] `voice-types.ts` — the transcript, session and failure shapes.
- [x] `transcript-core.ts` (+ test) — partial and committed accumulation,
      the model's own revisions, and the text a session finally yields.
- [x] `correction-core.ts` (+ test) — speaker self-corrections.
- [x] `activation-core.ts` (+ test) — the mis-press and no-speech rules.
- [x] `voice-status-core.ts` (+ test) — failure to sentence, and the
      "I didn't catch that" retry.
- [x] `confirm-guard.ts` (+ test) — the client half of V-009.
- [x] `press-outcome.ts` (+ test) — the single verdict for one finished
      press, composing the four rules above, plus the rule for when a
      release can be judged at once instead of waiting for the tail.
- [x] `voice-wire.ts` (+ test) — the socket's URL, its audio and commit
      messages, and the reading of every inbound frame.
- [x] `spoken-command.ts` — the payload that carries "this was spoken"
      from the command bar to the agent panel, tolerating the older
      plain-string form.
- [x] `voice-transport.ts` — microphone capture at 16 kHz and the
      WebSocket, behind an interface the tests replace; the failure
      mapping and the base64 encoding split into `transport-failures.ts`.
- [x] `client/public/voice/pcm-worklet.js` — the audio worklet that
      converts the browser's float frames to PCM 16. A static file served
      from our own origin, so `script-src 'self'` covers it without the
      `blob:` source a bundled worklet would have needed.
- [x] `use-voice-input.ts` — the hook binding the transport to the cores.
- [x] `MicButton.tsx` — the push-to-talk control.
- [x] `InputBar.tsx` — the button mounted, live text rendered.
- [x] `voice-audit.test.ts` — the static import audit for V-004/V-008/V-009.

### E2E and docs

- [x] `client/e2e/voice-transport-shim.ts` + the Vite alias, matching the
      authentication shim already used by the suite.
- [x] `client/e2e/voice.spec.ts` — the two journeys of V-011.
- [x] `client/src/features/voice/voice.e2e.test.ts` — the composed node
      test over the wire shapes.
- [x] `docs/architecture.md`, `README.md`, `docs/tasks/v2-roadmap.md`.
- [x] Lint, typecheck, both unit suites, the browser suite, the formatter.

## Notes

- **No new dependency.** The server mints the token with one `fetch`; the
  browser uses its own `WebSocket` and `AudioWorklet`. The ElevenLabs SDK
  was read to pin the wire contract but is not installed: its realtime
  client is documented Node-only, and the whole server need is a single
  POST.
- **The wire contract**, from the SDK's own types at version 2.68.0:
  `POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe` with
  an `xi-api-key` header returns `{"token": "…"}`; the socket is
  `wss://api.elevenlabs.io/v1/speech-to-text/realtime` with `model_id`,
  `audio_format`, `commit_strategy` and `token` as query parameters; audio
  goes up as `{"message_type":"input_audio_chunk","audio_base_64":…,
"commit":false,"sample_rate":16000}`; transcripts come back as
  `partial_transcript`, `final_transcript` and `committed_transcript`
  messages, and every failure as a `*_error`-shaped message with a
  `message_type` naming it.
- **Audio is never stored by Mantua.** It is streamed to the transcription
  service and discarded. Only the resulting text enters the command
  interface, exactly as typed text does.
