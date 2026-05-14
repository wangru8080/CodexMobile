import { useRef } from 'react';
import {
  REALTIME_VOICE_SAMPLE_RATE,
  pcm16Base64ToFloat
} from '../app-helpers.js';

export function useRealtimePlayback({
  outputSampleRate,
  setVoiceDialogMode,
  voiceDialogOpenRef,
  voiceDialogRealtimeRef,
  voiceDialogStateRef,
  voiceRealtimeAwaitingResponseRef
}) {
  const voiceRealtimePlaybackContextRef = useRef(null);
  const voiceRealtimePlaybackSourcesRef = useRef(new Set());
  const voiceRealtimePlayheadRef = useRef(0);

  function stopRealtimePlayback({ release = false } = {}) {
    for (const source of voiceRealtimePlaybackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    voiceRealtimePlaybackSourcesRef.current.clear();
    const context = voiceRealtimePlaybackContextRef.current;
    voiceRealtimePlayheadRef.current = context?.currentTime || 0;
    if (release && context && context.state !== 'closed') {
      context.close?.().catch?.(() => null);
      voiceRealtimePlaybackContextRef.current = null;
      voiceRealtimePlayheadRef.current = 0;
    }
  }

  function playRealtimeAudioDelta(delta) {
    if (!delta) {
      return;
    }
    const samples = pcm16Base64ToFloat(delta);
    if (!samples.length) {
      return;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    let context = voiceRealtimePlaybackContextRef.current;
    if (!context || context.state === 'closed') {
      context = new AudioContextCtor();
      voiceRealtimePlaybackContextRef.current = context;
      voiceRealtimePlayheadRef.current = context.currentTime;
    }
    context.resume?.().catch?.(() => null);
    const buffer = context.createBuffer(1, samples.length, Number(outputSampleRate) || REALTIME_VOICE_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    voiceRealtimePlaybackSourcesRef.current.add(source);
    source.onended = () => {
      voiceRealtimePlaybackSourcesRef.current.delete(source);
      if (
        voiceDialogOpenRef.current &&
        voiceDialogRealtimeRef.current &&
        voiceRealtimePlaybackSourcesRef.current.size === 0 &&
        voiceDialogStateRef.current === 'speaking'
      ) {
        voiceRealtimeAwaitingResponseRef.current = false;
        setVoiceDialogMode('listening');
      }
    };
    const startAt = Math.max(voiceRealtimePlayheadRef.current, context.currentTime + 0.03);
    source.start(startAt);
    voiceRealtimePlayheadRef.current = startAt + buffer.duration;
  }

  return {
    playRealtimeAudioDelta,
    stopRealtimePlayback,
    voiceRealtimePlaybackSourcesRef
  };
}
