let audioCtx: AudioContext | null = null;
let soundsEnabled = true;
let audioResumeWarningLogged = false;

type ActiveTone = {
  oscillator: OscillatorNode;
  envelope: GainNode;
};

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

function resumeAudioContext(context: AudioContext): void {
  if (context.state !== "suspended") return;
  void context.resume().catch((error: unknown) => {
    if (audioResumeWarningLogged) return;
    audioResumeWarningLogged = true;
    console.warn("Audio playback is waiting for a user interaction.", error);
  });
}

function playTone(
  context: AudioContext,
  frequency: number,
  startOffset: number,
  duration: number,
  volume: number,
  waveform: OscillatorType = "sine",
  endFrequency?: number,
  activeTones?: Set<ActiveTone>,
): void {
  const startAt = context.currentTime + startOffset;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const attack = Math.min(0.025, duration * 0.2);

  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  if (endFrequency && endFrequency !== frequency) {
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
  }

  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), startAt + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(envelope);
  envelope.connect(context.destination);
  if (activeTones) {
    const tone = { oscillator, envelope };
    activeTones.add(tone);
    oscillator.addEventListener("ended", () => activeTones.delete(tone), { once: true });
  }
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.01);
}

function playChime(
  context: AudioContext,
  frequency: number,
  startOffset: number,
  duration: number,
  volume: number,
  activeTones?: Set<ActiveTone>,
): void {
  playTone(context, frequency, startOffset, duration, volume, "sine", undefined, activeTones);
  playTone(context, frequency * 2.01, startOffset, duration * 0.58, volume * 0.15, "sine", undefined, activeTones);
  playTone(context, frequency * 3.98, startOffset, duration * 0.32, volume * 0.035, "sine", undefined, activeTones);
}

function withAudioContext(soundName: string, play: (context: AudioContext) => void): void {
  if (!soundsEnabled) return;
  try {
    const context = getAudioContext();
    if (!context) return;
    resumeAudioContext(context);
    play(context);
  } catch (error) {
    console.warn(`Could not play ${soundName} sound.`, error);
  }
}

function playCallEnd(): void {
  withAudioContext("call end", (context) => {
    playChime(context, 659.25, 0, 0.28, 0.034);
    playChime(context, 554.37, 0.11, 0.3, 0.032);
    playChime(context, 440, 0.22, 0.38, 0.03);
  });
}

function playChatNotification(): void {
  withAudioContext("chat notification", (context) => {
    playChime(context, 659.25, 0, 0.17, 0.025);
    playChime(context, 783.99, 0.08, 0.22, 0.023);
    playChime(context, 698.46, 0.18, 0.3, 0.021);
  });
}

function playCallRingingTone(activeTones: Set<ActiveTone>): void {
  withAudioContext("call ring", (context) => {
    playChime(context, 493.88, 0, 0.34, 0.036, activeTones);
    playChime(context, 659.25, 0.16, 0.4, 0.034, activeTones);
    playChime(context, 587.33, 0.36, 0.48, 0.032, activeTones);
  });
}

export const soundFx = {
  setEnabled(enabled: boolean): void {
    soundsEnabled = enabled;
  },

  unlockAudio(): void {
    if (!soundsEnabled) return;
    try {
      const context = getAudioContext();
      if (context) resumeAudioContext(context);
    } catch (error) {
      console.warn("Could not unlock audio playback.", error);
    }
  },

  playSent(): void {
    withAudioContext("message sent", (context) => {
      playChime(context, 587.33, 0, 0.16, 0.026);
      playChime(context, 783.99, 0.065, 0.24, 0.025);
    });
  },

  playReceived(): void {
    playChatNotification();
  },

  playChatNotification,

  playCallConnect(): void {
    withAudioContext("call connect", (context) => {
      playChime(context, 523.25, 0, 0.26, 0.028);
      playChime(context, 659.25, 0.1, 0.28, 0.03);
      playChime(context, 783.99, 0.2, 0.36, 0.032);
    });
  },

  startCallRinging(): () => void {
    if (typeof window === "undefined") return () => {};
    const activeTones = new Set<ActiveTone>();
    const play = () => playCallRingingTone(activeTones);

    play();
    const intervalId = window.setInterval(play, 900);
    return () => {
      window.clearInterval(intervalId);
      for (const { oscillator, envelope } of activeTones) {
        const context = oscillator.context;
        if (context.state === "closed") continue;
        const now = context.currentTime;
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setTargetAtTime(0.0001, now, 0.015);
        oscillator.stop(now + 0.07);
      }
      activeTones.clear();
    };
  },

  playCallEnd,

  playCallDisconnect(): void {
    playCallEnd();
  },

  playVoiceTone(_frequency?: number): void {},

  playDtmf(key: string): void {
    const dtmfFrequencies: Record<string, [number, number]> = {
      "1": [697, 1209],
      "2": [697, 1336],
      "3": [697, 1477],
      "4": [770, 1209],
      "5": [770, 1336],
      "6": [770, 1477],
      "7": [852, 1209],
      "8": [852, 1336],
      "9": [852, 1477],
      "*": [941, 1209],
      "0": [941, 1336],
      "#": [941, 1477],
    };

    const frequencies = dtmfFrequencies[key] ?? [800, 1200];
    withAudioContext("keypad", (context) => {
      playTone(context, frequencies[0], 0, 0.14, 0.045);
      playTone(context, frequencies[1], 0, 0.14, 0.045);
    });
  },
};
