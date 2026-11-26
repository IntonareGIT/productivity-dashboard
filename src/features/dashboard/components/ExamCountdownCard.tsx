import React, { useMemo } from 'react';
import { GraduationCap, ArrowRight } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type { Assessment, Subject, Topic } from '../../../types';
import { buildExamCountdown, daysLeftText } from '../examCountdown';
import { useOpenSubjectStore } from '../../../stores/useOpenSubjectStore';

interface ExamCountdownCardProps {
  assessments: Assessment[];
  subjects: Subject[];
  topics: Topic[];
  onNavigateLibrary: () => void;
}

const MAX_ROWS = 4;
const MAX_TOPICS = 3;

/**
 * Days left to each upcoming quiz/exam, and which of that subject's topics are
 * not yet Confident. Each row opens the subject in the Library.
 */
export const ExamCountdownCard: React.FC<ExamCountdownCardProps> = ({
  assessments,
  subjects,
  topics,
  onNavigateLibrary,
}) => {
  const requestSubject = useOpenSubjectStore((s) => s.request);
  const items = useMemo(() => buildExamCountdown(assessments, subjects, topics), [assessments, subjects, topics]);
  const shown = items.slice(0, MAX_ROWS);

  return (
    <Card
      title="Exam Countdown"
      subtitle="Quizzes and exams, and what is still unstudied"
      action={
        <button onClick={onNavigateLibrary} className="text-xs text-accent font-medium hover:underline flex items-center space-x-1">
          <span>Library</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      }
    >
      {items.length === 0 ? (
        <div className="py-5 text-center text-content-tertiary">
          <GraduationCap className="w-6 h-6 mx-auto mb-1 opacity-50" />
          <p className="text-xs">No upcoming quizzes or exams</p>
          <p className="text-[11px] mt-0.5">Add an assessment with a date in a subject to see its countdown</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {shown.map((it) => {
            const urgent = it.daysLeft <= 3;
            const rest = it.unstudied.length - MAX_TOPICS;
            return (
              <button
                key={it.assessmentId}
                type="button"
                aria-label={`Open ${it.subjectName}, ${it.name}`}
                onClick={() => { requestSubject(it.subjectId); onNavigateLibrary(); }}
                className="text-left rounded-xl border border-border bg-bg-elevated/40 hover:border-accent transition-colors p-3 flex gap-3 items-start"
              >
                <div
                  className={`shrink-0 w-14 rounded-lg px-1.5 py-2 text-center ${
                    urgent ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-accent-subtle text-accent-text'
                  }`}
                >
                  <div className="text-lg font-bold font-mono leading-none">
                    {it.daysLeft <= 1 ? (it.daysLeft === 0 ? '0' : '1') : it.daysLeft}
                  </div>
                  <div className="text-[10px] uppercase font-semibold mt-1">
                    {it.daysLeft === 0 ? 'today' : it.daysLeft === 1 ? 'day' : 'days'}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-content-primary truncate">{it.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-bg-elevated text-content-secondary uppercase">{it.type}</span>
                  </div>
                  <p className="text-[11px] text-content-tertiary truncate">
                    {it.subjectName} · {it.date} · {daysLeftText(it.daysLeft)}
                  </p>
                  <p className="text-[11px] mt-1.5 text-content-secondary">
                    {it.totalTopics === 0
                      ? 'No topics in this subject yet'
                      : it.unstudied.length === 0
                      ? `All ${it.totalTopics} topics Confident`
                      : `${it.unstudied.length} of ${it.totalTopics} topics not Confident${it.notStarted ? ` (${it.notStarted} not started)` : ''}`}
                  </p>
                  {it.unstudied.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {it.unstudied.slice(0, MAX_TOPICS).map((t) => (
                        <span
                          key={t.id}
                          className={`text-[10px] px-1.5 py-0.5 rounded max-w-full truncate ${
                            t.status === 'not_started'
                              ? 'bg-red-500/10 text-red-500'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {t.title}
                        </span>
                      ))}
                      {rest > 0 && <span className="text-[10px] px-1.5 py-0.5 text-content-tertiary">+{rest} more</span>}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {items.length > MAX_ROWS && (
        <p className="text-[11px] text-content-tertiary mt-2.5">+{items.length - MAX_ROWS} more later this term</p>
      )}
    </Card>
  );
};
