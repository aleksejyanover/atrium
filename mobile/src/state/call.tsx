import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  mediaDevices,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';
import type { MediaStream } from 'react-native-webrtc';

import { CallKind, CallStatus, User } from '@/lib/types';
import {
  AckResult,
  IceCandidatePayload,
  SessionDescriptionPayload,
  unwrapUser,
} from '@/lib/socket-events';
import { useSocket } from '@/state/socket';
import { useToast } from '@/state/toast';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function toIceCandidate(payload: IceCandidatePayload): RTCIceCandidate {
  return new RTCIceCandidate({
    candidate: payload.candidate ?? undefined,
    sdpMid: payload.sdpMid ?? undefined,
    sdpMLineIndex: payload.sdpMLineIndex ?? undefined,
  });
}

interface CallState {
  status: CallStatus;
  callId: string | null;
  kind: CallKind;
  peer: User | null;
  channelId?: string;
  isCaller: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micMuted: boolean;
  cameraOff: boolean;
  peerMuted: boolean;
  peerCameraOff: boolean;
}

const IDLE: CallState = {
  status: 'idle',
  callId: null,
  kind: 'video',
  peer: null,
  channelId: undefined,
  isCaller: false,
  localStream: null,
  remoteStream: null,
  micMuted: false,
  cameraOff: false,
  peerMuted: false,
  peerCameraOff: false,
};

interface CallContextValue extends CallState {
  startCall(peer: User, kind: CallKind, channelId?: string): Promise<void>;
  acceptCall(): Promise<void>;
  rejectCall(): void;
  hangUp(): void;
  toggleMute(): void;
  toggleCamera(): void;
  flipCamera(): void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const { show } = useToast();
  const [state, setState] = useState<CallState>(IDLE);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const statusRef = useRef<CallStatus>('idle');
  const stateRef = useRef<CallState>(state);
  const pendingIceRef = useRef<IceCandidatePayload[]>([]);
  const pendingSdpRef = useRef<{
    callId: string;
    from: string | null;
    sdp: SessionDescriptionPayload;
  } | null>(null);

  useEffect(() => {
    stateRef.current = state;
    statusRef.current = state.status;
  }, [state]);

  /** socket.io emit with ack (SPEC: every client→server event uses an ack). */
  const rpc = useCallback(
    (event: string, payload: unknown): Promise<AckResult & { callId?: string }> =>
      new Promise((resolve) => {
        if (!socket) {
          resolve({ error: 'Нет соединения с сервером' });
          return;
        }
        const emitter = socket as unknown as {
          emit(event: string, payload: unknown, cb: (res: AckResult & { callId?: string }) => void): void;
        };
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({ error: 'Сервер не отвечает' });
          }
        }, 12000);
        emitter.emit(event, payload, (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(res ?? {});
        });
      }),
    [socket],
  );

  const teardown = useCallback(() => {
    try {
      pcRef.current?.close();
    } catch {
      // ignore
    }
    pcRef.current = null;
    const local = localRef.current;
    if (local) {
      for (const track of local.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
    }
    localRef.current = null;
    pendingIceRef.current = [];
    pendingSdpRef.current = null;
    callIdRef.current = null;
    peerIdRef.current = null;
    statusRef.current = 'idle';
    setState(IDLE);
  }, []);

  const getMedia = useCallback(async (kind: CallKind): Promise<MediaStream> => {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video' ? { facingMode: 'user' } : false,
    });
    return stream;
  }, []);

  const flushIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(toIceCandidate(candidate));
      } catch {
        // a bad candidate must not break the call
      }
    }
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event: any) => {
      const candidate = event?.candidate;
      if (!candidate) return;
      const callId = callIdRef.current;
      const to = peerIdRef.current;
      if (!callId || !to) return;
      void rpc('rtc:ice', {
        callId,
        to,
        candidate: candidate.toJSON ? candidate.toJSON() : candidate,
      });
    };

    pc.ontrack = (event: any) => {
      const stream: MediaStream | undefined = event?.streams?.[0];
      if (!stream) return;
      setState((prev) => ({
        ...prev,
        remoteStream: stream,
        status: prev.status === 'idle' || prev.status === 'incoming' ? prev.status : 'active',
      }));
    };

    pc.onconnectionstatechange = () => {
      const connection = pc.connectionState;
      if (connection === 'connected') {
        setState((prev) =>
          prev.status === 'idle' || prev.status === 'incoming'
            ? prev
            : { ...prev, status: 'active' },
        );
      } else if (connection === 'failed') {
        show('Соединение потеряно');
        void rpc('call:leave', { callId: callIdRef.current ?? '' });
        teardown();
      }
    };

    return pc;
  }, [rpc, show, teardown]);

  /** Apply a remote SDP; queue it when the peer connection is not ready yet. */
  const handleRemoteSdp = useCallback(
    async (callId: string, from: string | null, sdp: SessionDescriptionPayload) => {
      if (callId !== callIdRef.current) return;
      if (!peerIdRef.current && from) peerIdRef.current = from;
      const pc = pcRef.current;
      if (!pc) {
        pendingSdpRef.current = { callId, from, sdp };
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch {
        return;
      }
      await flushIce();
      if (sdp.type === 'offer') {
        try {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          void rpc('rtc:sdp', {
            callId,
            to: peerIdRef.current ?? from,
            sdp: { type: answer?.type ?? 'answer', sdp: answer?.sdp ?? '' },
          });
        } catch {
          show('Не удалось согласовать соединение');
        }
      }
    },
    [flushIce, rpc, show],
  );

  // ---- socket listeners -------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onIncoming = (payload: {
      callId: string;
      from: unknown;
      kind: CallKind;
      channelId?: string;
    }) => {
      if (statusRef.current !== 'idle') return;
      const peer = unwrapUser(payload.from as never);
      callIdRef.current = payload.callId;
      peerIdRef.current = peer?.id ?? null;
      statusRef.current = 'incoming';
      setState({
        ...IDLE,
        status: 'incoming',
        callId: payload.callId,
        kind: payload.kind,
        peer,
        channelId: payload.channelId,
        isCaller: false,
      });
    };

    const onAccepted = (payload: { callId: string }) => {
      if (payload.callId !== callIdRef.current) return;
      setState((prev) =>
        prev.status === 'outgoing' ? { ...prev, status: 'connecting' } : prev,
      );
    };

    const onRejected = (payload: { callId: string }) => {
      if (payload.callId !== callIdRef.current) return;
      teardown();
      Alert.alert('Звонок', 'Собеседник отклонил вызов');
    };

    const onLeft = (payload: { callId: string }) => {
      if (payload.callId !== callIdRef.current) return;
      teardown();
      show('Звонок завершён');
    };

    const onState = (payload: { callId: string; muted: boolean; cameraOff: boolean }) => {
      if (payload.callId !== callIdRef.current) return;
      setState((prev) => ({ ...prev, peerMuted: payload.muted, peerCameraOff: payload.cameraOff }));
    };

    const onSdp = (payload: {
      callId: string;
      from: unknown;
      sdp: SessionDescriptionPayload;
    }) => {
      if (payload.callId !== callIdRef.current) return;
      const from =
        typeof payload.from === 'string'
          ? payload.from
          : (unwrapUser(payload.from as never)?.id ?? null);
      void handleRemoteSdp(payload.callId, from, payload.sdp);
    };

    const onIce = (payload: {
      callId: string;
      from: unknown;
      candidate: IceCandidatePayload;
    }) => {
      if (payload.callId !== callIdRef.current) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingIceRef.current.push(payload.candidate);
        return;
      }
      void (async () => {
        try {
          await pc.addIceCandidate(toIceCandidate(payload.candidate));
        } catch {
          // ignore broken candidates
        }
      })();
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
  }, [socket, handleRemoteSdp, teardown, show]);

  // ---- public actions ---------------------------------------------------
  const startCall = useCallback(
    async (peer: User, kind: CallKind, channelId?: string) => {
      if (statusRef.current !== 'idle') return;
      setState({ ...IDLE, status: 'outgoing', peer, kind, channelId, isCaller: true });
      statusRef.current = 'outgoing';

      const res = await rpc('call:invite', {
        calleeId: peer.id,
        kind,
        channelId,
      });
      if (!res || res.error || !res.callId) {
        setState(IDLE);
        Alert.alert('Звонок', res?.error ?? 'Не удалось начать звонок');
        return;
      }

      callIdRef.current = res.callId;
      peerIdRef.current = peer.id;

      try {
        const local = await getMedia(kind);
        localRef.current = local;
        setState((prev) => ({ ...prev, localStream: local }));

        const pc = createPeerConnection();
        pcRef.current = pc;
        for (const track of local.getTracks()) pc.addTrack(track, local);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        void rpc('rtc:sdp', {
          callId: res.callId,
          to: peer.id,
          sdp: { type: offer?.type ?? 'offer', sdp: offer?.sdp ?? '' },
        });
      } catch (err) {
        void rpc('call:leave', { callId: res.callId });
        teardown();
        Alert.alert(
          'Звонок',
          err instanceof Error && err.message
            ? err.message
            : 'Нет доступа к камере или микрофону',
        );
      }
    },
    [createPeerConnection, getMedia, rpc, teardown],
  );

  const acceptCall = useCallback(async () => {
    const callId = callIdRef.current;
    if (!callId) return;
    try {
      const local = await getMedia(state.kind);
      localRef.current = local;

      const pc = createPeerConnection();
      pcRef.current = pc;
      for (const track of local.getTracks()) pc.addTrack(track, local);

      const res = await rpc('call:accept', { callId });
      if (res?.error) throw new Error(res.error);

      setState((prev) => ({ ...prev, status: 'connecting', localStream: local }));
      statusRef.current = 'connecting';

      const buffered = pendingSdpRef.current;
      if (buffered) {
        pendingSdpRef.current = null;
        await handleRemoteSdp(buffered.callId, buffered.from, buffered.sdp);
      }
      await flushIce();
    } catch (err) {
      void rpc('call:reject', { callId });
      teardown();
      Alert.alert(
        'Звонок',
        err instanceof Error && err.message
          ? err.message
          : 'Нет доступа к камере или микрофону',
      );
    }
  }, [createPeerConnection, flushIce, getMedia, handleRemoteSdp, rpc, state.kind, teardown]);

  const rejectCall = useCallback(() => {
    const callId = callIdRef.current;
    if (callId) void rpc('call:reject', { callId });
    teardown();
  }, [rpc, teardown]);

  const hangUp = useCallback(() => {
    const callId = callIdRef.current;
    if (callId) void rpc('call:leave', { callId });
    teardown();
  }, [rpc, teardown]);

  const toggleMute = useCallback(() => {
    const local = localRef.current;
    if (!local) return;
    const next = !stateRef.current.micMuted;
    for (const track of local.getAudioTracks()) track.enabled = !next;
    setState((prev) => ({ ...prev, micMuted: next }));
    if (callIdRef.current) {
      void rpc('call:state', {
        callId: callIdRef.current,
        muted: next,
        cameraOff: stateRef.current.cameraOff,
      });
    }
  }, [rpc]);

  const toggleCamera = useCallback(() => {
    const local = localRef.current;
    if (!local) return;
    const next = !stateRef.current.cameraOff;
    for (const track of local.getVideoTracks()) track.enabled = !next;
    setState((prev) => ({ ...prev, cameraOff: next }));
    if (callIdRef.current) {
      void rpc('call:state', {
        callId: callIdRef.current,
        muted: stateRef.current.micMuted,
        cameraOff: next,
      });
    }
  }, [rpc]);

  const flipCamera = useCallback(() => {
    const local = localRef.current;
    const video = local?.getVideoTracks()[0];
    if (!video) return;
    try {
      video._switchCamera();
    } catch {
      // device may only have one camera
    }
  }, []);

  const value = useMemo<CallContextValue>(
    () => ({
      ...state,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleCamera,
      flipCamera,
    }),
    [state, startCall, acceptCall, rejectCall, hangUp, toggleMute, toggleCamera, flipCamera],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside CallProvider');
  return ctx;
}
