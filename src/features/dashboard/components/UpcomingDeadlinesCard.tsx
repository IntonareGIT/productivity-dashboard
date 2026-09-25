import React from 'react';
import { Bookmark, Clock, ArrowRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { Resource } from '../../../types';

interface UpcomingDeadlinesCardProps {
  resources?: Resource[];
  onNavigateLibrary: () => void;
}

export const UpcomingDeadlinesCard: React.FC<UpcomingDeadlinesCardProps> = ({
  resources = [],
  onNavigateLibrary,
}) => {
  // Deadlines with due dates
  const deadlineItems = resources
    .filter((r) => r.dueDate && !r.completed)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 3);

  return (
    <Card
      title="Upcoming Deadlines"
      subtitle="Study resources & deliverables"
      action={
        <button
          onClick={onNavigateLibrary}
          className="text-xs text-accent font-medium hover:underline flex items-center space-x-1"
        >
          <span>Library</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      }
      className="flex flex-col justify-between"
    >
      <div className="space-y-2.5 my-1">
        {deadlineItems.length === 0 ? (
          <div className="py-6 text-center text-content-tertiary">
            <Bookmark className="w-6 h-6 mx-auto mb-1 opacity-50" />
            <p className="text-xs">No pending deadlines</p>
            <p className="text-[11px] text-content-tertiary mt-0.5">
              Tag resources with due dates in Library
            </p>
          </div>
        ) : (
          deadlineItems.map((item) => (
            <div
              key={item.id}
              className="p-2.5 rounded-xl bg-bg-elevated/40 border border-border flex items-center justify-between"
            >
              <div className="truncate mr-2">
                <p className="text-xs font-medium text-content-primary truncate">{item.title}</p>
                <p className="text-[10px] text-content-tertiary flex items-center space-x-1 mt-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  <span>Due {item.dueDate}</span>
                </p>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-accent-subtle text-accent-text font-semibold flex-shrink-0">
                Pending
              </span>
            </div>
          ))
        )}
      </div>

      <div className="pt-3 border-t border-border/40 text-xs text-content-secondary flex justify-between items-center">
        <span>Active items tracked:</span>
        <span className="font-semibold text-content-primary">{deadlineItems.length}</span>
      </div>
    </Card>
  );
};
