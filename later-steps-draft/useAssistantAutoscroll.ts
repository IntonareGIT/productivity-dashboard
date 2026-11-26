import React, { useEffect, useRef, useState } from 'react';

/**
 * One shared autoscroll contract, used by every assistant surface.
 *
 * The rule, in order:
 *
 *  1. On send, scroll so the new message and the start of the reply are visible.
 *  2. While streaming, stay pinned to the bottom only while the user is within
 *     about 100px of it.
 *  3. If the user scrolls up, stop auto-scrolling and show "Jump to latest".
 *  4. Clicking it resumes.
 *
 * Scrolling is confined to the reply list itself — never the page. Each surface
 * has its own scroll container, and this hook is mounted once per surface, so
 * the rule is applied independently in the bubble, the full page and the split.
 */
export function useAssistantAutoscroll(dependencies: unknown[]) {
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // `dependencies` is intentionally opaque: callers pass whatever makes a new
  // turn start (view length, busy, pending) and we re-run the scroll on it.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // A new message arrived: pin to the bottom so the newest content and the
    // start of a streaming reply are both visible.
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    pinnedRef.current = nearBottom;
    setShowJump(!nearBottom);
  };

  const jump = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJump(false);
  };

  return { listRef, onScroll, showJump, jump };
}