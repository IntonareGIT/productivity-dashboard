import React, { useMemo } from 'react';
import { ArrowRight, BookOpenCheck, Check } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '../../../components/ui/Card';
import { db } from '../../../db/db';
import { dueTopics, reviewedPatch } from '../../review/reviewLogic';

/**
 * Homepage card: studied (confident) topics that are due for a spaced review.
 * "Reviewed" logs the review and pushes the next reminder one interval out.
 */
export const ReviewCard: React.FC<{ onNavigateLibrary: () => void }> = ({ onNavigateLibrary }) => {
  const topics = useLiveQuery(() => db.topics.toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];

  const due = useMemo(() => dueTopics(topics).slice(0, 5), [topics]);
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? null;

  const markReviewed = async (topicId: string) => {
    const topic = await db.topics.get(topicId);
    if (!topic) return;
    await db.topics.put({ ...topic, ...reviewedPatch(topic) });
  };

  return (
    <Card
      title="Review"
      subtitle="Studied topics due for another look"
      action={
        <button onClick={onNavigateLibrary} className="text-xs text-accent font-medium hover:underline flex items-center space-x-1">
          <span>Library</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      }
      className="flex flex-col justify-between"
    >
      <div className="space-y-2.5 my-1">
        {due.length === 0 ? (
          <div className="py-6 text-center text-content-tertiary">
            <BookOpenCheck className="w-6 h-6 mx-auto mb-1 opacity-50" />
            <p className="text-xs">Nothing due for review</p>
            <p className="text-[11px] text-content-tertiary mt-0.5">Confident topics come back after 1, 3, 7, 14 and 30 days</p>
          </div>
        ) : (
          due.map((topic) => (
            <div key={topic.id} className="p-2.5 rounded-xl bg-bg-elevated/40 border border-border flex items-center justify-between gap-2">
              <div className="truncate min-w-0">
                <p className="text-xs font-medium text-content-primary truncate">{topic.title}</p>
                {subjectName(topic.subjectId) && (
                  <p className="text-[10px] text-content-tertiary mt-0.5 truncate">{subjectName(topic.subjectId)}</p>
                )}
              </div>
              <button
                onClick={() => void markReviewed(topic.id)}
                className="text-[10px] px-2 py-1 rounded-lg bg-accent-subtle text-accent-text font-semibold hover:opacity-80 flex items-center gap-1 flex-shrink-0"
              >
                <Check className="w-3 h-3" /> Reviewed
              </button>
            </div>
          ))
        )}
      </div>

      <div className="pt-3 border-t border-border/40 text-xs text-content-secondary flex justify-between items-center">
        <span className="flex items-center gap-1.5"><BookOpenCheck className="w-3 h-3" /> Due now:</span>
        <span className="font-semibold text-content-primary">{due.length}</span>
      </div>
    </Card>
  );
};
