import { createContext, useContext, type ReactNode } from 'react';
import { useApp } from '../store';
import { useWebRTC, type WebRTCApi } from '../hooks/useWebRTC';

const CallContext = createContext<WebRTCApi | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const { socket, toast } = useApp();
  const rtc = useWebRTC(socket, toast);
  return <CallContext.Provider value={rtc}>{children}</CallContext.Provider>;
}

export function useCall(): WebRTCApi {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside CallProvider');
  return ctx;
}
