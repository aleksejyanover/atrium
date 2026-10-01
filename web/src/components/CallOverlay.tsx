/** Global call UI: incoming modal, outgoing state, fullscreen active call. */

import { useEffect, useRef } from 'react';
import { useCall } from './CallProvider';
import type { CallState, ConnStatus, EndReason } from '../hooks/useWebRTC';
import { Avatar } from './Avatar';
import {
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  PhoneOffIcon,
  SwitchCameraIcon,
  VideoIcon,
  VideoOffIcon,
} from './icons';

function statusText(status: ConnStatus): string {
  if (status === 'connected') return 'В сети';
  if (status === 'lost') return 'Соединение потеряно';
  return 'Соединение…';
}

function statusDotClass(status: ConnStatus): string {
  if (status === 'connected') return 'status-dot ok';
  if (status === 'lost') return 'status-dot lost';
  return 'status-dot';
}

function kindLabel(kind: 'video' | 'audio'): string {
  return kind === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
}

function endedText(reason: EndReason): string {
  if (reason === 'reject') return 'Вызов отклонён';
  return 'Звонок завершён';
}

function AvatarBlock({ call, size }: { call: CallState; size: number }) {
  return <Avatar name={call.peer.name} color={call.peer.color} size={size} />;
}

function IncomingCard() {
  const { call, acceptCall, rejectCall } = useCall();
  if (!call) return null;
  return (
    <div className="call-card">
      <div className="kind">
        {call.kind === 'video' ? 'Входящий видеозвонок…' : 'Входящий аудиозвонок…'}
      </div>
      <div className="call-avatar">
        <span className="pulse-ring" />
        <span className="pulse-ring delay" />
        <AvatarBlock call={call} size={84} />
      </div>
      <div className="who">{call.peer.name}</div>
      <div className="sub">{kindLabel(call.kind)}{call.channelId ? ' · звонок в чате' : ''}</div>
      <div className="call-actions">
        <button className="call-btn accept" onClick={() => void acceptCall()}>
          <PhoneIcon size={16} /> Принять
        </button>
        <button className="call-btn decline" onClick={() => void rejectCall()}>
          <PhoneOffIcon size={16} /> Отклонить
        </button>
      </div>
    </div>
  );
}

function OutgoingCard() {
  const { call, hangUp } = useCall();
  if (!call) return null;
  return (
    <div className="call-card">
      <div className="kind">Вызов…</div>
      <div className="call-avatar">
        <span className="pulse-ring" />
        <AvatarBlock call={call} size={84} />
      </div>
      <div className="who">{call.peer.name}</div>
      <div className="sub">{kindLabel(call.kind)}{call.channelId ? ' · звонок в чате' : ''}</div>
      <div className="call-actions">
        <button className="call-btn decline" onClick={() => void hangUp()}>
          <PhoneOffIcon size={16} /> Отменить
        </button>
      </div>
    </div>
  );
}

function EndedCard() {
  const { call, endReason } = useCall();
  if (!call || endReason === null) return null;
  return (
    <div className="call-card">
      <div className="call-avatar">
        <AvatarBlock call={call} size={84} />
      </div>
      <div className="who">{call.peer.name}</div>
      <div className="sub">{endedText(endReason)}</div>
    </div>
  );
}

function ActiveCall() {
  const {
    call,
    phase,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    peerMuted,
    peerCameraOff,
    connStatus,
    hangUp,
    toggleMute,
    toggleCamera,
    switchCamera,
  } = useCall();

  const remoteRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream, phase]);

  useEffect(() => {
    if (pipRef.current) pipRef.current.srcObject = localStream;
  }, [localStream, call?.callId]);

  if (!call) return null;

  const remoteLive =
    remoteStream !== null && remoteStream.getVideoTracks().some((t) => t.readyState === 'live');
  const showRemoteVideo = remoteLive && !peerCameraOff;
  const localVideoTracks = localStream?.getVideoTracks() ?? [];
  const hasLocalVideo = call.kind === 'video' && localVideoTracks.length > 0;

  return (
    <div className="active-call">
      <div className="stage">
        <video className="remote-video" ref={remoteRef} autoPlay playsInline />
        {!showRemoteVideo && (
          <div className="remote-placeholder">
            <Avatar name={call.peer.name} color={call.peer.color} size={128} />
            <div className="name">{call.peer.name}</div>
            <div className="note">
              {call.kind === 'audio'
                ? 'Аудиозвонок'
                : peerCameraOff
                  ? 'Собеседник выключил камеру'
                  : statusText(connStatus)}
            </div>
          </div>
        )}

        <div className="call-topbar">
          <div>
            <div className="title">{call.peer.name}</div>
            <div className="status">
              <span className={statusDotClass(connStatus)} />
              {statusText(connStatus)} · {kindLabel(call.kind)}
              {call.channelId ? ' · звонок в чате' : ''}
            </div>
          </div>
        </div>

        <div className="peer-badges">
          {peerMuted && (
            <span className="peer-chip">
              <MicOffIcon size={13} /> Микрофон выключен
            </span>
          )}
          {peerCameraOff && call.kind === 'video' && (
            <span className="peer-chip">
              <VideoOffIcon size={13} /> Камера выключена
            </span>
          )}
        </div>

        {call.kind === 'video' && (
          <div className="pip">
            <video ref={pipRef} autoPlay playsInline muted />
            {!hasLocalVideo && (
              <div className="pip-fallback">
                <Avatar name="Вы" color="#6C5CE7" size={56} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="call-controls">
        <div className="ctrl-wrap">
          <button
            className={muted ? 'ctrl-btn off' : 'ctrl-btn'}
            onClick={toggleMute}
            title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {muted ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
          </button>
          <span className="ctrl-label">Микрофон</span>
        </div>

        {call.kind === 'video' && (
          <>
            <div className="ctrl-wrap">
              <button
                className={cameraOff ? 'ctrl-btn off' : 'ctrl-btn'}
                onClick={toggleCamera}
                title={cameraOff ? 'Включить камеру' : 'Выключить камеру'}
              >
                {cameraOff ? <VideoOffIcon size={20} /> : <VideoIcon size={20} />}
              </button>
              <span className="ctrl-label">Камера</span>
            </div>
            <div className="ctrl-wrap">
              <button
                className="ctrl-btn"
                onClick={() => void switchCamera()}
                disabled={localVideoTracks.length === 0}
                title="Переключить камеру"
              >
                <SwitchCameraIcon size={20} />
              </button>
              <span className="ctrl-label">Сменить</span>
            </div>
          </>
        )}

        <div className="ctrl-wrap">
          <button className="ctrl-btn hangup" onClick={() => void hangUp()} title="Завершить звонок">
            <PhoneOffIcon size={22} />
          </button>
          <span className="ctrl-label">Завершить</span>
        </div>
      </div>
    </div>
  );
}

export function CallOverlay() {
  const { phase } = useCall();
  if (phase === 'incoming') return <IncomingCard />;
  if (phase === 'outgoing') return <OutgoingCard />;
  if (phase === 'connecting' || phase === 'active') return <ActiveCall />;
  if (phase === 'ended') return <EndedCard />;
  return null;
}
