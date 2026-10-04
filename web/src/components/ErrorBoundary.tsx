/** Гланичный перехват render-ошибок: вместо белого экрана — тёмная карточка с повтором. */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Atrium: неперехваченная ошибка рендера', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="auth">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Что-то пошло не так</div>
          <div className="auth-sub" style={{ marginTop: 0, marginBottom: 14 }}>
            Не удалось отобразить приложение. Данные не потеряны — попробуйте ещё раз.
          </div>
          <div className="hint" style={{ marginBottom: 16, wordBreak: 'break-word' }}>
            {error.message}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              Повторить
            </button>
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>
              Обновить страницу
            </button>
          </div>
        </div>
      </div>
    );
  }
}
