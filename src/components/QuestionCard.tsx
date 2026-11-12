// Design Ref: §2 ③ 문항별 결과 — 문항 카드 틀: 제목(번호 + 질문), 유형, "확인 필요" 배지, 요약 줄.
// 이 틀 안에 표·차트(작업 12), 의견 요약·응답 목록(작업 13), AI 해석(작업 15)이 채워지고, 유형 바꾸기(작업 17)는 헤더의 선택 칸이다.

import { useId } from 'react';
import type { ReactNode } from 'react';
import { canUseType } from '@/lib/survey/analyze';
import type { AnalyzedQuestion } from '@/lib/survey/analyze';
import type { QuestionType } from '@/lib/survey/types';

interface QuestionCardProps {
  item: AnalyzedQuestion;
  /** 카드 본문 (요약 줄 아래에 들어간다) */
  children?: ReactNode;
  /** 유형을 바꿨을 때. null이면 자동 추정으로 되돌린다 */
  onTypeChange?: (type: QuestionType | null) => void;
  /** 되돌린 열을 다시 빼기 (작업 18) */
  onUnrestore?: () => void;
}

const TYPE_LABEL: Record<QuestionType, string> = { choice: '객관식', text: '주관식·서술형' };

/** 문항 유형에 맞는 요약 줄: 응답자 수·응답 건수·무응답 수 (객관식은 중복응답 건수도) */
function summaryLine({ outcome }: AnalyzedQuestion): string {
  if (outcome.type === 'choice') {
    const r = outcome.result;
    return `응답자 ${r.respondents}명 · 응답 ${r.totalSelections}건 · 중복응답 ${r.multiAnswerCount}건 · 무응답 ${r.noAnswer}명`;
  }
  const r = outcome.result;
  return `응답자 ${r.respondents}명 · 응답 ${r.answers.length}건 · 무응답 ${r.noAnswer}명`;
}

export default function QuestionCard({ item, children, onTypeChange, onUnrestore }: QuestionCardProps) {
  const titleId = useId();
  const typeId = useId();
  const { question, inference, outcome, userType, needsReview, restoredKey, participant } = item;
  const noOptions = !canUseType(question, 'choice');
  const ratioPercent = inference.numericRatio === null ? null : Math.round(inference.numericRatio * 100);

  return (
    <article
      aria-labelledby={titleId}
      data-question-no={question.no}
      className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          <span className="mr-2 text-blue-700 dark:text-blue-400">Q{question.no}.</span>
          {question.title}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor={typeId} className="sr-only">
            Q{question.no} 문항 유형
          </label>
          <select
            id={typeId}
            data-role="type-select"
            value={outcome.type}
            disabled={!onTypeChange}
            onChange={(e) => onTypeChange?.(e.target.value as QuestionType)}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
          >
            <option value="choice" disabled={noOptions}>
              {TYPE_LABEL.choice}
              {noOptions ? ' (보기 없음)' : ''}
            </option>
            <option value="text">{TYPE_LABEL.text}</option>
          </select>
          {needsReview && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
              확인 필요
            </span>
          )}
        </div>
      </header>

      {needsReview && ratioPercent !== null && (
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          보기 번호로 읽은 응답이 {ratioPercent}%예요. 객관식이 맞는지 확인해 주세요.
        </p>
      )}

      {participant !== null && (
        <p data-role="participant-note" className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          참여자 정보 열이에요. 값이 그대로 보이고, <strong>AI에는 보내지 않아요.</strong>
        </p>
      )}

      {restoredKey !== null && (
        <p data-role="restored-note" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          분석에서 뺐던 열을 문항으로 되돌렸어요.{' '}
          <button type="button" onClick={onUnrestore} className="font-medium text-blue-700 underline hover:text-blue-900 dark:text-blue-400">
            다시 빼기
          </button>
        </p>
      )}

      {userType !== null && (
        <p data-role="type-override-note" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          직접 {TYPE_LABEL[userType]}로 바꿨어요 (자동 추정: {TYPE_LABEL[inference.type]}).{' '}
          <button type="button" onClick={() => onTypeChange?.(null)} className="font-medium text-blue-700 underline hover:text-blue-900 dark:text-blue-400">
            자동 추정으로 되돌리기
          </button>
        </p>
      )}

      <p data-role="summary" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {summaryLine(item)}
      </p>

      {children}
    </article>
  );
}
