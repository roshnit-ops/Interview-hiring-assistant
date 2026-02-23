import { useState, useRef, useCallback, useEffect } from 'react';

const SAMPLE_RATE = 16000;
const CHUNK_MS = 100;
const MIN_SAMPLES = Math.floor((SAMPLE_RATE * CHUNK_MS) / 1000);

function mergeBuffers(a, b) {
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function useStreamingTranscription(options = {}) {
  const { onTurn, onError } = options;
  const [transcript, setTranscript] = useState('');
  const [turns, setTurns] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const streamsRef = useRef([]);
  const audioContextRef = useRef(null);
  const workletRef = useRef(null);
  const sourceRef = useRef(null);
  const queueRef = useRef(new Int16Array(0));
  const turnsMapRef = useRef({});

  const stop = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'Terminate' }));
        wsRef.current.close();
      } catch (_) {}
      wsRef.current = null;
    }
    streamRef.current?.getTracks?.().forEach((t) => t.stop());
    streamRef.current = null;
    streamsRef.current.forEach((s) => s?.getTracks?.().forEach((t) => t.stop()));
    streamsRef.current = [];
    audioContextRef.current?.close?.();
    audioContextRef.current = null;
    workletRef.current = null;
    sourceRef.current = null;
    queueRef.current = new Int16Array(0);
    setIsConnected(false);
  }, []);

  const start = useCallback(async (audioSource = 'mic') => {
    setError(null);
    const tokenRes = await fetch('/api/token');
    const data = await tokenRes.json();
    if (!data.token) {
      const err = data.error || 'Failed to get token';
      setError(err);
      onError?.(err);
      return;
    }

    const streamsToStop = [];
    let stream;
    let tabStream = null;
    let micStream = null;

    if (audioSource === 'both') {
      if (!navigator.mediaDevices.getDisplayMedia) {
        setError('Tab capture not supported. Use Chrome or Edge.');
        onError?.('Tab capture not supported.');
        return;
      }
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        const audioTracks = displayStream.getAudioTracks();
        if (!audioTracks.length) {
          displayStream.getTracks().forEach((t) => t.stop());
          setError('No audio in shared tab. Pick the meeting tab and check "Share tab audio".');
          onError?.('No tab audio.');
          return;
        }
        tabStream = new MediaStream(audioTracks);
        streamsToStop.push(tabStream);
        displayStream.getVideoTracks().forEach((t) => t.stop());
      } catch (e) {
        if (e.name === 'NotAllowedError') {
          setError('Tab share cancelled. Share the meeting tab to capture candidate audio.');
          onError?.('Tab share cancelled.');
          return;
        }
        setError(e.message || 'Failed to capture meeting tab.');
        onError?.(e.message);
        return;
      }
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamsToStop.push(micStream);
    } else if (audioSource === 'tab') {
      if (!navigator.mediaDevices.getDisplayMedia) {
        const err = 'Tab audio capture is not supported in this browser. Use Chrome or Edge.';
        setError(err);
        onError?.(err);
        return;
      }
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        const audioTracks = displayStream.getAudioTracks();
        if (!audioTracks.length) {
          displayStream.getTracks().forEach((t) => t.stop());
          const err = 'No audio in shared tab. When sharing, pick the meeting tab and choose "Share tab audio".';
          setError(err);
          onError?.(err);
          return;
        }
        stream = new MediaStream(audioTracks);
        displayStream.getVideoTracks().forEach((t) => t.stop());
      } catch (e) {
        if (e.name === 'NotAllowedError') {
          const err = 'Tab share was cancelled or denied. Please share the tab where your meeting is running.';
          setError(err);
          onError?.(err);
          return;
        }
        const err = e.message || 'Failed to capture meeting tab audio.';
        setError(err);
        onError?.(err);
        return;
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    if (stream) {
      streamRef.current = stream;
      streamsRef.current = [stream];
    } else {
      streamRef.current = tabStream;
      streamsRef.current = [tabStream, micStream];
    }

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'balanced' });
    audioContextRef.current = audioContext;

    const workletPath = '/audio-processor.js';
    await audioContext.audioWorklet.addModule(workletPath);
    const worklet = new AudioWorkletNode(audioContext, 'audio-processor');
    workletRef.current = worklet;

    if (audioSource === 'both') {
      const sourceTab = audioContext.createMediaStreamSource(tabStream);
      const sourceMic = audioContext.createMediaStreamSource(micStream);
      const gainTab = audioContext.createGain();
      const gainMic = audioContext.createGain();
      gainTab.gain.value = 0.8;
      gainMic.gain.value = 0.8;
      sourceTab.connect(gainTab);
      sourceMic.connect(gainMic);
      gainTab.connect(worklet);
      gainMic.connect(worklet);
      sourceRef.current = [sourceTab, sourceMic];
    } else {
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(worklet);
    }
    worklet.connect(audioContext.destination);

    const endpoint = `wss://streaming.assemblyai.com/v3/ws?sample_rate=${SAMPLE_RATE}&formatted_finals=true&token=${data.token}`;
    const ws = new WebSocket(endpoint);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      queueRef.current = new Int16Array(0);
      turnsMapRef.current = {};
    };

    worklet.port.onmessage = (event) => {
      const chunk = new Int16Array(event.data.audio_data);
      queueRef.current = mergeBuffers(queueRef.current, chunk);
      const durationMs = (queueRef.current.length / SAMPLE_RATE) * 1000;
      if (durationMs >= CHUNK_MS && ws.readyState === WebSocket.OPEN) {
        const toSend = Math.floor(SAMPLE_RATE * 0.1);
        const slice = queueRef.current.subarray(0, toSend);
        ws.send(new Uint8Array(slice.buffer));
        queueRef.current = queueRef.current.subarray(toSend);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'Turn') {
          const { turn_order, transcript: turnText } = msg;
          turnsMapRef.current[turn_order] = turnText;
          const ordered = Object.keys(turnsMapRef.current)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => turnsMapRef.current[k]);
          const full = ordered.join(' ');
          setTurns(ordered);
          setTranscript(full);
          onTurn?.(full, ordered);
        }
      } catch (_) {}
    };

    ws.onerror = () => {
      setError('WebSocket error');
      onError?.('WebSocket error');
    };

    ws.onclose = () => {
      setIsConnected(false);
    };
  }, [onTurn, onError]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { transcript, turns, isConnected, error, start, stop };
}
