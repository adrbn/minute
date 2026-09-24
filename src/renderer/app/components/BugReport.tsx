import { Bug, Check, ChevronDown, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { minute } from '../api';
import { Switch, useToast } from './ui';

/**
 * Signaler un problème : quelques mots, le journal technique joint (sans contenu de réunion,
 * visible avant l'envoi), puis un ticket GitHub pré-rempli — ou le rapport copié.
 */
export function BugReport({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [what, setWhat] = useState('');
  const [logs, setLogs] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    void minute.diag.report({ title, what, logs }).then((r) => setPreview(r.text));
  }, [open, title, what, logs]);

  const copy = async () => {
    const r = await minute.diag.report({ title, what, logs });
    await navigator.clipboard.writeText(`${title ? `# ${title}\n\n` : ''}${r.text}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const send = async () => {
    const r = await minute.diag.report({ title, what, logs });
    if (r.truncated) {
      await navigator.clipboard.writeText(r.text);
      toast('Journal complet copié : collez-le dans le ticket (Ctrl+V)', 'info');
    }
    await minute.windows.openExternal(r.url);
    onClose();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet report-sheet" role="dialog" aria-label="Signaler un problème">
        <div className="report-head">
          <span className="report-icon">
            <Bug size={20} />
          </span>
          <div>
            <h2>Signaler un problème</h2>
            <p>Quelques mots suffisent : le journal technique aide à comprendre le reste.</p>
          </div>
        </div>
        <label className="report-field">
          <span>En une phrase</span>
          <input
            className="field"
            autoFocus
            value={title}
            placeholder="Ex. : la transcription s’arrête après 10 minutes"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="report-field">
          <span>Que s’est-il passé ?</span>
          <textarea
            className="field"
            rows={4}
            value={what}
            placeholder="Ce que vous faisiez, ce que vous attendiez, ce qui s’est passé à la place."
            onChange={(e) => setWhat(e.target.value)}
          />
        </label>
        <div className="report-logs">
          <div>
            <b>Joindre le journal technique</b>
            <span>Version, système, réglages, erreurs récentes. Jamais de texte de réunion, de nom ni de clé.</span>
          </div>
          <Switch on={logs} onChange={setLogs} />
        </div>
        <button className={`disclosure ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={14} /> Voir exactement ce qui sera envoyé
        </button>
        {open && <pre className="report-preview">{preview ?? '…'}</pre>}
        <p className="report-note">Le ticket est public sur GitHub (un compte GitHub gratuit est nécessaire pour l’envoyer).</p>
        <div className="report-actions">
          <button className="btn" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copié' : 'Copier le rapport'}
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" onClick={() => void send()} disabled={!title.trim() && !what.trim()}>
            Envoyer sur GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
