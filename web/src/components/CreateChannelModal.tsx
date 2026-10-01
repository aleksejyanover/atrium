import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { Modal } from './Modal';

export function CreateChannelModal({ onClose }: { onClose: () => void }) {
  const { currentOrgId, addChannel, selectChannel, toast } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim().replace(/^#+/, '').trim();
    if (trimmed.length < 1) {
      setError('Введите название канала');
      return;
    }
    if (trimmed.length > 40) {
      setError('Название канала — не более 40 символов');
      return;
    }
    if (!currentOrgId) return;
    setBusy(true);
    setError(null);
    try {
      const { channel } = await api.createChannel(currentOrgId, trimmed);
      addChannel(channel);
      selectChannel(channel.id);
      toast(`Канал #${channel.name} создан`, 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать канал');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Создать канал"
      subtitle="Каналы доступны всем участникам организации"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Создание…' : 'Создать'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Название канала</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="например, обсуждения"
          maxLength={40}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </div>
    </Modal>
  );
}
