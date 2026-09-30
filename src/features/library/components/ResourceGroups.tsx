import React, { useEffect, useRef, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { saveResourceGroup } from '../libraryRepo';

/**
 * The inline "New group…" / "Rename" name editor.
 *
 * Commits on Enter or Save, and abandons the draft on Escape or Cancel. It is
 * deliberately a plain text input rather than a modal: on a phone a modal adds
 * a tap and a keyboard layer between the user and a one-word name.
 */
export const GroupNameEditor: React.FC<{
  initialName?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}> = ({ initialName = '', placeholder, submitLabel, onSubmit, onCancel }) => {
  const [name, setName] = useState(initialName);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const commit = () => {
    const next = name.trim();
    // An empty name is not a group. Bail back rather than creating a blank one.
    if (!next) { onCancel(); return; }
    onSubmit(next);
  };

  return (
    <div className="flex items-center gap-2 w-full">
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 min-w-0 bg-bg-elevated border border-border rounded-lg px-2.5 py-2 text-xs text-content-primary outline-none focus:border-accent"
      />
      <button
        onClick={commit}
        className="px-3 min-h-[40px] rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold shrink-0"
      >
        {submitLabel}
      </button>
      <button
        onClick={onCancel}
        className="px-3 min-h-[40px] rounded-lg text-content-secondary hover:text-content-primary text-xs shrink-0"
      >
        Cancel
      </button>
    </div>
  );
};

/** The "New group" affordance shown above the resource list. */
export const NewGroupButton: React.FC<{ onCreate: (name: string) => void }> = ({ onCreate }) => {
  const [adding, setAdding] = useState(false);
  if (adding) {
    return (
      <div className="mb-3">
        <GroupNameEditor
          placeholder="New group"
          submitLabel="Create"
          onSubmit={(name) => { onCreate(name); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      </div>
    );
  }
  return (
    <button
      onClick={() => setAdding(true)}
      className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-border text-xs font-semibold text-content-secondary hover:text-content-primary transition-colors"
    >
      <FolderPlus className="w-3.5 h-3.5" /> New group
    </button>
  );
};
