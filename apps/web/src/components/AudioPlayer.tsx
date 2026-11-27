import { useState, useRef, useEffect } from "react";
import { Play, Pause } from "lucide-react";
import { soundFx } from "../services/soundFx.js";

type AudioPlayerProps = {
  waveform: number[];
  durationSec: number;
  audioUrl?: string | undefined;
};

export function AudioPlayer({ waveform, durationSec, audioUrl }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const intervalRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const safeWaveform = (Array.isArray(waveform) && waveform.length > 0)
    ? waveform
    : [28, 45, 65, 30, 80, 55, 90, 70, 40, 60, 85, 50, 75, 45, 60, 35, 70, 50, 30, 65, 45, 25];

  useEffect(() => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.playbackRate = playbackRate;
      audio.onended = () => {
        setIsPlaying(false);
        setPlaybackProgress(0);
      };
      audio.ontimeupdate = () => {
        setPlaybackProgress(audio.currentTime);
      };
      audioElRef.current = audio;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    if (audioElRef.current) {
      audioElRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  function togglePlay() {
    if (isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (audioElRef.current) audioElRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      if (audioElRef.current) {
        audioElRef.current.play().catch(() => { });
      } else {
        // Melodic synthesizer feedback for synthesized notes
        let stepCount = 0;
        const step = 0.05 * playbackRate;
        intervalRef.current = window.setInterval(() => {
          setPlaybackProgress((prev) => {
            stepCount++;
            if (stepCount % 4 === 0) {
              const currentBar = safeWaveform[Math.floor((prev / durationSec) * safeWaveform.length)] ?? 50;
              soundFx.playVoiceTone(280 + currentBar * 2);
            }
            if (prev >= durationSec) {
              if (intervalRef.current) clearInterval(intervalRef.current);
              setIsPlaying(false);
              return 0;
            }
            return prev + step;
          });
        }, 50);
      }
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = ratio * durationSec;
    setPlaybackProgress(seekTime);
    if (audioElRef.current) {
      audioElRef.current.currentTime = seekTime;
    }
  }

  function cycleSpeed() {
    setPlaybackRate((prev) => (prev === 1 ? 1.5 : prev === 1.5 ? 2 : 1));
  }

  const currentSeconds = Math.floor(isPlaying ? playbackProgress : durationSec);
  const formattedTime = `0:${currentSeconds < 10 ? "0" : ""}${currentSeconds}`;
  const progressRatio = durationSec > 0 ? playbackProgress / durationSec : 0;

  return (
    <div className="audio-voice-note">
      <button
        type="button"
        className="audio-play-button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} className="play-icon" />}
      </button>

      <div
        className="waveform-container"
        role="progressbar"
        aria-valuenow={Math.round(progressRatio * 100)}
        onClick={handleSeek}
        style={{ cursor: "pointer" }}
        title="Click to seek"
      >
        {safeWaveform.map((barHeight, idx) => {
          const barFraction = idx / safeWaveform.length;
          const isPassed = barFraction <= progressRatio;
          return (
            <span
              key={idx}
              className={`waveform-bar ${isPassed ? "is-passed" : ""}`}
              style={{ height: `${Math.max(14, barHeight)}%` }}
            />
          );
        })}
      </div>

      <div className="audio-meta">
        <span className="audio-duration">{formattedTime}</span>
        <button
          type="button"
          className="audio-speed-pill"
          onClick={cycleSpeed}
          title="Playback speed"
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
}
