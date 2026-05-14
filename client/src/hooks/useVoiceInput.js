export function useVoiceInput({ submitCodexMessage }) {
  async function handleVoiceSubmit(transcript) {
    const message = String(transcript || '').trim();
    if (!message) {
      throw new Error('没有识别到文字');
    }
    return submitCodexMessage({
      message,
      attachmentsForTurn: [],
      restoreTextOnError: true
    });
  }

  return { handleVoiceSubmit };
}
