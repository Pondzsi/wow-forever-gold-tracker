import type { Table } from 'dexie';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface ToastInput {
  text: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
  action?: { label: string; run: () => void };
  ms?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}

type Show = (t: ToastInput) => void;
const ToastContext = createContext<Show>(() => {});

/** Short messages at the bottom of the screen (above the phone bar). Read out by screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const schedule = useCallback(
    (id: number, ms: number) => timers.current.set(id, setTimeout(() => remove(id), ms)),
    [remove],
  );

  const show = useCallback<Show>(
    (t) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      schedule(id, t.ms ?? (t.action ? 7000 : 5000));
    },
    [schedule],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.tone ?? ''}`}
            onMouseEnter={() => clearTimeout(timers.current.get(t.id))}
            onMouseLeave={() => schedule(t.id, 3000)}
          >
            <span className="toast-text">{t.text}</span>
            {t.action && (
              <button
                className="secondary"
                onClick={() => {
                  t.action!.run();
                  remove(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="link" aria-label="Dismiss" onClick={() => remove(t.id)}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Show {
  return useContext(ToastContext);
}

/** Deletes a row at once and offers Undo, which puts the same row (same id) back. */
export async function deleteWithUndo<T>(table: Table<T, number>, id: number, what: string, toast: Show) {
  const row = await table.get(id);
  if (!row) return;
  await table.delete(id);
  toast({ text: `${what} deleted.`, action: { label: 'Undo', run: () => void table.put(row) } });
}
