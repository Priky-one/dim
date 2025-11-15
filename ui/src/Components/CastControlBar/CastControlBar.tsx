import { useEffect, useRef, useState } from "react";
import { getSelectedCastDevice } from "../Sidebar/CastButton";
import { useSelector } from "react-redux";
import type { RootState } from "../../store";
import {
  useControlCastSessionMutation,
  useGetUserCastSessionsQuery,
  CastSession,
} from "../../api/v1/cast";
import "./CastControlBar.scss";

interface MediaDetails {
  title: string;
  season?: number;
  episode?: number;
}

interface CastControlBarProps {
  resumePosition?: number; // seconds
}

export default function CastControlBar({ resumePosition }: CastControlBarProps) {
  // One-time resume usage
  const didInitRef = useRef(false);

  // canonical + render state
  const positionRef = useRef(0); // canonical UI position (seconds)
  const [position, setPosition] = useState(
    typeof resumePosition === "number" && resumePosition > 0 ? resumePosition : 0
  );
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const volumeRef = useRef(100);
  const [volume, setVolume] = useState(100);

  // dragging
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState(0);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  // server refs for interpolation/corrections
  const serverPositionRef = useRef(0); // seconds (last accepted server baseline)
  const serverTimestampRef = useRef<number>(Date.now()); // ms when that baseline was received
  const lastServerPositionRef = useRef(0);
  const lastServerReceiveRef = useRef<number>(Date.now());
  const lastServerSaysPlayingRef = useRef<boolean>(false);

  // animation
  const animationFrameRef = useRef<number | null>(null);
  const lastAnimationTsRef = useRef<number | null>(null);

  // optimistic control command tracking
  const controlPendingRef = useRef<{ ts: number; intended: "play" | "pause" | null }>({
    ts: 0,
    intended: null,
  });
  const lastControlLatencyRef = useRef<number | null>(null); // ms RTT for last control command

  // local optimistic suppression timestamps
  const lastLocalSeekRef = useRef<number>(0);
  const lastLocalVolumeRef = useRef<number>(0);

  // tunables
  const POLL_MS = 2000;
  const SEEK_SUPPRESSION_MS = 2000;
  const VOLUME_SUPPRESSION_MS = 1500;
  const CONTROL_SUPPRESSION_MS = 1200; // while awaiting control ack, prefer local state
  const STALE_MS = 5000; // if no server update in this time, stop advancing
  const CORRECTION_THRESHOLD = 0.25; // seconds - small diffs you can snap; larger diffs smooth+catch
  const CORRECTION_STRONG_GAIN = 0.85; // how much of delta to apply immediately (0..1)
  const CORRECTION_BLEND_MS = 400; // how quickly to blend remainder

  const sessionToken = useSelector((s: RootState) => s.auth.token);

  const { data: sessionsData, refetch } = useGetUserCastSessionsQuery(undefined, {
    pollingInterval: POLL_MS,
  });
  const [controlCast] = useControlCastSessionMutation();

  const activeSessions = sessionsData?.sessions || [];
  const selectedDeviceId = getSelectedCastDevice();
  const activeSession: CastSession | undefined = activeSessions.find(
    (s) => s.device_id === selectedDeviceId
  );

  // small state to kick animator when server updates but animate loop stopped
  const [animateKick, setAnimateKick] = useState(0);

  // Reset one-time resume flag when session changes
  useEffect(() => {
    didInitRef.current = false;
  }, [activeSession?.session_id]);

  // fetch metadata
  useEffect(() => {
    if (!activeSession) return;
    fetch(`/api/v1/media/${activeSession.media_file_id}/file`, {
      credentials: "include",
      headers: sessionToken ? { Authorization: sessionToken } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        let mediaName = data.target_file || `Media #${activeSession.media_file_id}`;
        const parts = mediaName.split("/");
        if (parts.length > 1) {
          const dirName = parts[parts.length - 2];
          if (dirName && dirName.length > 0) mediaName = dirName;
          else mediaName = parts[parts.length - 1].replace(/\.[^/.]+$/, "");
        }
        if (data.duration) setDuration(data.duration);
      })
      .catch(() => {});
  }, [activeSession?.media_file_id, sessionToken]);

  // ----- SERVER SYNC: accept or ignore updates, compute delta, apply corrections -----
  useEffect(() => {
    if (!activeSession) return;
    const now = Date.now();
    const serverPos = (activeSession.position_ms ?? 0) / 1000;
    const serverVol = activeSession.volume ?? 100;
    const serverState = (activeSession.state ?? "stopped").toLowerCase();
    const serverSaysPlaying = serverState === "playing";

    // update receive time (always) so UI doesn't go stale due to small ignores
    lastServerReceiveRef.current = now;

    // store last server pos for delta detection
    lastServerPositionRef.current = serverPositionRef.current;

    // --- handle one-time resumePosition alignment to avoid overshoot ---
    if (!didInitRef.current && typeof resumePosition === "number" && resumePosition > 0) {
      didInitRef.current = true;
      // align UI and server baseline to resumePosition to avoid immediate extrapolation jump
      positionRef.current = resumePosition;
      setPosition(resumePosition); // ensure UI reflects it
      serverPositionRef.current = resumePosition;
      serverTimestampRef.current = now;
      lastServerSaysPlayingRef.current = serverSaysPlaying;
      setIsPlaying(serverSaysPlaying);
    } else {
      // anomaly detection: ignore obvious bad updates (serverPos == 0 shortly after playing can be a glitch)
      // or huge backward jumps (unless server says 'stopped').
      const prev = lastServerPositionRef.current ?? serverPos;
      const posDroppedToZero = serverPos === 0 && prev > 5;
      const bigBackwardJump = serverPos + 10 < prev && serverState !== "stopped";

      if (posDroppedToZero || bigBackwardJump) {
        // ignore this server position update as an outlier
        // update state fields we trust but keep baseline unchanged so there's no jump
        if (Math.abs(serverVol - volumeRef.current) > 0.01) {
          const sinceLocalVol = now - lastLocalVolumeRef.current;
          if (sinceLocalVol >= VOLUME_SUPPRESSION_MS) {
            volumeRef.current = serverVol;
            setVolume(serverVol);
          }
        }
        // accept server state for icon only if not in control suppression window
        const ctrlPending = controlPendingRef.current;
        const ctrlRecently = ctrlPending.intended && now - ctrlPending.ts < CONTROL_SUPPRESSION_MS;
        if (!ctrlRecently) {
          lastServerSaysPlayingRef.current = serverSaysPlaying;
          setIsPlaying(serverSaysPlaying);
        }
        // do not update serverPositionRef/serverTimestampRef
        // Make sure animator is aware we received a server message (keeps UI considered fresh)
        if (animationFrameRef.current == null) setAnimateKick((v) => v + 1);
        return;
      }

      // Normal path: accept server baseline
      serverPositionRef.current = serverPos;
      serverTimestampRef.current = now;
      lastServerSaysPlayingRef.current = serverSaysPlaying;
      setIsPlaying(serverSaysPlaying);
    }

    // volume apply unless recently changed locally
    if (Math.abs(serverVol - volumeRef.current) > 0.01) {
      const sinceLocalVol = now - lastLocalVolumeRef.current;
      if (sinceLocalVol >= VOLUME_SUPPRESSION_MS) {
        volumeRef.current = serverVol;
        setVolume(serverVol);
      }
    }

    // Compute delta between server and UI
    const uiPos = positionRef.current;
    const deltaSec = serverPositionRef.current - uiPos; // positive => server ahead (UI lagging)

    // apply correction: if small, snap; if larger, apply strong immediate fraction to catch up then blend remainder
    if (Math.abs(deltaSec) <= CORRECTION_THRESHOLD) {
      // small: snap quickly
      positionRef.current = serverPositionRef.current;
      setPosition(positionRef.current);
    } else {
      // big: apply a strong immediate correction (to reduce perceived lag) + leave remainder to smoothing in animate()
      const immediate = deltaSec * CORRECTION_STRONG_GAIN;
      positionRef.current += immediate;
      setPosition(positionRef.current);
    }

    // ensure animator restarts if it was stopped so blending can continue
    if (animationFrameRef.current == null) setAnimateKick((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession]);

  // ----- ANIMATE: advance UI each frame and gently blend toward server expected position -----
  useEffect(() => {
    let mounted = true;

    function animateFrame(ts?: number) {
      if (!mounted) return;
      const nowMs = Date.now();

      if (lastAnimationTsRef.current == null) lastAnimationTsRef.current = ts ?? performance.now();
      const lastTs = lastAnimationTsRef.current!;
      const deltaMs = (ts ?? performance.now()) - lastTs;
      lastAnimationTsRef.current = ts ?? performance.now();

      // while dragging, just keep loop alive (render uses dragPosition) and don't mutate positionRef
      if (isDragging) {
        animationFrameRef.current = requestAnimationFrame(animateFrame);
        return;
      }

      // server freshness & server playing flag
      const serverFresh = nowMs - lastServerReceiveRef.current <= STALE_MS;
      const serverSaysPlaying = lastServerSaysPlayingRef.current;

      // expected position from server baseline:
      // extrapolate only if server says playing and server update is fresh
      let expectedFromServer = serverPositionRef.current;
      if (serverSaysPlaying && serverFresh) {
        expectedFromServer = serverPositionRef.current + Math.max(0, (nowMs - serverTimestampRef.current) / 1000);
      }

      // decide whether we should advance by real elapsed time:
      const ctrl = controlPendingRef.current;
      const ctrlRecently = ctrl.intended && nowMs - ctrl.ts < CONTROL_SUPPRESSION_MS;
      const effectivePlaying = ctrlRecently ? ctrl.intended === "play" : serverSaysPlaying;

      if (effectivePlaying && serverFresh) {
        // advance by elapsed time
        positionRef.current += deltaMs / 1000;
      }

      // Blend a fraction toward expectedFromServer to correct drift:
      const deltaToServer = expectedFromServer - positionRef.current;
      const blendAlpha = Math.min(1, deltaMs / Math.max(1, CORRECTION_BLEND_MS));
      positionRef.current += deltaToServer * blendAlpha;

      // clamp
      if (duration > 0) {
        positionRef.current = Math.max(0, Math.min(positionRef.current, duration));
      } else {
        positionRef.current = Math.max(0, positionRef.current);
      }

      setPosition(positionRef.current);

      // continue loop while playing or while server is fresh and there's correction to apply
      const needContinue =
        !isDragging &&
        ((serverFresh && effectivePlaying) || (serverFresh && Math.abs(expectedFromServer - positionRef.current) > 0.01));

      if (needContinue) {
        animationFrameRef.current = requestAnimationFrame(animateFrame);
      } else {
        animationFrameRef.current = null;
        lastAnimationTsRef.current = null;
      }
    }

    // start if not running and we should
    if (animationFrameRef.current == null) {
      if (isPlaying || Date.now() - lastServerReceiveRef.current <= STALE_MS) {
        animationFrameRef.current = requestAnimationFrame(animateFrame);
      }
    }

    return () => {
      mounted = false;
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastAnimationTsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isDragging, duration, animateKick]);

  // ----- ACTIONS: play/pause/seek/volume with optimistic UI and RTT measurement -----
  if (!activeSession) return null;

  const handlePlayPause = async () => {
    const intended = isPlaying ? "pause" : "play";
    const now = Date.now();
    controlPendingRef.current = { ts: now, intended };

    setIsPlaying(intended === "play");

    const before = Date.now();
    try {
      await controlCast({
        session_id: activeSession.session_id,
        action: intended === "play" ? "resume" : "pause",
      }).unwrap();
      lastControlLatencyRef.current = Date.now() - before;
    } catch (err) {
      console.error("control play/pause failed", err);
      refetch();
    } finally {
      setTimeout(() => {
        controlPendingRef.current = { ts: 0, intended: null };
      }, CONTROL_SUPPRESSION_MS + 50);
    }
  };

  const handleStop = async () => {
    try {
      await controlCast({
        session_id: activeSession.session_id,
        action: "stop",
      }).unwrap();
      refetch();
    } catch (err) {
      console.error("stop failed", err);
    }
  };

  const handleSeek = async (newPos: number) => {
    lastLocalSeekRef.current = Date.now();
    positionRef.current = newPos;
    setPosition(newPos);
    try {
      await controlCast({
        session_id: activeSession.session_id,
        action: "seek",
        position_ms: Math.floor(newPos * 1000),
      }).unwrap();
    } catch (err) {
      console.error("seek failed", err);
      refetch();
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const newPos = Math.max(0, Math.min(1, ratio)) * duration;
    handleSeek(newPos);
  };

  const handleProgressDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleProgressDrag(e);
  };

  const handleProgressDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setDragPosition(ratio * duration);
  };

  const handleProgressDragEnd = () => {
    if (isDragging) {
      handleSeek(dragPosition);
      setIsDragging(false);
    }
  };

  const handleVolumeChange = async (v: number) => {
    lastLocalVolumeRef.current = Date.now();
    volumeRef.current = v;
    setVolume(v);
    try {
      await controlCast({
        session_id: activeSession.session_id,
        action: "set_volume",
        volume: Math.floor(v),
      }).unwrap();
    } catch (err) {
      console.error("set volume failed", err);
    }
  };

  // time formatter
  const formatTime = (s: number) => {
    const secs = Math.max(0, Math.floor(s));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const sec = secs % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const displayPosition = isDragging ? dragPosition : position;
  const progressPercent = duration > 0 ? (displayPosition / duration) * 100 : 0;

  return (
    <div className="cast-control-bar">
      <div
        className="progress-bar-container"
        ref={progressBarRef}
        onClick={handleProgressClick}
        onMouseDown={handleProgressDragStart}
        onMouseMove={isDragging ? handleProgressDrag : undefined}
        onMouseUp={handleProgressDragEnd}
        onMouseLeave={handleProgressDragEnd}
      >
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
          <div className="progress-bar-thumb" style={{ left: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="controls-container">
        <div className="left-controls">
          <button className="control-button play-pause" onClick={handlePlayPause}>
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button className="control-button stop" onClick={handleStop}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" />
            </svg>
          </button>

          <div className="time-display">
            <span className="current-time">{formatTime(displayPosition)}</span>
            <span className="separator">/</span>
            <span className="total-time">{formatTime(duration)}</span>
          </div>
        </div>

        <div className="center-controls">
          <div className="media-info">
            <span
              className="media-title"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => {
                window.history.pushState({}, "", `/media/${activeSession.media_file_id}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >
              Media #{activeSession.media_file_id}
            </span>
            <span className="cast-indicator">🎬 Casting to device</span>
          </div>
        </div>

        <div className="right-controls">
          <div className="volume-control">
            <button
              className="control-button volume-icon"
              onClick={() => {
                if (volume > 0) handleVolumeChange(0);
                else handleVolumeChange(100);
              }}
            >
              {volume === 0 ? (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
              ) : volume < 50 ? (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 9v6h4l5 5V4l-5 5H7z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              className="volume-slider"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
