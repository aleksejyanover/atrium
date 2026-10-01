import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

interface FieldErrors {
  username?: string;
  displayName?: string;
  email?: string;
  password?: string;
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Register() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!USERNAME_RE.test(username)) {
      e.username = 'От 3 до 20 символов: строчные буквы, цифры и _';
    }
    if (displayName.trim().length < 2) {
      e.displayName = 'Введите имя (минимум 2 символа)';
    }
    if (!EMAIL_RE.test(email)) {
      e.email = 'Введите корректный email';
    }
    if (password.length < 6) {
      e.password = 'Пароль — минимум 6 символов';
    }
    return e;
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.register({
        username: username.trim(),
        displayName: displayName.trim(),
        email: email.trim(),
        password,
      });
      setToken(res.token);
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Не удалось зарегистрироваться');
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
        <div className="auth-sub">Создайте аккаунт, чтобы общаться с командой</div>

        {formError && <div className="form-error">{formError}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>Имя пользователя</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="alex"
              autoComplete="username"
              autoFocus
            />
            <span className="hint">Строчные буквы, цифры и _ , от 3 до 20 символов</span>
            {errors.username && <span className="field-error">{errors.username}</span>}
          </div>
          <div className="field">
            <label>Отображаемое имя</label>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Алексей"
              autoComplete="name"
            />
            {errors.displayName && <span className="field-error">{errors.displayName}</span>}
          </div>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@company.ru"
              autoComplete="email"
            />
            {errors.email && <span className="field-error">{errors.email}</span>}
          </div>
          <div className="field">
            <label>Пароль</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="минимум 6 символов"
              autoComplete="new-password"
            />
            {errors.password && <span className="field-error">{errors.password}</span>}
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Создание аккаунта…' : 'Зарегистрироваться'}
          </button>
        </form>

        <div className="auth-switch">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </div>
      </div>
    </div>
  );
}
