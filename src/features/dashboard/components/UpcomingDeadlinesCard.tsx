import React, { useMemo } from 'react';
import { Bookmark, Clock, ArrowRight, FlaskConical } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { Assessment, Resource } from '../../../types';

interface UpcomingDeadlinesCardProps {
  resources?: Resource[];
  assessments?: Assessment[];
  subjectName?: (id: string) => string | null;
  onNavigateLibrary: () => void;
}

interface DeadlineItem {
  key: string;
  title: string;
  date: string;
  badge: string;
  badgeClasses: string;
  subject: string | null;
  icon: 'resource' | 'assessment';
}

export const UpcomingDeadlinesCard: React.FC<UpcomingDeadlinesCardProps> = ({
  resources = [],
  assessments = [],
  subjectName,
  onNavigateLibrary,
}) => {
  const deadlineItems = useMemo<DeadlineItem[]>(() => {
    const resItems: DeadlineItem[] = resources
      .filter((r) => r.dueDate && !r.completed)
      .map((r) => ({
        key: `r-${r.id}`,
        title: r.title,
        date: r.dueDate as string,
        badge: 'Pending',
        badgeClasses: 'bg-accent-subtle text-accent-text',
        subject: subjectName ? subjectName(r.subjectId) : null,
        icon: 'resource',
      }));
    const asmItems: DeadlineItem[] = assessments
      .filter((a) => a.status === 'upcoming')
      .map((a) => ({
        key: `a-${a.id}`,
        title: a.name,
        date: a.date,
        badge: a.type.charAt(0).toUpperCase() + a.type.slice(1),
        badgeClasses: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        subject: subjectName ? subjectName(a.subjectId) : null,
        icon: 'assessment',
      }));
    return [...resItems, ...asmItems]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4);
  }, [resources, assessments, subjectName]);

  return (
    <Card
      title="Upcoming Deadlines"
      subtitle="Resource due dates & assessments"
      action={
        <button onClick={onNavigateLibrary} className="text-xs text-accent font-medium hover:underline flex items-center space-x-1">
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
            <p className="text-[11px] text-content-tertiary mt-0.5">Add due dates or assessments in the Library</p>
          </div>
        ) : (
          deadlineItems.map((item) => (
            <div key={item.key} className="p-2.5 rounded-xl bg-bg-elevated/40 border border-border flex items-center justify-between gap-2">
              <div className="truncate min-w-0">
                <p className="text-xs font-medium text-content-primary truncate">{item.title}</p>
                <p className="text-[10px] text-content-tertiary flex items-center space-x-1 mt-0.5">
                  <Clock className="w-2.5 h-2.5 shrink-0" />
                  <span>{item.date}</span>
                  {item.subject && <span className="truncate">· {item.subject}</span>}
                </p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded font-semibold flex-shrink-0 ${item.badgeClasses}`}>
                {item.badge}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="pt-3 border-t border-border/40 text-xs text-content-secondary flex justify-between items-center">
        <span className="flex items-center gap-1.5"><FlaskConical className="w-3 h-3" /> Active items tracked:</span>
        <span className="font-semibold text-content-primary">{deadlineItems.length}</span>
      </div>
    </Card>
  );
};

