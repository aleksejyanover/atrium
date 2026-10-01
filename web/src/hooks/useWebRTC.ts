/**
 * 1:1 WebRTC call logic for Atrium (SPEC §4).
 *
 * Signaling (socket.io, server is relay only):
 *   caller → call:invite {calleeId, kind, channelId?} → ack {ok, callId}
 *   caller → rtc:sdp {callId, to, sdp}   (offer)
 *   callee → call:accept → rtc:sdp (answer); both → rtc:ice {callId, to, candidate}
 *   call:state {callId, muted, cameraOff}; end via call:leave
 *
 * State machine: idle | outgoing | incoming | connecting | active | ended
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { emitAck } from '../socket';
import { isRecord, unwrapUser } from '../types';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

export type CallKind = 'video' | 'audio';

export interface CallPeer {
  id: string;
  name: string;
  color: string;
}

export interface CallState {
  callId: string;
  kind: CallKind;
  peer: CallPeer;
  channelId?: string;
  incoming: boolean;
}

export type ConnStatus = 'connecting' | 'connected' | 'lost';

export type EndReason = 'reject' | 'ended' | null;

export interface WebRTCApi {
  phase: CallPhase;
  call: CallState | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  peerMuted: boolean;
  peerCameraOff: boolean;
  connStatus: ConnStatus;
  endReason: EndReason;
  startCall: (peer: CallPeer, kind: CallKind, channelId?: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

async function acquireMedia(kind: CallKind): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) throw new Error('media-unsupported');
  return md.getUserMedia({
    audio: true,
    video: kind === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
  });
}

function peerFrom(raw: unknown): CallPeer {
  if (typeof raw === 'string') {
    return { id: raw, name: 'Собеседник', color: '#7C6CF6' };
  }
  if (isRecord(raw)) {
    const u = unwrapUser(raw);
    if (u) return { id: u.id, name: u.displayName || u.username, color: u.avatarColor };
    if (typeof raw.id === 'string') {
      return {
        id: raw.id,
        name:
          typeof raw.displayName === 'string' && raw.displayName
            ? raw.displayName
            : typeof raw.username === 'string'
              ? raw.username
              : 'Собеседник',
        color: typeof raw.avatarColor === 'string' ? raw.avatarColor : '#7C6CF6',
      };
    }
  }
  return { id: '', name: 'Собеседник', color: '#7C6CF6' };
}

type Notify = (text: string, kind?: 'info' | 'success' | 'error') => void;

export function useWebRTC(socket: Socket | null, notify: Notify): WebRTCApi {
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [call, setCall] = useState<CallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [peerMuted, setPeerMuted] = useState(false);
  const [peerCameraOff, setPeerCameraOff] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>('connecting');
  const [endReason, setEndReason] = useState<EndReason>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const callRef = useRef<CallState | null>(null);
  const phaseRef = useRef<CallPhase>('idle');
  const pendingSdpRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const mutedRef = useRef(false);
  const cameraOffRef = useRef(false);
  const endedTimerRef = useRef<number | null>(null);

  const notifyRef = useRef<Notify>(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const go = useCallback((p: CallPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /** Full teardown of media/pc/call, back to idle. */
  const hardReset = useCallback(() => {
    if (endedTimerRef.current !== null) {
      window.clearTimeout(endedTimerRef.current);
      endedTimerRef.current = null;
    }
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingSdpRef.current = null;
    pendingIceRef.current = [];
    mutedRef.current = false;
    cameraOffRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
    setPeerMuted(false);
    setPeerCameraOff(false);
    setConnStatus('connecting');
    setEndReason(null);
    setCall(null);
    callRef.current = null;
    go('idle');
  }, [go]);

  /** Teardown that briefly shows an "ended" card with a reason, then idle. */
  const endWithReason = useCallback(
    (reason: Exclude<EndReason, null>) => {
      const pc = pcRef.current;
      pcRef.current = null;
      if (pc) {
        pc.onconnectionstatechange = null;
        pc.onicecandidate = null;
        pc.ontrack = null;
        try {
          pc.close();
        } catch {
          /* already closed */
        }
      }
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      pendingSdpRef.current = null;
      pendingIceRef.current = [];
      mutedRef.current = false;
      cameraOffRef.current = false;
      setLocalStream(null);
      setRemoteStream(null);
      setMuted(false);
      setCameraOff(false);
      setPeerMuted(false);
      setPeerCameraOff(false);
      setConnStatus('connecting');
      setCall(null);
      callRef.current = null;
      setEndReason(reason);
      go('ended');
      if (endedTimerRef.current !== null) window.clearTimeout(endedTimerRef.current);
      endedTimerRef.current = window.setTimeout(() => {
        endedTimerRef.current = null;
        setEndReason(null);
        go('idle');
      }, 2600);
    },
    [go],
  );

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        /* candidate rejected — non fatal */
      }
    }
  }, []);

  const applyIce = useCallback(
    async (candidate: RTCIceCandidateInit) => {
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingIceRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* non fatal */
      }
    },
    [],
  );

  /** Applies a remote offer (→ answer) or answer. Buffers if no pc yet. */
  const applySdp = useCallback(
    async (sdp: RTCSessionDescriptionInit) => {
      const c = callRef.current;
      if (!c) return;
      const pc = pcRef.current;
      if (!pc) {
        pendingSdpRef.current = sdp;
        return;
      }
      try {
        if (sdp.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await flushIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket?.emit('rtc:sdp', {
            callId: c.callId,
            to: c.peer.id,
            sdp: { type: answer.type, sdp: answer.sdp ?? '' },
          });
        } else if (sdp.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await flushIce(pc);
        }
      } catch {
        /* renegotiation race — ignore */
      }
    },
    [flushIce, socket],
  );

  const createPc = useCallback(
    (c: CallState): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc.onicecandidate = (e) => {
        if (e.candidate && socket) {
          socket.emit('rtc:ice', {
            callId: c.callId,
            to: c.peer.id,
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.ontrack = (e) => {
        setRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
      };
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        const s = pc.connectionState;
        if (s === 'connected') {
          setConnStatus('connected');
          if (phaseRef.current === 'connecting' || phaseRef.current === 'outgoing') go('active');
        } else if (s === 'disconnected' || s === 'failed' || s === 'closed') {
          setConnStatus('lost');
        } else {
          setConnStatus('connecting');
        }
      };
      return pc;
    },
    [go, socket],
  );

  /* ---------------- actions ---------------- */

  const startCall = useCallback(
    async (peer: CallPeer, kind: CallKind, channelId?: string) => {
      if (!socket) {
        notifyRef.current('Нет соединения с сервером', 'error');
        return;
      }
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'ended') {
        notifyRef.current('Вы уже находитесь в звонке', 'error');
        return;
      }
      if (endedTimerRef.current !== null) {
        window.clearTimeout(endedTimerRef.current);
        endedTimerRef.current = null;
      }
      const c: CallState = { callId: '', kind, peer, channelId, incoming: false };
      callRef.current = c;
      setCall(c);
      setEndReason(null);
      go('outgoing');

      let stream: MediaStream;
      try {
        stream = await acquireMedia(kind);
      } catch {
        notifyRef.current('Нет доступа к микрофону или камере', 'error');
        hardReset();
        return;
      }
      localRef.current = stream;
      setLocalStream(stream);

      const res = await emitAck<{ ok?: boolean; callId?: string; error?: string }>(
        socket,
        'call:invite',
        { calleeId: peer.id, kind, channelId },
      );
      if (!res.ok || typeof res.callId !== 'string') {
        notifyRef.current(res.error ?? 'Не удалось начать звонок', 'error');
        hardReset();
        return;
      }
      const invited: CallState = { ...c, callId: res.callId };
      callRef.current = invited;
      setCall(invited);

      const pc = createPc(invited);
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('rtc:sdp', {
          callId: invited.callId,
          to: invited.peer.id,
          sdp: { type: offer.type ?? 'offer', sdp: offer.sdp ?? '' },
        });
      } catch {
        notifyRef.current('Не удалось установить соединение', 'error');
        hardReset();
      }
    },
    [createPc, go, hardReset, socket],
  );

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (!c || !socket || phaseRef.current !== 'incoming') return;
    const res = await emitAck(socket, 'call:accept', { callId: c.callId });
    if (!res.ok) {
      notifyRef.current(res.error ?? 'Не удалось принять вызов', 'error');
      hardReset();
      return;
    }
    go('connecting');
    let stream: MediaStream;
    try {
      stream = await acquireMedia(c.kind);
    } catch {
      notifyRef.current('Нет доступа к микрофону или камере', 'error');
      void emitAck(socket, 'call:leave', { callId: c.callId });
      hardReset();
      return;
    }
    localRef.current = stream;
    setLocalStream(stream);
    const pc = createPc(c);
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    const buffered = pendingSdpRef.current;
    pendingSdpRef.current = null;
    if (buffered) await applySdp(buffered);
    await flushIce(pc);
  }, [applySdp, createPc, flushIce, go, hardReset, socket]);

  const rejectCall = useCallback(async () => {
    const c = callRef.current;
    if (!c || phaseRef.current !== 'incoming') return;
    if (socket && c.callId) await emitAck(socket, 'call:reject', { callId: c.callId });
    hardReset();
  }, [hardReset, socket]);

  const hangUp = useCallback(async () => {
    const c = callRef.current;
    if (!c) return;
    if (socket && c.callId) await emitAck(socket, 'call:leave', { callId: c.callId });
    hardReset();
  }, [hardReset, socket]);

  const toggleMute = useCallback(() => {
    const stream = localRef.current;
    if (!stream) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
    const c = callRef.current;
    if (c && c.callId) {
      socket?.emit('call:state', {
        callId: c.callId,
        muted: next,
        cameraOff: cameraOffRef.current,
      });
    }
  }, [socket]);

  const toggleCamera = useCallback(() => {
    const stream = localRef.current;
    if (!stream || stream.getVideoTracks().length === 0) return;
    const next = !cameraOffRef.current;
    cameraOffRef.current = next;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    setCameraOff(next);
    const c = callRef.current;
    if (c && c.callId) {
      socket?.emit('call:state', {
        callId: c.callId,
        muted: mutedRef.current,
        cameraOff: next,
      });
    }
  }, [socket]);

  const switchCamera = useCallback(async () => {
    const pc = pcRef.current;
    const stream = localRef.current;
    if (!pc || !stream) return;
    const current = stream.getVideoTracks()[0];
    if (!current) return;
    const facing = current.getSettings().facingMode === 'environment' ? 'user' : 'environment';
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
      const track = fresh.getVideoTracks()[0];
      if (!track) return;
      track.enabled = !cameraOffRef.current;
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
      stream.removeTrack(current);
      current.stop();
      stream.addTrack(track);
      setLocalStream(new MediaStream(stream));
    } catch {
      notifyRef.current('Не удалось переключить камеру', 'error');
    }
  }, []);

  /* ---------------- socket subscriptions ---------------- */

  useEffect(() => {
    if (!socket) return;

    /** Match an event to our single active call (tolerates pre-ack `callId:''`). */
    const sameCall = (p: unknown): boolean => {
      if (!isRecord(p)) return false;
      const c = callRef.current;
      if (!c) return false;
      if (c.callId === '') return true; // our own invite ack has not resolved yet
      return c.callId === p.callId;
    };

    const onIncoming = (p: unknown) => {
      if (!isRecord(p) || typeof p.callId !== 'string') return;
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'ended') return; // already busy
      if (endedTimerRef.current !== null) {
        window.clearTimeout(endedTimerRef.current);
        endedTimerRef.current = null;
      }
      const c: CallState = {
        callId: p.callId,
        kind: p.kind === 'audio' ? 'audio' : 'video',
        peer: peerFrom(p.from),
        channelId: typeof p.channelId === 'string' ? p.channelId : undefined,
        incoming: true,
      };
      callRef.current = c;
      setCall(c);
      setEndReason(null);
      setPeerMuted(false);
      setPeerCameraOff(false);
      go('incoming');
    };

    const onAccepted = (p: unknown) => {
      if (!sameCall(p)) return;
      if (phaseRef.current === 'outgoing') go('connecting');
    };

    const onRejected = (p: unknown) => {
      if (!sameCall(p)) return;
      if (phaseRef.current === 'outgoing') endWithReason('reject');
      else hardReset();
    };

    const onLeft = (p: unknown) => {
      if (!sameCall(p)) return;
      if (phaseRef.current === 'incoming' || phaseRef.current === 'outgoing') hardReset();
      else endWithReason('ended');
    };

    const onState = (p: unknown) => {
      if (!sameCall(p) || !isRecord(p)) return;
      setPeerMuted(p.muted === true);
      setPeerCameraOff(p.cameraOff === true);
    };

    const onSdp = (p: unknown) => {
      if (!sameCall(p) || !isRecord(p)) return;
      if (isRecord(p.sdp) && typeof p.sdp.type === 'string') {
        void applySdp(p.sdp as unknown as RTCSessionDescriptionInit);
      }
    };

    const onIce = (p: unknown) => {
      if (!sameCall(p) || !isRecord(p)) return;
      if (isRecord(p.candidate)) {
        void applyIce(p.candidate as RTCIceCandidateInit);
      }
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:rejected', onRejected);
    socket.on('call:left', onLeft);
    socket.on('call:state', onState);
    socket.on('rtc:sdp', onSdp);
    socket.on('rtc:ice', onIce);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:rejected', onRejected);
      socket.off('call:left', onLeft);
      socket.off('call:state', onState);
      socket.off('rtc:sdp', onSdp);
      socket.off('rtc:ice', onIce);
    };
  }, [applyIce, applySdp, endWithReason, go, hardReset, socket]);

  /* unmount: release media without touching state */
  useEffect(() => {
    return () => {
      if (endedTimerRef.current !== null) window.clearTimeout(endedTimerRef.current);
      pcRef.current?.close();
      pcRef.current = null;
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
    };
  }, []);

  return {
    phase,
    call,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    peerMuted,
    peerCameraOff,
    connStatus,
    endReason,
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    toggleCamera,
    switchCamera,
  };
}
