// Design Ref: §2.1 문항 카드의 AI 해석 — 불러오는 중 / 해석(객관식 2~3문장, 주관식·서술형 의견과 건수) / 실패 + 다시 시도.
// 해석이 실패해도 집계 결과(표·차트·응답 목록)는 그대로 보인다. 의견별 건수는 AI가 아니라 앱이 응답자 수로 센 값이다.

import type { CardAiState } from './useAiInterpretation';

interface AiInterpretationProps {
  state: CardAiState | undefined;
  /** 다른 해석이 진행 중이면 다시 시도 버튼을 잠시 막는다 */
  disabled: boolean;
  onRetry: () => void;
}

export default function AiInterpretation({ state, disabled, onRetry }: AiInterpretationProps) {
  if (!state) return null;

  if (state.status === 'loading') {
    return (
      <p role="status" data-role="ai-loading" className="mt-4 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        AI가 해석하는 중이에요…
      </p>
    );
  }

  if (state.status === 'failed') {
    return (
      <div data-role="ai-failed" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        <span>해석을 불러오지 못했어요. 집계 결과는 그대로 볼 수 있어요.</span>
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className="whitespace-nowrap rounded-lg border border-red-300 bg-white px-3 py-1 font-medium text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700 dark:bg-red-900 dark:text-red-100"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const { text, opinions } = state.interpretation;
  if (text) {
    return (
      <div data-role="ai-result" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950">
        <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">AI 해석</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-900 dark:text-zinc-100">{text}</p>
      </div>
    );
  }
  if (opinions && opinions.length > 0) {
    return (
      <div data-role="ai-result" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950">
        <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">주요 의견 (AI 정리 · 건수는 응답자 수)</p>
        <ol className="mt-1 space-y-1.5 text-sm text-zinc-900 dark:text-zinc-100">
          {opinions.map((o, index) => (
            <li key={index} data-role="ai-opinion" className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-words">{o.summary}</span>
              <span className="shrink-0 font-semibold text-blue-800 dark:text-blue-300">{o.count}명</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  // 보낼 내용이 없던 문항(응답이 하나도 없음): 보여 줄 해석이 없다
  return null;
}
