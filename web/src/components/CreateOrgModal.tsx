import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { Modal } from './Modal';
import { Toggle } from './Toggle';

export function CreateOrgModal({ onClose }: { onClose: () => void }) {
  const { refreshOrgs, selectOrg, toast } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true); // default ON (SPEC v2 §14.5)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Введите название организации (минимум 2 символа)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { org } = await api.createOrg(trimmed, description.trim() || undefined, isPublic);
      await refreshOrgs();
      selectOrg(org.id);
      toast(`Организация «${org.name}» создана`, 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать организацию');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Создать организацию"
      subtitle="Вы станете владельцем организации и получите канал #general"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Создание…' : 'Создать'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например, ООО «Ромашка»"
          maxLength={80}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </div>
      <div className="field">
        <label>Описание (необязательно)</label>
        <textarea
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Чем занимается организация"
          maxLength={400}
        />
      </div>
      <Toggle
        checked={isPublic}
        onChange={setIsPublic}
        label="Публичная организация (видна в каталоге)"
      />
    </Modal>
  );
}
