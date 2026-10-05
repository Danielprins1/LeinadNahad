/**
 * Herbruikbare, neutrale UI-componenten.
 * Ze bevatten geen spellogica; de opmaak komt volledig uit src/styles.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import type { PlayerSummary, ProgressEntry, Standing } from '@/lib/types';

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function Screen({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return <main className={cx('ui-screen', wide && 'ui-screen--wide')}>{children}</main>;
}

export function Stack({ gap, className, children }: { gap?: 'sm' | 'lg'; className?: string; children: ReactNode }) {
  return <div className={cx('ui-stack', gap && `ui-stack--${gap}`, className)}>{children}</div>;
}

export function Row({ align, children }: { align?: 'between' | 'center'; children: ReactNode }) {
  return <div className={cx('ui-row', align && `ui-row--${align}`)}>{children}</div>;
}

export function Card({ muted, className, children }: { muted?: boolean; className?: string; children: ReactNode }) {
  return <section className={cx('ui-card', muted && 'ui-card--muted', className)}>{children}</section>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'normal' | 'small';
  block?: boolean;
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'normal', block, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('ui-button', `ui-button--${variant}`, size === 'small' && 'ui-button--small', block && 'ui-button--block', className)}
    >
      {loading ? 'Even geduld…' : children}
    </button>
  );
}

type FieldProps = { label: string; hint?: ReactNode; error?: string | null };

export function TextField({ label, hint, error, className, ...input }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>{label}</label>
      <input id={id} className={cx('ui-input', className)} aria-invalid={!!error || undefined} {...input} />
      {hint && <span className="ui-hint">{hint}</span>}
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

export function TextArea({ label, hint, error, ...input }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>{label}</label>
      <textarea id={id} className="ui-textarea" aria-invalid={!!error || undefined} {...input} />
      {hint && <span className="ui-hint">{hint}</span>}
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return (
    <div className={cx('ui-alert', `ui-alert--${kind}`)} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="ui-eyebrow">{children}</p>;
}

export function Spinner() {
  return <div className="ui-spinner" aria-hidden="true" />;
}

export function Waiting({ title, text }: { title: string; text?: string }) {
  return (
    <Card>
      <Stack>
        <p className="ui-subtitle ui-center">{title}</p>
        {text && <p className="ui-muted ui-center">{text}</p>}
        <Spinner />
      </Stack>
    </Card>
  );
}

export function RoomCode({ code }: { code: string }) {
  return (
    <div className="ui-roomcode">
      <Eyebrow>Roomcode</Eyebrow>
      <div className="ui-roomcode__code" aria-label={`Roomcode ${code.split('').join(' ')}`}>{code}</div>
    </div>
  );
}

export function Counter({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="ui-center">
      <Eyebrow>{label}</Eyebrow>
      <p className="ui-big-number">
        {value} / {total}
      </p>
    </div>
  );
}

export function PlayerList({
  players,
  columns,
  onRemove,
}: {
  players: PlayerSummary[];
  columns?: boolean;
  onRemove?: (player: PlayerSummary) => void;
}) {
  if (players.length === 0) return <p className="ui-muted">Nog niemand…</p>;
  return (
    <ul className={cx('ui-list', columns && 'ui-list--columns')}>
      {players.map((p) => (
        <li key={p.id} className="ui-list__item">
          <span className={cx('ui-dot', p.connected && 'ui-dot--online')} title={p.connected ? 'Verbonden' : 'Geen verbinding'} />
          <span className="ui-list__grow">{p.name}</span>
          {onRemove && (
            <Button variant="ghost" size="small" onClick={() => onRemove(p)} aria-label={`${p.name} verwijderen`}>
              ✕
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ProgressList({ entries }: { entries: ProgressEntry[] }) {
  return (
    <ul className="ui-list ui-list--columns">
      {entries.map((e) => (
        <li key={e.id} className={cx('ui-list__item', e.done ? 'ui-list__item--done' : 'ui-list__item--todo')}>
          <span className="ui-check" aria-hidden="true">{e.done ? '✓' : '○'}</span>
          <span>{e.name}</span>
          <span className="sr-only">{e.done ? '(klaar)' : '(nog bezig)'}</span>
        </li>
      ))}
    </ul>
  );
}

export function points(n: number) {
  return `${n} ${n === 1 ? 'punt' : 'punten'}`;
}

export function Standings({ standings, meId }: { standings: Standing[]; meId?: string | null }) {
  return (
    <ol className="ui-list">
      {standings.map((s) => (
        <li key={s.id} className={cx('ui-standings__item', s.id === meId && 'ui-standings__item--me')}>
          <span className="ui-standings__rank">{s.rank}.</span>
          <span className="ui-standings__name">{s.name}</span>
          <span className="ui-standings__score">{points(s.score)}</span>
        </li>
      ))}
    </ol>
  );
}
