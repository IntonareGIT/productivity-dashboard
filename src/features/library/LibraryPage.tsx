import React from 'react';
import { Card } from '../../components/ui/Card';
import { BookMarked } from 'lucide-react';

export const LibraryPage: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2.5">
        <BookMarked className="w-6 h-6 text-accent" />
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">
          Study Library
        </h1>
      </div>
      <Card>
        <p className="text-sm text-content-secondary">
          Subjects, resources, notes, and study tags will be configured here in Phase 4.
        </p>
      </Card>
    </div>
  );
};
