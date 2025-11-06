import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SharedRingBuffer } from "../audio/ringBuffer";
import type { ChordSpec, Policy, ResultEvent } from "../types/audio";

export type UseChordVerifierOpts = {
  expected: ChordSpec;
  policy?: Policy;
  windowSec?: number;
  tickMs?: number;
  tailMs?: number;
  centsTol?: number;
  framesConfirm?: number;
  transposeSemitones?: number;
  a4Hz?: number;
  minF0Hz?: number;
  maxF0Hz?: number;
  onResult?: (event: ResultEvent) => void;
};

export default function useChordVerifier({
  expected,
  policy = "K_OF_N",
  windowSec = 1.3,
  tickMs = 40,
  tailMs = 120,
  centsTol = 50,
  framesConfirm = 3,
  transposeSemitones = 0,
  a4Hz = 440,
  minF0Hz = 82.41,
  maxF0Hz = 1318.51,
  onResult,
}: UseChordVerifierOpts) {
  const [status, setStatus] = useState<
    "idle" | "loading" | "listening" | "error"
  >("idle");
  const acRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ringBufferRef = useRef<ReturnType<typeof SharedRingBuffer.create> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recorderWorkletURL = useMemo(
    () => new URL("../audio/worklets/inputProcessor.ts", import.meta.url),
    []
  );

  const workerURL = useMemo(
    () => new URL("../workers/chordWorker.ts", import.meta.url),
    []
  );

  const cleanup = useCallback(() => {
    workerRef.current?.postMessage({ type: "STOP" });
    workerRef.current?.terminate();
    workerRef.current = null;
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    acRef.current?.close();
    acRef.current = null;
    ringBufferRef.current = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    try {
      setErrorMessage(null);
      setStatus("loading");
      const audioContext = new AudioContext({ latencyHint: "interactive" });
      acRef.current = audioContext;
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
      });
      mediaStreamRef.current = mediaStream;
      const sourceNode = audioContext.createMediaStreamSource(mediaStream);
      sourceNodeRef.current = sourceNode;

      const ringBuffer = SharedRingBuffer.create(
        Math.ceil((windowSec + 0.5) * audioContext.sampleRate)
      );
      ringBufferRef.current = ringBuffer;

      await audioContext.audioWorklet.addModule(recorderWorkletURL.href);
      const workletNode = new AudioWorkletNode(audioContext, "recorder-worklet");
      workletNodeRef.current = workletNode;
      workletNode.port.postMessage({ sab: ringBuffer.sab });
      sourceNode.connect(workletNode).connect(audioContext.destination);

      const worker = new Worker(workerURL, { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<ResultEvent>) => {
        onResult?.(event.data);
        if (event.data.type === "ERROR") {
          setErrorMessage(event.data.message);
          setStatus("error");
        }
      };

      worker.postMessage({
        type: "INIT",
        payload: {
          sab: ringBuffer.sab,
          sampleRate: audioContext.sampleRate,
          windowSec,
          tailMs,
          tickMs,
          a4Hz,
          minF0Hz,
          maxF0Hz,
        },
      });

      worker.postMessage({
        type: "SET_EXPECTED",
        payload: {
          expected,
          policy,
          centsTol,
          framesConfirm,
          transposeSemitones,
          acceptInversions: true,
        },
      });

      setStatus("listening");
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
      cleanup();
      setStatus("error");
    }
  }, [
    windowSec,
    tailMs,
    tickMs,
    a4Hz,
    minF0Hz,
    maxF0Hz,
    expected,
    policy,
    centsTol,
    framesConfirm,
    transposeSemitones,
    recorderWorkletURL,
    workerURL,
    onResult,
    cleanup,
  ]);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const setExpected = useCallback(
    (next: ChordSpec) => {
      workerRef.current?.postMessage({
        type: "SET_EXPECTED",
        payload: {
          expected: next,
          policy,
          centsTol,
          framesConfirm,
          transposeSemitones,
          acceptInversions: true,
        },
      });
    },
    [policy, centsTol, framesConfirm, transposeSemitones]
  );

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: "SET_EXPECTED",
      payload: {
        expected,
        policy,
        centsTol,
        framesConfirm,
        transposeSemitones,
        acceptInversions: true,
      },
    });
  }, [expected, policy, centsTol, framesConfirm, transposeSemitones]);

  return {
    status,
    errorMessage,
    start,
    stop,
    setExpected,
  } as const;
}
