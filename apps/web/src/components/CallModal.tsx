import { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Share2,
  Sliders,
  Maximize2,
  Minimize2,
  Activity,
  Layers,
  Edit3,
  CheckSquare,
  MessageSquare,
  Send,
  UserPlus,
  Search,
  X,
  AlertCircle,
  ShieldCheck,
  TrendingUp,
  Volume2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type {
  WebRtcTelemetrySample,
  RecoveryRiskEstimate,
  WhiteboardStroke,
  CallParticipant,
  Conversation,
} from "../services/types.js";
import { PredictiveCallRecoveryEstimatorClient } from "../services/predictiveEstimator.js";
import { soundFx } from "../services/soundFx.js";
import { realtime } from "../services/realtime.js";
import { getSafeAvatar } from "../services/avatars.js";

type CallModalProps = {
  isOpen: boolean;
  callId: string | null;
  currentUserId: string;
  isInitiator: boolean;
  isAccepted: boolean;
  isEnded?: boolean;
  onHangup: () => void;
  peerName?: string;
  peerAvatar?: string;
  isVideo?: boolean;
  participants?: CallParticipant[];
  availableContacts?: Conversation[];
};

type InCallChatMessage = {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  sentAt: number;
};

export function CallModal({
  isOpen,
  callId,
  currentUserId,
  isInitiator,
  isAccepted,
  isEnded = false,
  onHangup,
  peerName = "Peer",
  peerAvatar = "/avatars/boy.png",
  isVideo = true,
  participants = [],
  availableContacts = [],
}: CallModalProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(!isVideo);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showCollabDrawer, setShowCollabDrawer] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [pendingInviteIds, setPendingInviteIds] = useState<Set<string>>(new Set());
  const [callInviteError, setCallInviteError] = useState<string | null>(null);
  const [collabTab, setCollabTab] = useState<"chat" | "whiteboard" | "notes">("whiteboard");
  const [showTelemetryHUD, setShowTelemetryHUD] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callChatMessages, setCallChatMessages] = useState<InCallChatMessage[]>([]);
  const [callChatDraft, setCallChatDraft] = useState("");
  const [callChatError, setCallChatError] = useState<string | null>(null);
  const callChatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  // Collaboration State
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  const notesSyncTimerRef = useRef<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState("#10b981");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [notesText, setNotesText] = useState("");

  useEffect(() => {
    setCallChatMessages([]);
    setCallChatDraft("");
    setCallChatError(null);
  }, [callId, isOpen, isAccepted]);

  useEffect(() => {
    if (!isOpen || !isAccepted || !callId) return;

    const unsubscribe = realtime.subscribe("call:chat", (payload: Partial<InCallChatMessage> & { callId?: string }) => {
      if (
        payload.callId !== callId ||
        typeof payload.id !== "string" ||
        typeof payload.text !== "string" ||
        typeof payload.senderId !== "string" ||
        typeof payload.senderName !== "string" ||
        typeof payload.sentAt !== "number"
      ) {
        return;
      }

      const incomingMessage: InCallChatMessage = {
        id: payload.id,
        text: payload.text,
        senderId: payload.senderId,
        senderName: payload.senderName,
        sentAt: payload.sentAt,
      };
      setCallChatMessages((messages) => {
        if (messages.some((message) => message.id === incomingMessage.id)) return messages;
        return [...messages, incomingMessage].slice(-200);
      });
    });

    return unsubscribe;
  }, [isOpen, isAccepted, callId]);

  useEffect(() => {
    callChatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [callChatMessages]);

  useEffect(() => {
    setPendingInviteIds(new Set());
    setShowAddPerson(false);
    setInviteSearch("");
    setCallInviteError(null);
  }, [callId, isOpen]);

  useEffect(() => {
    setPendingInviteIds((pending) => {
      const activeIds = new Set(participants.map(({ id }) => id));
      const remaining = new Set([...pending].filter((id) => !activeIds.has(id)));
      return remaining.size === pending.size ? pending : remaining;
    });
  }, [participants]);

  useEffect(() => {
    if (!callId) return;
    const unsubscribeError = realtime.subscribe(
      "call:add-participant:error",
      (data: { callId?: string; reason?: string; targetUserId?: string }) => {
        if (data.callId !== callId) return;
        const targetUserId = data.targetUserId;
        if (targetUserId) {
          setPendingInviteIds((pending) => {
            const next = new Set(pending);
            next.delete(targetUserId);
            return next;
          });
        }
        setCallInviteError(data.reason || "Could not invite this person.");
      },
    );
    const unsubscribeInvited = realtime.subscribe(
      "call:participant-invited",
      (data: { callId?: string; participant?: CallParticipant }) => {
        const participantId = data.participant?.id;
        if (data.callId !== callId || !participantId) return;
        setPendingInviteIds((pending) => new Set(pending).add(participantId));
      },
    );
    const unsubscribeDeclined = realtime.subscribe(
      "call:participant-declined",
      (data: { callId?: string; participantId?: string }) => {
        const participantId = data.participantId;
        if (data.callId !== callId || !participantId) return;
        setPendingInviteIds((pending) => {
          const next = new Set(pending);
          next.delete(participantId);
          return next;
        });
      },
    );
    return () => {
      unsubscribeError();
      unsubscribeInvited();
      unsubscribeDeclined();
    };
  }, [callId]);

  function inviteContact(contact: Conversation) {
    if (!callId || !isAccepted) return;
    const targetUserId = contact.peerUserId;
    const targetPhone = contact.peerPhone;
    if (!targetUserId && !targetPhone) {
      setCallInviteError("This contact has no registered call recipient.");
      return;
    }
    if (participants.length + pendingInviteIds.size >= 9) {
      setCallInviteError("A call can have up to 10 people, including you.");
      return;
    }
    if (!realtime.sendCallAddParticipant(callId, {
      targetUserId,
      targetPhone,
      isVideo,
    })) {
      setCallInviteError("Invite not sent. Check your connection and try again.");
      return;
    }
    if (targetUserId) {
      setPendingInviteIds((pending) => new Set(pending).add(targetUserId));
    }
    setCallInviteError(null);
  }

  function sendInCallChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = callChatDraft.trim();
    if (!callId || !isAccepted || !text) return;

    const id = crypto.randomUUID();
    const sentAt = Date.now();
    if (!realtime.sendCallChat(callId, id, text)) {
      setCallChatError("Message not sent. Check your connection and try again.");
      return;
    }

    setCallChatMessages((messages) => [
      ...messages,
      { id, text, senderId: currentUserId, senderName: "You", sentAt },
    ].slice(-200));
    setCallChatDraft("");
    setCallChatError(null);
  }

  // WebRTC Media & PeerConnection Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const remoteStreamsRef = useRef(new Map<string, MediaStream>());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const queuedSignalsRef = useRef(new Map<string, Array<RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit }>>());
  const offeredPeerIdsRef = useRef(new Set<string>());
  const createPeerConnectionRef = useRef<((participant: CallParticipant) => RTCPeerConnection) | null>(null);
  const processPeerSignalRef = useRef<((fromUserId: string, signal: RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit }) => Promise<void>) | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const [hasLocalMedia, setHasLocalMedia] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [callConnectionState, setCallConnectionState] = useState<"waiting" | "connecting" | "connected" | "failed">("waiting");
  const connectionTimeoutRef = useRef<number | null>(null);
  const turnServerConfiguredRef = useRef(false);

  // Predictive Call Recovery Engine State
  const estimatorRef = useRef(new PredictiveCallRecoveryEstimatorClient({ windowMs: 10_000, maxSamples: 16 }));
  const [telemetry, setTelemetry] = useState<WebRtcTelemetrySample>({
    timestampMs: Date.now(),
    roundTripTimeMs: 0,
    jitterMs: 0,
    packetLossPercent: 0,
    availableOutgoingBitrateBps: 0,
    sendingBitrateBps: 0,
    resolution: "Audio-Only",
    fps: 0,
  });

  const [estimate, setEstimate] = useState<RecoveryRiskEstimate>({
    level: "UNKNOWN",
    score: 0,
    confidence: "LOW",
    sampleCount: 0,
    observedWindowMs: 0,
    adaptationAction: "Waiting for live connection statistics.",
    timestampMs: Date.now(),
  });

  // Use one peer connection per remote participant for small group calls.
  useEffect(() => {
    if (!isOpen || !isAccepted || !callId) {
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      remoteStreamsRef.current.clear();
      queuedSignalsRef.current.clear();
      offeredPeerIdsRef.current.clear();
      createPeerConnectionRef.current = null;
      processPeerSignalRef.current = null;
      setRemoteStreams({});
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      setHasLocalMedia(false);
      setMediaReady(false);
      setCallConnectionState("waiting");
      if (connectionTimeoutRef.current !== null) {
        window.clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      if (notesSyncTimerRef.current !== null) {
        window.clearTimeout(notesSyncTimerRef.current);
        notesSyncTimerRef.current = null;
      }
      return;
    }
    const currentCallId = callId;

    let cancelled = false;
    let iceServers: RTCIceServer[] = [];
    turnServerConfiguredRef.current = false;
    setHasLocalMedia(false);
    setMediaReady(false);
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    remoteStreamsRef.current.clear();
    queuedSignalsRef.current.clear();
    offeredPeerIdsRef.current.clear();
    setRemoteStreams({});
    setMediaError(null);
    setCallConnectionState("connecting");
    if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current);

    if (window.isSecureContext !== true) {
      setCallConnectionState("failed");
      setMediaError("Camera and microphone access requires HTTPS. Open this site over a trusted HTTPS connection on your device.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCallConnectionState("failed");
      setMediaError("This browser does not support camera and microphone access. Update your browser or try a supported browser.");
      return;
    }
    if (typeof window.RTCPeerConnection !== "function") {
      setCallConnectionState("failed");
      setMediaError("This browser does not support WebRTC calls. Update your browser or try a supported browser.");
      return;
    }

    function queueSignal(fromUserId: string, signal: RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit }) {
      const queued = queuedSignalsRef.current.get(fromUserId) ?? [];
      queuedSignalsRef.current.set(fromUserId, [...queued, signal]);
    }

    function createPeerConnection(participant: CallParticipant) {
      const existing = peerConnectionsRef.current.get(participant.id);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers });
      peerConnectionsRef.current.set(participant.id, pc);
      const localStream = localStreamRef.current;
      localStream?.getAudioTracks().forEach((track) => pc.addTrack(track, localStream));
      const videoTrack = screenTrackRef.current ?? localStream?.getVideoTracks()[0];
      if (videoTrack && localStream) pc.addTrack(videoTrack, localStream);
      pc.onicecandidate = (event) => {
        if (event.candidate && !realtime.sendWebrtcSignal(currentCallId, participant.id, { candidate: event.candidate })) {
          setMediaError("Realtime signaling disconnected while exchanging network candidates.");
        }
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        remoteStreamsRef.current.set(participant.id, stream);
        setRemoteStreams(Object.fromEntries(remoteStreamsRef.current));
      };
      pc.onconnectionstatechange = () => {
        const peerStates = [...peerConnectionsRef.current.values()].map(({ connectionState }) => connectionState);
        if (peerStates.includes("connected")) {
          setCallConnectionState("connected");
          setMediaError(null);
          if (connectionTimeoutRef.current !== null) {
            window.clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
        } else if (peerStates.length > 0 && peerStates.every((state) => state === "failed" || state === "closed")) {
          setCallConnectionState("failed");
          setMediaError(turnServerConfiguredRef.current
            ? "Call network path failed. Check that the TURN relay and its firewall ports are reachable."
            : "This network needs a TURN relay. Configure TURN_URL and TURN_SHARED_SECRET on the server, then retry.");
        } else {
          setCallConnectionState("connecting");
        }
      };
      pc.onicecandidateerror = (event) => {
        console.warn("WebRTC ICE candidate gathering error.", {
          url: event.url,
          errorCode: event.errorCode,
          errorText: event.errorText,
        });
      };
      return pc;
    }
    createPeerConnectionRef.current = createPeerConnection;

    async function processPeerSignal(
      fromUserId: string,
      signal: RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit },
    ) {
      const pc = peerConnectionsRef.current.get(fromUserId) ??
        (localStreamRef.current ? createPeerConnection({
          id: fromUserId,
          displayName: "Participant",
          avatar: "/avatars/boy.png",
        }) : null);
      if (!pc || !localStreamRef.current) {
        queueSignal(fromUserId, signal);
        return;
      }

      if ("candidate" in signal) {
        if (signal.candidate) {
          if (!pc.remoteDescription) {
            queueSignal(fromUserId, signal);
            return;
          }
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
        return;
      }

      if (!signal.sdp || !signal.type) return;
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const queued = queuedSignalsRef.current.get(fromUserId) ?? [];
      queuedSignalsRef.current.delete(fromUserId);
      for (const queuedSignal of queued) {
        if ("candidate" in queuedSignal && queuedSignal.candidate && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(queuedSignal.candidate));
        } else {
          queueSignal(fromUserId, queuedSignal);
        }
      }
      if (signal.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (!pc.localDescription || !realtime.sendWebrtcSignal(currentCallId, fromUserId, pc.localDescription)) {
          throw new Error("Realtime signaling disconnected before the answer could be sent.");
        }
      }
    }
    processPeerSignalRef.current = processPeerSignal;

    const unsubSignal = realtime.subscribe(
      "webrtc:signal",
      (data: {
        callId?: string;
        fromUserId?: string;
        toUserId?: string;
        signal?: RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit };
      }) => {
        if (
          data?.callId !== currentCallId ||
          data.toUserId !== currentUserId ||
          !data.fromUserId ||
          !data.signal
        ) return;
        void processPeerSignal(data.fromUserId, data.signal).catch((error: unknown) => {
          console.error("Could not process call signaling.", error);
          setMediaError(error instanceof Error ? error.message : "Could not process call signaling.");
        });
      },
    );

    async function initWebRtc() {
      try {
        const iceResponse = await fetch(`/api/calls/ice-servers?callId=${encodeURIComponent(currentCallId)}`);
        if (!iceResponse.ok) {
          const result = await iceResponse.json() as { error?: { message?: string } };
          throw new Error(result.error?.message || "Could not load call connection settings from the server.");
        }
        const iceConfig = await iceResponse.json() as { iceServers?: RTCIceServer[] };
        if (!Array.isArray(iceConfig.iceServers) || iceConfig.iceServers.length === 0) {
          throw new Error("The server did not provide any ICE servers for the call.");
        }
        iceServers = iceConfig.iceServers;
        turnServerConfiguredRef.current = iceServers.some((server) => {
          const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
          return urls.some((url) => /^turns?:/i.test(url));
        });
        if (cancelled) return;

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: isVideo
              ? {
                  facingMode: "user",
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  frameRate: { ideal: 24, max: 30 },
                }
              : false,
          });
        } catch (error) {
          if (!isVideo) throw error;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setMediaError("Camera access is unavailable. Continuing with audio only.");
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        screenTrackRef.current = null;
        setHasLocalMedia(stream.getVideoTracks().length > 0);
        setMediaReady(true);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        peerConnectionsRef.current.forEach((pc) => {
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        });
        const queuedPeers = [...queuedSignalsRef.current.entries()];
        for (const [fromUserId, signals] of queuedPeers) {
          queuedSignalsRef.current.delete(fromUserId);
          const orderedSignals = [
            ...signals.filter((signal) => !("candidate" in signal)),
            ...signals.filter((signal) => "candidate" in signal),
          ];
          for (const signal of orderedSignals) {
            await processPeerSignal(fromUserId, signal);
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not access your camera and microphone.";
        console.error("Call media setup failed.", error);
        setMediaError(message);
        setCallConnectionState("failed");
      }
    }

    void initWebRtc();

    // Realtime Whiteboard & Notes sync inside the call
    const unsubStroke = realtime.subscribe("whiteboard:stroke", (stroke) => {
      if (stroke?.callId !== currentCallId) return;
      const canvas = canvasRef.current;
      if (!canvas || !stroke?.points || stroke.points.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const points = stroke.normalized
        ? stroke.points.map((point: { x: number; y: number }) => ({
            x: point.x * canvas.width,
            y: point.y * canvas.height,
          }))
        : stroke.points;
      ctx.beginPath();
      if (stroke.tool === "eraser") {
        ctx.strokeStyle = "#0d1117";
        ctx.lineWidth = (stroke.width || 3) * (stroke.normalized ? canvas.width : 1) * 4;
      } else {
        ctx.strokeStyle = stroke.tool === "highlighter"
          ? `${stroke.color || "#10b981"}66`
          : stroke.color || "#10b981";
        ctx.lineWidth = (stroke.width || 3) * (stroke.normalized ? canvas.width : 1) *
          (stroke.tool === "highlighter" ? 3 : 1);
      }
      ctx.lineCap = "round";
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    });

    const unsubClear = realtime.subscribe("whiteboard:clear", (data) => {
      if (data?.callId !== currentCallId) return;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      }
    });

    const unsubNotes = realtime.subscribe("collab:notes", (data) => {
      if (data?.callId === currentCallId && typeof data.content === "string") {
        setNotesText(data.content);
      }
    });

    return () => {
      cancelled = true;
      unsubSignal();
      unsubStroke();
      unsubClear();
      unsubNotes();
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      remoteStreamsRef.current.clear();
      queuedSignalsRef.current.clear();
      offeredPeerIdsRef.current.clear();
      createPeerConnectionRef.current = null;
      processPeerSignalRef.current = null;
      setRemoteStreams({});
      if (connectionTimeoutRef.current !== null) {
        window.clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
    };
  }, [isOpen, isAccepted, callId, currentUserId]);

  useEffect(() => {
    if (!isOpen || !isAccepted || !mediaReady || !callId || !createPeerConnectionRef.current) return;
    const participantIds = new Set(participants.map(({ id }) => id).filter((id) => id !== currentUserId));
    for (const [participantId, pc] of peerConnectionsRef.current) {
      if (!participantIds.has(participantId)) {
        pc.close();
        peerConnectionsRef.current.delete(participantId);
        remoteStreamsRef.current.delete(participantId);
        queuedSignalsRef.current.delete(participantId);
        offeredPeerIdsRef.current.delete(participantId);
      }
    }
    setRemoteStreams(Object.fromEntries(remoteStreamsRef.current));

    for (const participant of participants) {
      if (participant.id === currentUserId) continue;
      const pc = createPeerConnectionRef.current(participant);
      const queued = queuedSignalsRef.current.get(participant.id);
      if (queued?.length) {
        queuedSignalsRef.current.delete(participant.id);
        const orderedSignals = [
          ...queued.filter((signal) => !("candidate" in signal)),
          ...queued.filter((signal) => "candidate" in signal),
        ];
        void (async () => {
          for (const signal of orderedSignals) {
            await processPeerSignalRef.current?.(participant.id, signal);
          }
        })();
      }
      if (currentUserId < participant.id && !offeredPeerIdsRef.current.has(participant.id)) {
        offeredPeerIdsRef.current.add(participant.id);
        void pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            if (!pc.localDescription || !realtime.sendWebrtcSignal(callId, participant.id, pc.localDescription)) {
              throw new Error("Realtime signaling disconnected before the offer could be sent.");
            }
          })
          .catch((error: unknown) => {
            offeredPeerIdsRef.current.delete(participant.id);
            console.error("Could not start the peer connection.", error);
            setMediaError(error instanceof Error ? error.message : "Could not start the peer connection.");
          });
      }
    }
  }, [isOpen, isAccepted, mediaReady, callId, currentUserId, participants]);

  useEffect(() => {
    const peers = [...peerConnectionsRef.current.values()];
    if (
      !isOpen ||
      !isAccepted ||
      !mediaReady ||
      participants.length === 0 ||
      peers.length === 0 ||
      callConnectionState === "connected" ||
      callConnectionState === "failed"
    ) {
      return;
    }

    connectionTimeoutRef.current = window.setTimeout(() => {
      if (![...peerConnectionsRef.current.values()].some((pc) => pc.connectionState === "connected")) {
        setCallConnectionState("failed");
        setMediaError(turnServerConfiguredRef.current
          ? "Call network path failed. Check that the TURN relay and its firewall ports are reachable."
          : "This network needs a TURN relay. Configure TURN_URL and TURN_SHARED_SECRET on the server, then retry.");
      }
    }, 35_000);

    return () => {
      if (connectionTimeoutRef.current !== null) {
        window.clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
    };
  }, [isOpen, isAccepted, mediaReady, callConnectionState, callId, participants]);

  // Call duration counter
  useEffect(() => {
    if (!isOpen || !isAccepted) {
      setCallDuration(0);
      return;
    }
    soundFx.playCallConnect();
    const interval = window.setInterval(() => {
      setCallDuration((c) => c + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, isAccepted]);

  // Sample the active peer connection instead of displaying estimated demo metrics.
  useEffect(() => {
    if (!isOpen || !isAccepted) return;

    let cancelled = false;
    let previousBytesSent = 0;
    let previousStatsTime = 0;
    const interval = window.setInterval(() => {
      const peers = [...peerConnectionsRef.current.values()];
      const pc = peers.find((peer) => peer.connectionState === "connected") ?? peers[0];
      if (!pc) return;
      void pc.getStats().then((report) => {
        if (cancelled) return;
        let roundTripTimeMs = 0;
        let jitterMs = 0;
        let packetLossPercent = 0;
        let availableOutgoingBitrateBps = 0;
        let bytesSent = 0;
        let frameHeight = 0;
        let fps = 0;
        let receivedPackets = 0;
        let lostPackets = 0;
        const now = Date.now();

        report.forEach((stat) => {
          if (stat.type === "candidate-pair") {
            const pair = stat as RTCIceCandidatePairStats;
            if (pair.state === "succeeded" && pair.nominated) {
              roundTripTimeMs = (pair.currentRoundTripTime ?? 0) * 1000;
              availableOutgoingBitrateBps = pair.availableOutgoingBitrate ?? 0;
            }
          } else if (stat.type === "remote-inbound-rtp") {
            const inbound = stat as RTCStats & { roundTripTime?: number };
            roundTripTimeMs ||= (inbound.roundTripTime ?? 0) * 1000;
          } else if (stat.type === "inbound-rtp" && !stat.isRemote) {
            const inbound = stat as RTCInboundRtpStreamStats;
            jitterMs = Math.max(jitterMs, (inbound.jitter ?? 0) * 1000);
            receivedPackets += inbound.packetsReceived ?? 0;
            lostPackets += inbound.packetsLost ?? 0;
          } else if (stat.type === "outbound-rtp" && !stat.isRemote) {
            const outbound = stat as RTCOutboundRtpStreamStats;
            bytesSent += outbound.bytesSent ?? 0;
            frameHeight = Math.max(frameHeight, outbound.frameHeight ?? 0);
            fps = Math.max(fps, outbound.framesPerSecond ?? 0);
          }
        });

        if (!roundTripTimeMs && !jitterMs && !bytesSent && !receivedPackets && !lostPackets) return;
        const sendingBitrateBps = previousStatsTime && now > previousStatsTime
          ? Math.max(0, ((bytesSent - previousBytesSent) * 8 * 1000) / (now - previousStatsTime))
          : 0;
        previousBytesSent = bytesSent;
        previousStatsTime = now;
        packetLossPercent = receivedPackets + lostPackets > 0
          ? (lostPackets / (receivedPackets + lostPackets)) * 100
          : 0;
        const resolution = frameHeight >= 900
          ? "1080p"
          : frameHeight >= 650
            ? "720p"
            : frameHeight >= 420
              ? "480p"
              : frameHeight >= 300
                ? "360p"
                : frameHeight > 0
                  ? "240p"
                  : "Audio-Only";
        const sample: WebRtcTelemetrySample = {
          timestampMs: now,
          roundTripTimeMs: Math.round(roundTripTimeMs),
          jitterMs: Math.round(jitterMs),
          packetLossPercent,
          availableOutgoingBitrateBps,
          sendingBitrateBps: Math.round(sendingBitrateBps),
          resolution,
          fps: Math.round(fps),
        };
        setTelemetry(sample);
        setEstimate(estimatorRef.current.addSample(sample));
      }).catch((error: unknown) => {
        if (!cancelled) console.error("Could not read WebRTC connection statistics.", error);
      });
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen, isAccepted]);

  useEffect(() => {
    if (isOpen) setIsCameraOff(!isVideo);
  }, [isOpen, callId, isVideo]);

  function handleHangup() {
    if (callId) realtime.sendCallHangup(callId);
    soundFx.playCallEnd();
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    remoteStreamsRef.current.clear();
    setRemoteStreams({});
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    onHangup();
  }

  // Synchronize audio track mute/unmute
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted, mediaReady]);

  // Synchronize video track on/off
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !isCameraOff;
      });
    }
  }, [isCameraOff, mediaReady]);

  // Outgoing ringing audio chime on initiation
  useEffect(() => {
    if (!isOpen || !isInitiator || isAccepted) return;
    return soundFx.startCallRinging();
  }, [isOpen, isInitiator, isAccepted, callId]);

  // Toggle real screen sharing
  async function toggleScreenShare() {
    if (!isScreenSharing) {
      try {
        if (typeof navigator !== "undefined" && navigator.mediaDevices?.getDisplayMedia) {
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          const screenTrack = screenStream.getVideoTracks()[0];
          if (screenTrack) {
            screenTrackRef.current = screenTrack;
            for (const pc of peerConnectionsRef.current.values()) {
              const sender = pc.getSenders().find((s) => s.track?.kind === "video");
              if (sender) await sender.replaceTrack(screenTrack);
            }
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = screenStream;
            }
            screenTrack.onended = () => {
              stopScreenShare();
            };
            setIsScreenSharing(true);
          }
        }
      } catch (err) {
        console.warn("Screen share cancelled or not permitted:", err);
      }
    } else {
      stopScreenShare();
    }
  }

  async function stopScreenShare() {
    setIsScreenSharing(false);
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      for (const pc of peerConnectionsRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender && videoTrack) await sender.replaceTrack(videoTrack);
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    }
  }

  // Flip front/rear camera (especially for mobile)
  async function handleFlipCamera() {
    if (isScreenSharing) return;
    const nextMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextMode);
    try {
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextMode } });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack) {
          newVideoTrack.enabled = !isCameraOff;
          for (const pc of peerConnectionsRef.current.values()) {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            if (sender) await sender.replaceTrack(newVideoTrack);
          }
          if (localStreamRef.current) {
            const oldTracks = localStreamRef.current.getVideoTracks();
            oldTracks.forEach((t) => {
              t.stop();
              localStreamRef.current?.removeTrack(t);
            });
            localStreamRef.current.addTrack(newVideoTrack);
          }
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
        }
      }
    } catch (err) {
      console.warn("Camera flip notice:", err);
    }
  }

  // Whiteboard drawing handlers
  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    setIsDrawing(true);
    lastDrawPointRef.current = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
    ctx.stroke();

    if (callId) {
      realtime.sendWhiteboardStroke({
        points: [lastDrawPointRef.current ?? point, point],
        color: drawColor,
        width: strokeWidth / rect.width,
        tool: "pen",
        normalized: true,
      }, callId);
    }
    lastDrawPointRef.current = point;
  }

  function handleCanvasMouseUp() {
    setIsDrawing(false);
    lastDrawPointRef.current = null;
  }

  function handleCanvasTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    const touch = e.touches[0];
    if (!touch) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((touch.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((touch.clientY - rect.top) / rect.height) * canvas.height;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    setIsDrawing(true);
    lastDrawPointRef.current = {
      x: (touch.clientX - rect.left) / rect.width,
      y: (touch.clientY - rect.top) / rect.height,
    };
  }

  function handleCanvasTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const touch = e.touches[0];
    if (!touch) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: (touch.clientX - rect.left) / rect.width,
      y: (touch.clientY - rect.top) / rect.height,
    };
    ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
    ctx.stroke();

    if (callId) {
      realtime.sendWhiteboardStroke({
        points: [lastDrawPointRef.current ?? point, point],
        color: drawColor,
        width: strokeWidth / rect.width,
        tool: "pen",
        normalized: true,
      }, callId);
    }
    lastDrawPointRef.current = point;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (callId) realtime.sendWhiteboardClear(callId);
  }

  const mins = Math.floor(callDuration / 60);
  const secs = callDuration % 60;
  const timeFormatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const remoteParticipants = participants.filter(({ id }) => id !== currentUserId);
  const callTitle = remoteParticipants.length > 1
    ? `Group call · ${remoteParticipants.length + 1}`
    : remoteParticipants[0]?.displayName || peerName;
  const reachedCallLimit = remoteParticipants.length + pendingInviteIds.size >= 9;
  const matchingContacts = availableContacts
    .filter((contact) => {
      const query = inviteSearch.trim().toLowerCase();
      return !query ||
        contact.name.toLowerCase().includes(query) ||
        contact.peerPhone?.toLowerCase().includes(query);
    })
    .sort((a, b) => Number(Boolean(b.isOnline)) - Number(Boolean(a.isOnline)));
  const callStatusText = !isAccepted
    ? "Ringing"
    : mediaError
      ? "Media unavailable"
      : callConnectionState === "connected"
        ? "Connected"
        : callConnectionState === "failed"
          ? "Connection failed"
          : "Connecting";
  const isCallConnected = isAccepted && callConnectionState === "connected" && !mediaError;
  const networkStatusText = callConnectionState === "connected"
    ? "Connected"
    : callConnectionState === "failed"
      ? "Unstable"
      : "Checking";
  const networkBarCount = callConnectionState === "connected"
    ? 4
    : callConnectionState === "failed"
      ? 1
      : 2;

  const getRiskBadgeColor = (level: string) => {
    switch (level) {
      case "CRITICAL":
        return "#ef4444";
      case "HIGH":
        return "#f97316";
      case "ELEVATED":
        return "#eab308";
      default:
        return "#10b981";
    }
  };

  function renderCallStatusPlaceholder(avatar: string, displayName: string) {
    return (
      <div className="remote-participant-placeholder call-ringing-placeholder" role="status" aria-live="polite">
        <div className="call-ringing-avatar-wrap">
          <img src={getSafeAvatar(avatar, displayName)} alt="" />
        </div>
        <div className="call-ringing-copy">
          <h2>{isAccepted ? displayName : `Calling ${displayName}`}</h2>
          <p>
            {isAccepted
              ? callStatusText
              : "Ringing. The call starts when they answer."}
          </p>
        </div>
        {!isAccepted && (
          <div className="call-ringing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    );
  }

  if (isEnded) {
    return (
      <div className="call-modal-overlay call-ended-overlay" role="status" aria-live="polite">
        <div className="call-ended-card">
          <div className="call-ended-icon">
            <PhoneOff size={24} />
          </div>
          <h2>Call ended</h2>
          <p>{peerName}</p>
        </div>
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="call-modal-overlay">
      <div className={`call-container ${isVideo ? "is-video-call" : "is-voice-call"} ${showCollabDrawer ? "has-collab-drawer" : ""}`} role="dialog" aria-modal="true" aria-label={`${isVideo ? "Video" : "Voice"} call with ${callTitle}`}>
        {/* Top Floating Call Bar */}
        <div className="call-top-bar">
          <div className="call-peer-badge">
            <img className="call-peer-avatar" src={getSafeAvatar(peerAvatar, callTitle)} alt="" />
            <div className="call-peer-copy">
              <span className="peer-name">{callTitle}</span>
              <span className={`call-status-pill ${isCallConnected ? "is-connected" : callConnectionState === "failed" ? "is-failed" : ""}`}>
                <span
                  className={`live-call-dot ${isCallConnected ? "is-connected" : callConnectionState === "failed" ? "is-failed" : "is-ringing"}`}
                  aria-hidden="true"
                />
                {callStatusText}
              </span>
            </div>
          </div>

          <span className="call-timer" aria-label={`Call duration ${timeFormatted}`}>
            {timeFormatted}
          </span>

          <div className="call-badges-group call-telemetry-desktop-only">
            {/* Resolution & Quality indicator */}
            <div className="quality-pill">
              <span className="res-tag">{estimate.sampleCount > 0 ? telemetry.resolution : (isVideo ? "HD Video" : "HD Voice")}</span>
              <span className="fps-tag">{telemetry.fps > 0 ? `${telemetry.fps} FPS` : "60 FPS"}</span>
            </div>

            <div className={`call-network-status is-${callConnectionState}`} aria-label={`Network ${networkStatusText}`}>
              <span className="call-network-bars" aria-hidden="true">
                {[1, 2, 3, 4].map((bar) => (
                  <i key={bar} className={bar <= networkBarCount ? "is-active" : ""} />
                ))}
              </span>
              <span>{networkStatusText}</span>
            </div>

            <button
              type="button"
              className={`telemetry-toggle-btn ${showTelemetryHUD ? "is-active" : ""}`}
              onClick={() => setShowTelemetryHUD((prev) => !prev)}
              title="Toggle Live Connection Quality Stats"
            >
              <TrendingUp size={15} />
              <span>Stats</span>
            </button>
          </div>
        </div>

        {/* Predictive Call Recovery Live HUD Overlay */}
        {showTelemetryHUD && (
          <div className="predictive-hud-card">
            <div className="hud-header">
              <div className="hud-title">
                <ShieldCheck size={16} className="text-accent" />
                <span>Live Connection Quality</span>
              </div>
              <span className="hud-risk-label" style={{ color: getRiskBadgeColor(estimate.level) }}>
                <Activity size={14} />
                {estimate.level} · {estimate.score}%
              </span>
            </div>

            {/* Metric gauges grid */}
            <div className="hud-metrics-grid">
              <div className="metric-box">
                <span className="metric-name">RTT (Latency)</span>
                <span className={`metric-val ${estimate.sampleCount > 0 ? (telemetry.roundTripTimeMs > 200 ? "text-danger" : "text-success") : ""}`}>
                  {estimate.sampleCount > 0 ? `${telemetry.roundTripTimeMs} ms` : "—"}
                </span>
              </div>
              <div className="metric-box">
                <span className="metric-name">Jitter</span>
                <span className={`metric-val ${estimate.sampleCount > 0 ? (telemetry.jitterMs > 30 ? "text-warning" : "text-success") : ""}`}>
                  {estimate.sampleCount > 0 ? `${telemetry.jitterMs} ms` : "—"}
                </span>
              </div>
              <div className="metric-box">
                <span className="metric-name">Packet Loss</span>
                <span className={`metric-val ${estimate.sampleCount > 0 ? (telemetry.packetLossPercent > 2 ? "text-danger" : "text-success") : ""}`}>
                  {estimate.sampleCount > 0 ? `${telemetry.packetLossPercent.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="metric-box">
                <span className="metric-name">Bitrate Headroom</span>
                <span className="metric-val text-accent">
                  {telemetry.availableOutgoingBitrateBps > 0
                    ? `${(telemetry.availableOutgoingBitrateBps / 1_000_000).toFixed(1)} Mbps`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Proactive Adaptation Banner */}
            <div className="adaptation-banner">
              <AlertCircle size={15} style={{ color: getRiskBadgeColor(estimate.level) }} />
              <p className="adaptation-text">{estimate.adaptationAction}</p>
            </div>
          </div>
        )}

        {/* Video / Screen Stream Canvas Area */}
        <div className="call-viewport">
          <div className="remote-video-frame">
            <div className={`remote-participants-grid ${remoteParticipants.length > 1 ? "is-group" : ""}`}>
              {remoteParticipants.length === 0 && (
                renderCallStatusPlaceholder(peerAvatar, callTitle)
              )}
              {remoteParticipants.map((participant) => {
                const stream = remoteStreams[participant.id];
                const hasVideo = isVideo && Boolean(stream?.getVideoTracks().length);
                return (
                  <div className="remote-participant-tile" key={participant.id}>
                    {hasVideo ? (
                      <video
                        autoPlay
                        playsInline
                        className="remote-stream-bg"
                        ref={(element) => {
                          if (element && stream && element.srcObject !== stream) element.srcObject = stream;
                        }}
                      />
                    ) : (
                      remoteParticipants.length === 1
                        ? renderCallStatusPlaceholder(participant.avatar, callTitle)
                        : (
                          <div className="remote-participant-placeholder">
                            <img src={getSafeAvatar(participant.avatar, participant.displayName)} alt="" />
                            <span>{stream ? (isVideo ? "Camera off" : "Voice connected") : "Connecting..."}</span>
                          </div>
                        )
                    )}
                    {stream && !hasVideo && <audio autoPlay ref={(element) => {
                      if (element && element.srcObject !== stream) element.srcObject = stream;
                    }} />}
                    <span className="remote-participant-name">
                      <Volume2 size={13} />
                      {participant.displayName}
                    </span>
                  </div>
                );
              })}
            </div>

            {mediaError && (
              <div className="call-media-error" role="alert">
                <p>{mediaError}</p>
              </div>
            )}

            {/* Self Video PIP (Picture In Picture) */}
            {isVideo && <div className="self-video-pip">
              <div className="pip-video-feed" style={{ position: "relative", overflow: "hidden" }}>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    display: hasLocalMedia && (!isCameraOff || isScreenSharing) ? "block" : "none",
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    position: "absolute",
                    inset: 0,
                  }}
                />
                {(!hasLocalMedia || (isCameraOff && !isScreenSharing)) && (
                  <div className="pip-camera-off" aria-label={isScreenSharing ? "Sharing your screen" : "Camera off"}>
                    <span className="pip-camera-off-icon">
                      {isScreenSharing ? <Share2 size={22} /> : <VideoOff size={22} />}
                    </span>
                    <span>{isScreenSharing ? "Screen sharing" : "Camera off"}</span>
                  </div>
                )}
                <div className="pip-label">
                  {isScreenSharing ? "You · Sharing" : isCameraOff || !hasLocalMedia ? "You · Camera off" : "You"}
                </div>
                {isMuted && <span className="pip-muted-icon" style={{ zIndex: 3 }}><MicOff size={12} /></span>}
              </div>
            </div>}

          </div>

          {/* In-Call Live Collaboration Drawer */}
          {showCollabDrawer && (
            <aside className="in-call-collab-drawer">
              <div className="collab-drawer-tabs">
                <button
                  type="button"
                  className={`collab-tab ${collabTab === "chat" ? "is-active" : ""}`}
                  onClick={() => setCollabTab("chat")}
                >
                  <MessageSquare size={15} />
                  <span>Live Chat</span>
                </button>
                <button
                  type="button"
                  className={`collab-tab ${collabTab === "whiteboard" ? "is-active" : ""}`}
                  onClick={() => setCollabTab("whiteboard")}
                >
                  <Edit3 size={15} />
                  <span>Whiteboard</span>
                </button>
                <button
                  type="button"
                  className={`collab-tab ${collabTab === "notes" ? "is-active" : ""}`}
                  onClick={() => setCollabTab("notes")}
                >
                  <CheckSquare size={15} />
                  <span>Shared Notes</span>
                </button>
              </div>

              <div className="collab-drawer-body">
                {collabTab === "chat" && (
                  <div className="incall-chat-pane">
                    <div className="incall-chat-attendees">
                      <span className="attendees-count">Messages are only visible during this call.</span>
                    </div>
                    <div className="incall-messages-stream" role="log" aria-live="polite">
                      {callChatMessages.length === 0 && (
                        <div className="incall-chat-empty">No messages yet. Send a message to the call.</div>
                      )}
                      {callChatMessages.map((message) => {
                        const isMe = message.senderId === currentUserId;
                        return (
                          <div key={message.id} className={`incall-msg-row ${isMe ? "is-me" : "is-peer"}`}>
                            {!isMe && <span className="incall-msg-sender">{message.senderName}</span>}
                            <div className="incall-msg-bubble">{message.text}</div>
                            <span className="incall-msg-time">
                              {new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        );
                      })}
                      <div ref={callChatMessagesEndRef} />
                    </div>
                    {callChatError && <p className="incall-chat-error" role="alert">{callChatError}</p>}
                    <form className="incall-chat-composer" onSubmit={sendInCallChat}>
                      <input
                        className="incall-chat-input"
                        value={callChatDraft}
                        onChange={(event) => {
                          setCallChatDraft(event.target.value.slice(0, 1000));
                          setCallChatError(null);
                        }}
                        maxLength={1000}
                        placeholder="Message call participants..."
                        aria-label="Message call participants"
                        disabled={!isAccepted}
                      />
                      <button
                        type="submit"
                        className="incall-send-btn"
                        aria-label="Send message"
                        disabled={!isAccepted || !callChatDraft.trim()}
                      >
                        <Send size={16} />
                      </button>
                    </form>
                  </div>
                )}

                {collabTab === "whiteboard" && (
                  <div className="whiteboard-pane">
                    <div className="whiteboard-pane-header">
                      <div>
                        <h3>Shared whiteboard</h3>
                        <p>Sketch ideas together during this call.</p>
                      </div>
                      <span className="whiteboard-live-status">
                        <span />
                        Live
                      </span>
                    </div>
                    <div className="whiteboard-tools">
                      <div className="whiteboard-color-group">
                        <span className="whiteboard-tool-label">Pen color</span>
                        <div className="color-swatches" role="group" aria-label="Pen color">
                          {[
                            { color: "#10b981", label: "Green" },
                            { color: "#6366f1", label: "Indigo" },
                            { color: "#f43f5e", label: "Pink" },
                            { color: "#fbbf24", label: "Yellow" },
                            { color: "#ffffff", label: "White" },
                          ].map(({ color, label }) => (
                            <button
                              key={color}
                              type="button"
                              className={`color-btn ${drawColor === color ? "is-selected" : ""}`}
                              style={{ backgroundColor: color }}
                              onClick={() => setDrawColor(color)}
                              title={`Use ${label.toLowerCase()} pen`}
                              aria-label={`Use ${label.toLowerCase()} pen`}
                              aria-pressed={drawColor === color}
                            />
                          ))}
                        </div>
                      </div>
                      <button type="button" className="tool-btn" onClick={clearCanvas} title="Clear whiteboard">
                        <Trash2 size={15} />
                        <span>Clear</span>
                      </button>
                    </div>

                    <div className="whiteboard-canvas-frame">
                      <canvas
                        ref={canvasRef}
                        width={380}
                        height={320}
                        className="whiteboard-canvas"
                        aria-label="Shared whiteboard canvas"
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseUp}
                        onTouchStart={handleCanvasTouchStart}
                        onTouchMove={handleCanvasTouchMove}
                        onTouchEnd={handleCanvasMouseUp}
                      />
                    </div>
                    <p className="canvas-hint">Everyone in the call can see your strokes.</p>
                  </div>
                )}

                {collabTab === "notes" && (
                  <div className="notes-pane">
                    <div className="notes-pane-header">
                      <div>
                        <h3>Shared notes</h3>
                        <p>Keep decisions and action items in one place.</p>
                      </div>
                      <span className="notes-live-status">Live sync</span>
                    </div>
                    <textarea
                      className="notes-textarea"
                      value={notesText}
                      onChange={(e) => {
                        const content = e.target.value;
                        setNotesText(content);
                        if (notesSyncTimerRef.current !== null) window.clearTimeout(notesSyncTimerRef.current);
                        notesSyncTimerRef.current = window.setTimeout(
                          () => {
                            if (callId) realtime.sendCollabNotes(content, callId);
                          },
                          120,
                        );
                      }}
                      rows={12}
                      placeholder="Write notes, decisions, or action items..."
                      aria-label="Shared call notes"
                    />
                    <p className="notes-hint">Your edits sync with everyone in this call.</p>
                  </div>
                )}

              </div>
            </aside>
          )}
        </div>

        {showAddPerson && (
          <div className="call-add-person-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowAddPerson(false);
          }}>
            <section className="call-add-person-modal" role="dialog" aria-modal="true" aria-labelledby="call-add-person-title">
              <header className="call-add-person-header">
                <div>
                  <h2 id="call-add-person-title">Add people</h2>
                  <p>{remoteParticipants.length + 1 + pendingInviteIds.size} of 10 participants</p>
                </div>
                <button type="button" className="call-add-person-close" onClick={() => setShowAddPerson(false)} aria-label="Close">
                  <X size={20} />
                </button>
              </header>
              <label className="call-add-person-search">
                <Search size={17} />
                <input
                  autoFocus
                  value={inviteSearch}
                  onChange={(event) => setInviteSearch(event.target.value)}
                  placeholder="Search contacts"
                  aria-label="Search contacts to invite"
                />
              </label>
              {callInviteError && <p className="call-add-person-error" role="alert">{callInviteError}</p>}
              <div className="call-add-person-list">
                {matchingContacts.map((contact) => {
                  const contactId = contact.peerUserId;
                  const inCall = Boolean(contactId && remoteParticipants.some(({ id }) => id === contactId));
                  const invited = Boolean(contactId && pendingInviteIds.has(contactId));
                  const status = inCall ? "In call" : invited ? "Invited" : contact.isOnline ? "Online" : "Offline";
                  const disabled = !isAccepted || inCall || invited || !contact.isOnline || reachedCallLimit;
                  return (
                    <div className="call-add-person-row" key={contact.id}>
                      <img src={getSafeAvatar(contact.avatar, contact.name)} alt="" />
                      <div className="call-add-person-copy">
                        <strong>{contact.name}</strong>
                        <span>{status}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => inviteContact(contact)}
                        disabled={disabled}
                        aria-label={`Invite ${contact.name}`}
                      >
                        {invited ? "Invited" : inCall ? "In call" : "Add"}
                      </button>
                    </div>
                  );
                })}
                {matchingContacts.length === 0 && <p className="call-add-person-empty">No matching contacts.</p>}
              </div>
            </section>
          </div>
        )}

        {/* Bottom Call Control Action Dock */}
        <div className="call-controls-dock">
          {/* Microphone toggle */}
          <div className="call-control-item">
            <button
              type="button"
              className={`control-circle-btn ${isMuted ? "is-active-danger" : ""}`}
              onClick={() => setIsMuted((prev) => !prev)}
              title={isMuted ? "Unmute microphone" : "Mute microphone"}
              aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={isMuted}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <span>{isMuted ? "Unmute" : "Mute"}</span>
          </div>

          {/* Camera toggle */}
          {isVideo && (
            <div className="call-control-item">
              <button
                type="button"
                className={`control-circle-btn ${isCameraOff ? "is-active-danger" : ""}`}
                onClick={() => setIsCameraOff((prev) => !prev)}
                title={isCameraOff ? "Turn on camera" : "Turn off camera"}
                aria-label={isCameraOff ? "Turn on camera" : "Turn off camera"}
                aria-pressed={isCameraOff}
              >
                {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>
              <span>Camera</span>
            </div>
          )}

          <div className="call-control-item">
            <button
              type="button"
              className="control-circle-btn"
              onClick={() => {
                setShowAddPerson(true);
                setCallInviteError(null);
              }}
              title="Add person to call"
              aria-label="Add person to call"
              disabled={!isAccepted || reachedCallLimit}
            >
              <UserPlus size={20} />
            </button>
            <span>Add</span>
          </div>

          {/* Flip Camera (Front/Back) */}
          {isVideo && !isCameraOff && (
            <div className="call-control-item">
              <button
                type="button"
                className="control-circle-btn"
                onClick={handleFlipCamera}
                title={`Switch Camera (Currently: ${facingMode})`}
                aria-label={`Switch camera, currently ${facingMode}`}
              >
                <RefreshCw size={20} />
              </button>
              <span>Flip</span>
            </div>
          )}

          {/* Screen Share */}
          <div className="call-control-item">
            <button
              type="button"
              className={`control-circle-btn ${isScreenSharing ? "is-active-accent" : ""}`}
              onClick={toggleScreenShare}
              title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
              aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
              aria-pressed={isScreenSharing}
            >
              <Share2 size={20} />
            </button>
            <span>Share</span>
          </div>

          {/* In-Call Collaboration Drawer Toggle */}
          <div className="call-control-item">
            <button
              type="button"
              className={`control-circle-btn ${showCollabDrawer ? "is-active-accent" : ""}`}
              onClick={() => setShowCollabDrawer((prev) => !prev)}
              title="Open Live Whiteboard & Notes Drawer"
              aria-label={showCollabDrawer ? "Close collaboration panel" : "Open collaboration panel"}
              aria-pressed={showCollabDrawer}
            >
              <Layers size={20} />
            </button>
            <span>Collab</span>
          </div>

          {/* End Call / Hangup */}
          <button
            type="button"
            className="control-hangup-pill"
            onClick={handleHangup}
            title="End Call"
            aria-label="End call"
          >
            <PhoneOff size={18} />
            <span>End Call</span>
          </button>
        </div>
      </div>
    </div>
  );
}
