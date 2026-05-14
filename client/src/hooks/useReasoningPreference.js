import { useEffect, useState } from 'react';
import { DEFAULT_REASONING_EFFORT, REASONING_DEFAULT_VERSION } from '../constants/preferences.js';

const REASONING_EFFORT_KEY = 'codexmobile.reasoningEffort';
const REASONING_DEFAULT_VERSION_KEY = 'codexmobile.reasoningDefaultVersion';

export function useReasoningPreference(statusReasoningEffort) {
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(() => {
    const defaultVersion = localStorage.getItem(REASONING_DEFAULT_VERSION_KEY);
    if (defaultVersion !== REASONING_DEFAULT_VERSION) {
      localStorage.setItem(REASONING_DEFAULT_VERSION_KEY, REASONING_DEFAULT_VERSION);
      localStorage.setItem(REASONING_EFFORT_KEY, DEFAULT_REASONING_EFFORT);
      return DEFAULT_REASONING_EFFORT;
    }
    return localStorage.getItem(REASONING_EFFORT_KEY) || DEFAULT_REASONING_EFFORT;
  });

  useEffect(() => {
    if (selectedReasoningEffort) {
      localStorage.setItem(REASONING_EFFORT_KEY, selectedReasoningEffort);
    }
  }, [selectedReasoningEffort]);

  useEffect(() => {
    const saved = localStorage.getItem(REASONING_EFFORT_KEY);
    if (!saved && statusReasoningEffort && !selectedReasoningEffort) {
      setSelectedReasoningEffort(statusReasoningEffort);
    }
  }, [selectedReasoningEffort, statusReasoningEffort]);

  return [selectedReasoningEffort, setSelectedReasoningEffort];
}
