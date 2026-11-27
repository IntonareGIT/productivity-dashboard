import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, parseISO } from 'date-fns';
import { ArrowRight, Check, ListTodo } from 'lucide-react';
import { db } from '../../../db/db';
import { Card } from '../../../components/ui/Card';
import { setTodoDone, sortTodos } from '../../todos/todosRepo';

const MAX_SHOWN = 5;

/**
 * Homepage mirror of the to-do list: open tasks, top few, with a checkbox to
 * tick one off. Adding, editing and linking happen in the To-do tab; the card
 * only shows and completes.
 */
export const TodoCard: React.FC<{ onNavigateTodos: () => void }> = ({ onNavigateTodos }) => {
  const todos = useLiveQuery(() => db.todos.toArray(), []) ?? [];
  const open = useMemo(() => sortTodos(todos).filter((t) => !t.done), [todos]);
  const shown = open.slice(0, MAX_SHOWN);

  return (
    <Card
      title="To-do"
      subtitle={open.length === 0 ? 'No open tasks' : `${open.length} open task${open.length === 1 ? '' : 's'}`}
      action={
        <button
          onClick={onNavigateTodos}
          className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
        >
          Open list <ArrowRight className="w-3.5 h-3.5" />
        </button>
      }
    >
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-content-tertiary">
          <ListTodo className="w-6 h-6" />
          <p className="text-xs">Nothing on the list. Add tasks from the To-do tab.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 list-enter">
              <button
                onClick={() => void setTodoDone(t.id, true)}
                aria-label={`Complete "${t.title}"`}
                className="shrink-0 w-4.5 h-4.5 w-[18px] h-[18px] rounded-md border border-border hover:border-accent flex items-center justify-center transition-colors"
              >
                <Check className="w-3 h-3 text-transparent" />
              </button>
              <span className="text-sm text-content-primary truncate">{t.title}</span>
              {t.dueDate && (
                <span className="ml-auto text-[11px] text-content-tertiary shrink-0">{format(parseISO(t.dueDate), 'EEE, MMM d')}</span>
              )}
            </li>
          ))}
          {open.length > MAX_SHOWN && (
            <li>
              <button onClick={onNavigateTodos} className="text-xs text-content-tertiary hover:text-accent">
                +{open.length - MAX_SHOWN} more in the To-do tab
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
};
