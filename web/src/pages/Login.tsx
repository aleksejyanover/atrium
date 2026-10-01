import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

export function Login() {
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!login.trim() || !password) {
      setError('Заполните логин и пароль');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(login.trim(), password);
      setToken(res.token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="mark">A</span> Atrium
        </div>
        <div className="auth-sub">Вход в корпоративный мессенджер</div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>Логин или email</label>
            <input
              className="input"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="alex"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Пароль</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              autoComplete="current-password"
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Вход…' : 'Войти'}
          </button>
        </form>

        <div className="auth-switch">
          Нет аккаунта? <Link to="/register">Регистрация</Link>
        </div>
      </div>
    </div>
  );
}
