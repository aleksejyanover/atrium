import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { colors, radius } from '@/lib/theme';
import { formatCallDuration } from '@/lib/format';
import { useCall } from '@/state/call';

/** Full-screen incoming call modal (SPEC section 4 flow step 2). */
function IncomingCallOverlay() {
  const { status, peer, kind, acceptCall, rejectCall } = useCall();
  const insets = useSafeAreaInsets();
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (status !== 'incoming') return;
    const id = setInterval(() => setPulse((p) => p + 1), 700);
    return () => clearInterval(id);
  }, [status]);

  if (status !== 'incoming') return null;
  const scale = 1 + (pulse % 2) * 0.06;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={rejectCall}>
      <View style={[styles.incoming, { paddingTop: insets.top + 40 }]}>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <View style={{ transform: [{ scale }] }}>
            <Avatar
              name={peer?.displayName ?? '?'}
              color={peer?.avatarColor ?? colors.accent}
              size={104}
            />
          </View>
          <Text style={styles.callerName}>{peer?.displayName ?? 'Неизвестный'}</Text>
          <Text style={styles.callerMeta}>
            @{peer?.username ?? ''} · {kind === 'video' ? 'видеозвонок' : 'аудиозвонок'}
          </Text>
          <View style={styles.incomingBadge}>
            <Text style={styles.incomingBadgeText}>Входящий вызов…</Text>
          </View>
        </View>

        <View style={[styles.incomingActions, { marginBottom: insets.bottom + 40 }]}>
          <Pressable
            onPress={rejectCall}
            style={[styles.roundAction, { backgroundColor: colors.danger }]}>
            <Feather name="phone-off" size={26} color="#FFFFFF" />
          </Pressable>
          <Pressable
            onPress={() => void acceptCall()}
            style={[styles.roundAction, { backgroundColor: colors.ok }]}>
            <Feather
              name={kind === 'video' ? 'video' : 'phone'}
              size={26}
              color="#06281C"
            />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Full-screen active/outgoing call view: big remote video + mirrored local PiP. */
function ActiveCallOverlay() {
  const { status, callId } = useCall();
  const visible = status === 'outgoing' || status === 'connecting' || status === 'active';
  if (!visible) return null;
  // fresh state (incl. call timer) for every call
  return <ActiveCallView key={callId ?? 'call'} />;
}

function ActiveCallView() {
  const {
    status,
    kind,
    peer,
    channelId,
    localStream,
    remoteStream,
    micMuted,
    cameraOff,
    peerMuted,
    peerCameraOff,
    toggleMute,
    toggleCamera,
    flipCamera,
    hangUp,
  } = useCall();
  const insets = useSafeAreaInsets();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (status !== 'active') return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const statusText =
    status === 'outgoing'
      ? 'Вызов…'
      : status === 'connecting'
        ? 'Соединение…'
        : formatCallDuration(seconds);

  const localUrl = localStream ? localStream.toURL() : '';
  const remoteUrl = remoteStream ? remoteStream.toURL() : '';

  return (
    <Modal visible animationType="fade" onRequestClose={hangUp}>
      <View style={styles.callRoot}>
        {kind === 'video' && remoteUrl ? (
          <RTCView streamURL={remoteUrl} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={0} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.audioPlaceholder]}>
            <Avatar
              name={peer?.displayName ?? '?'}
              color={peer?.avatarColor ?? colors.accent}
              size={120}
            />
            <Text style={styles.callerName}>{peer?.displayName ?? 'Неизвестный'}</Text>
            {peerMuted ? (
              <View style={styles.stateBadge}>
                <Feather name="mic-off" size={12} color={colors.muted} />
                <Text style={styles.stateBadgeText}>микрофон выключен</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={[styles.callTop, { paddingTop: insets.top + 14 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.callTitle} numberOfLines={1}>
              {peer?.displayName ?? 'Звонок'}
            </Text>
            <Text style={styles.callSubtitle}>
              {statusText}
              {channelId ? ' · звонок в чате' : ''}
              {kind === 'video' && peerCameraOff ? ' · камера выключена' : ''}
            </Text>
          </View>
        </View>

        {kind === 'video' && localUrl ? (
          <View style={[styles.pip, { top: insets.top + 70 }]}>
            {cameraOff ? (
              <View style={[styles.pip, styles.pipOff]}>
                <Feather name="video-off" size={22} color={colors.muted} />
              </View>
            ) : (
              <RTCView
                streamURL={localUrl}
                style={StyleSheet.absoluteFill}
                mirror
                objectFit="cover"
                zOrder={1}
              />
            )}
          </View>
        ) : null}

        <View style={[styles.controls, { paddingBottom: insets.bottom + 28 }]}>
          <ControlButton
            icon={micMuted ? 'mic-off' : 'mic'}
            label={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            active={!micMuted}
            onPress={toggleMute}
          />
          {kind === 'video' ? (
            <>
              <ControlButton
                icon={cameraOff ? 'video-off' : 'video'}
                label={cameraOff ? 'Включить камеру' : 'Выключить камеру'}
                active={!cameraOff}
                onPress={toggleCamera}
              />
              <ControlButton icon="refresh-cw" label="Сменить камеру" onPress={flipCamera} />
            </>
          ) : null}
          <ControlButton icon="phone-off" label="Завершить" danger onPress={hangUp} />
        </View>
      </View>
    </Modal>
  );
}

function ControlButton({
  icon,
  label,
  onPress,
  danger,
  active = true,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress(): void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.control,
          {
            backgroundColor: danger ? colors.danger : active ? colors.panel2 : '#2A2A31',
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}>
        <Feather
          name={icon}
          size={22}
          color={danger ? '#FFFFFF' : active ? colors.text : colors.muted}
        />
      </Pressable>
      <Text style={styles.controlLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function CallOverlays() {
  return (
    <>
      <IncomingCallOverlay />
      <ActiveCallOverlay />
    </>
  );
}

const styles = StyleSheet.create({
  incoming: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  callerName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 18,
  },
  callerMeta: {
    color: colors.muted,
    fontSize: 14,
  },
  incomingBadge: {
    marginTop: 14,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  incomingBadgeText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  incomingActions: {
    flexDirection: 'row',
    gap: 48,
    alignItems: 'center',
  },
  roundAction: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  audioPlaceholder: {
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 80,
  },
  callTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: 'rgba(10,10,12,0.55)',
  },
  callTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  callSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  pip: {
    position: 'absolute',
    right: 16,
    width: 108,
    height: 156,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  pipOff: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  stateBadgeText: {
    color: colors.muted,
    fontSize: 13,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 18,
    paddingTop: 18,
    backgroundColor: 'rgba(10,10,12,0.55)',
  },
  control: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlLabel: {
    color: colors.muted,
    fontSize: 11,
    maxWidth: 84,
    textAlign: 'center',
  },
});
