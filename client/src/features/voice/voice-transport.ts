/**
 * Task 069 (V-001, V-002) — the real microphone and the real socket.
 *
 * This is the only file in the feature that touches a browser device API
 * or the outside world, which is why the wire format, the transcript
 * assembly and every decision about what to do with the words live
 * elsewhere in tested modules. The browser suite replaces this module
 * wholesale (see client/e2e/voice-transport-shim.ts), so nothing here runs
 * under test and nothing here decides anything.
 *
 * Order matters: the microphone is asked for **before** a token is minted,
 * so a user who declines never spends one.
 */
import { api } from "@/lib/api.ts";
import {
  audioChunkMessage,
  commitMessage,
  readWireMessage,
  SAMPLE_RATE,
  socketUrl,
  WORKLET_URL,
} from "./voice-wire.ts";
import { failureForApiError, failureForMediaError, toBase64 } from "./transport-failures.ts";
import type { VoiceSessionHandle, VoiceTransport, VoiceTransportEvents } from "./voice-types.ts";

interface TokenRead {
  token: string;
  expiresAt: number;
  modelId: string;
}

export const voiceTransport: VoiceTransport = {
  supported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.AudioContext === "function" &&
      typeof window.WebSocket === "function" &&
      typeof (navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia === "function"
    );
  },

  async start(events: VoiceTransportEvents): Promise<VoiceSessionHandle> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      events.onFailure(failureForMediaError(err));
      return { stop: () => undefined, cancel: () => undefined };
    }

    const teardown: (() => void)[] = [
      () => {
        for (const track of stream.getTracks()) track.stop();
      },
    ];
    const close = () => {
      while (teardown.length > 0) teardown.pop()?.();
    };

    let read: TokenRead;
    try {
      read = await api.post<TokenRead>("/api/voice/token", {});
    } catch (err) {
      close();
      events.onFailure(failureForApiError(err));
      return { stop: () => undefined, cancel: () => undefined };
    }

    let socket: WebSocket;
    try {
      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      teardown.push(() => void context.close());
      // Task 071 (MX-005) — iOS creates the context suspended when the
      // gesture that started the press has already returned; resume it.
      if (context.state === "suspended") await context.resume().catch(() => undefined);
      await context.audioWorklet.addModule(WORKLET_URL);

      socket = new WebSocket(socketUrl({ token: read.token, modelId: read.modelId }));
      teardown.push(() => {
        if (socket.readyState === WebSocket.OPEN) socket.close();
      });

      const node = new AudioWorkletNode(context, "mantua-pcm");
      context.createMediaStreamSource(stream).connect(node);
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(audioChunkMessage(toBase64(event.data)));
      };
      teardown.push(() => {
        node.port.onmessage = null;
        node.disconnect();
      });
    } catch {
      close();
      events.onFailure("unavailable");
      return { stop: () => undefined, cancel: () => undefined };
    }

    let finished = false;
    socket.onmessage = (event: MessageEvent<string>) => {
      const wire = readWireMessage(typeof event.data === "string" ? event.data : "");
      if (wire.kind === "open") events.onOpen();
      else if (wire.kind === "partial") events.onPartial(wire.text);
      else if (wire.kind === "committed") events.onCommitted(wire.text);
      else if (wire.kind === "failure") {
        finished = true;
        events.onFailure(wire.failure);
        close();
      }
    };
    socket.onerror = () => {
      if (finished) return;
      finished = true;
      events.onFailure("unavailable");
      close();
    };
    socket.onclose = () => {
      if (finished) return;
      finished = true;
      events.onFailure("dropped");
      close();
    };

    return {
      stop: () => {
        if (finished) return;
        finished = true;
        // Flush the tail, give the server a moment to answer, then close.
        if (socket.readyState === WebSocket.OPEN) socket.send(commitMessage());
        for (const track of stream.getTracks()) track.stop();
        window.setTimeout(close, 1_200);
      },
      cancel: () => {
        finished = true;
        close();
      },
    };
  },
};
