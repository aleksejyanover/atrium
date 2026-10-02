import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getToken } from './api';
import { AppProvider, useApp } from './store';
import { CallProvider } from './components/CallProvider';
import { CallOverlay } from './components/CallOverlay';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/ChatPane';
import { RightPanel } from './components/RightPanel';
import { InvitesScreen } from './components/InvitesScreen';
import { CatalogScreen } from './components/CatalogScreen';
import { ApplicationsScreen } from './components/ApplicationsScreen';
import { DocumentsScreen } from './components/DocumentsScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { WalletScreen } from './components/WalletScreen';
import { AdminScreen } from './components/AdminScreen';
import { Toasts } from './components/Toasts';
import { HashIcon, MenuIcon } from './components/icons';
import { Login } from './pages/Login';
import { Register } from './pages/Register';

function BootScreen({ text }: { text: string }) {
  return (
    <div className="auth">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div className="spin" style={{ margin: '0 auto' }} />
        <div className="auth-sub" style={{ marginTop: 14, marginBottom: 0 }}>
          {text}
        </div>
      </div>
    </div>
  );
}

function NoOrgPlaceholder({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <div className="chat">
      <div className="chat-header">
        <button className="icon-btn only-mobile" onClick={onOpenNav} title="Меню">
          <MenuIcon />
        </button>
        <div className="title">Чат</div>
      </div>
      <div className="chat-placeholder">
        <HashIcon size={34} />
        <div>Выберите канал, чтобы начать общение</div>
      </div>
    </div>
  );
}

function Shell() {
  const {
    booted,
    bootError,
    view,
    selectedChannelId,
    panelOpen,
    detail,
    toasts,
    user,
  } = useApp();
  const [navOpen, setNavOpen] = useState(false);

  if (bootError) {
    return <BootScreen text={`Ошибка загрузки: ${bootError}`} />;
  }
  if (!booted) {
    return <BootScreen text="Загрузка…" />;
  }

  const openNav = () => setNavOpen(true);
  const closeNav = () => setNavOpen(false);
  const showPanel = panelOpen && detail !== null;

  const renderMain = () => {
    switch (view) {
      case 'invites':
        return <InvitesScreen onOpenNav={openNav} />;
      case 'catalog':
        return <CatalogScreen onOpenNav={openNav} />;
      case 'applications':
        return <ApplicationsScreen onOpenNav={openNav} />;
      case 'documents':
        return <DocumentsScreen onOpenNav={openNav} />;
      case 'profile':
        return <ProfileScreen onOpenNav={openNav} />;
      case 'wallet':
        return <WalletScreen onOpenNav={openNav} />;
      case 'admin':
        return user?.isAdmin ? (
          <AdminScreen onOpenNav={openNav} />
        ) : (
          <NoOrgPlaceholder onOpenNav={openNav} />
        );
      default:
        return selectedChannelId ? (
          <ChatPane key={selectedChannelId} channelId={selectedChannelId} onOpenNav={openNav} />
        ) : (
          <NoOrgPlaceholder onOpenNav={openNav} />
        );
    }
  };

  return (
    <CallProvider>
      <div className={showPanel ? 'app with-panel' : 'app'}>
        <Sidebar open={navOpen} onNavigate={closeNav} />

        <div className="app-main">{renderMain()}</div>

        {showPanel && <RightPanel />}
        {navOpen && <div className="scrim" onClick={closeNav} />}
      </div>

      <CallOverlay />
      <Toasts items={toasts} />
    </CallProvider>
  );
}

function Guarded() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="*" element={<Guarded />} />
    </Routes>
  );
}
