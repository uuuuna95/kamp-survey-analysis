// Design Ref: §2 ③ AI 해석 — 문항별 해석 상태(불러오는 중 / 완료 / 실패)와 "해석 만들기"·"다시 시도"를 관리한다.
// 자동으로 다시 요청하는 일(작업 19)은 이 훅이 아니라 화면(page.tsx)이 한다: 유형·되돌린 열을 바꾸는 순간에 "바뀐 뒤의 분석"을 만들어
// run(…, 바뀐 뒤의 분석)으로 부른다. 그래서 `known`(이미 요청했거나 받은 문항의 유형)을 함께 내보낸다.
// 새 파일을 올리면(resetKey가 바뀌면) 이전 해석은 버린다. 문항 유형을 바꾸면 그 문항의 해석만 버린다
// (해석은 "어떤 유형으로 집계했을 때"의 것이라서, 항목마다 그때의 유형을 함께 적어 두고 지금 유형과 다르면 없는 것으로 본다).

import { useCallback, useState } from 'react';
import { buildInterpretQuestions, requestInterpretations, toCardState } from '@/lib/ai/client';
import type { CardAiState } from '@/lib/ai/client';
import type { Analysis } from '@/lib/survey/analyze';
import type { QuestionType } from '@/lib/survey/types';

export type { CardAiState };

interface Entry {
  state: CardAiState;
  /** 이 상태를 만들 때의 문항 유형 */
  type: QuestionType;
}

interface Store {
  /** 이 상태가 어느 파일(분석 묶음)에 대한 것인지 */
  forKey: unknown;
  items: Record<number, Entry>;
  /** 요청 전체가 막혔을 때의 안내 (비밀번호 오류, 서버 설정 등) */
  error: string | null;
  /** 진행 중인 요청 수 (유형을 바꿔서 자동으로 다시 요청한 것과 겹칠 수 있다) */
  pending: number;
}

const EMPTY: Store = { forKey: null, items: {}, error: null, pending: 0 };

export function useAiInterpretation(analysis: Analysis | null, resetKey: unknown) {
  const [store, setStore] = useState<Store>(EMPTY);
  const current = store.forKey === resetKey ? store : EMPTY;

  // 지금 유형과 같은 유형일 때 만든 상태만 보여 준다
  const items: Record<number, CardAiState> = {};
  if (analysis) {
    for (const { question, outcome } of analysis.questions) {
      const entry = current.items[question.no];
      if (entry && entry.type === outcome.type) items[question.no] = entry.state;
    }
  }

  /** nos가 없으면 모든 문항, 있으면 그 문항들만 해석을 요청한다. target은 해석할 분석 결과(기본은 지금 화면의 분석) */
  const run = useCallback(
    async (password: string, nos?: number[], target: Analysis | null = analysis) => {
      if (!target) return;
      const analysis = target;
      const questions = buildInterpretQuestions(analysis, nos);
      if (questions.length === 0) return;
      const asked = questions.map((q) => q.no);
      const typeOf = new Map(analysis.questions.map((a) => [a.question.no, a.outcome.type]));
      const before = current.items; // 요청 전체가 막혔을 때 이전 상태로 되돌리려고 기억해 둔다

      setStore((s) => {
        const base = s.forKey === resetKey ? s : { ...EMPTY, forKey: resetKey };
        const next = { ...base.items };
        for (const no of asked) next[no] = { state: { status: 'loading' }, type: typeOf.get(no) as QuestionType };
        return { ...base, items: next, error: null, pending: base.pending + 1 };
      });

      const outcome = await requestInterpretations(questions, password);

      setStore((s) => {
        if (s.forKey !== resetKey) return s; // 그 사이 다른 파일로 바뀌었다
        const next = { ...s.items };
        if (!outcome.ok) {
          // 요청 전체가 막힘(비밀번호 오류 등): 문항마다 실패를 띄우지 않고 이전 상태로 되돌린다. 안내는 위쪽 AI 해석 영역에 한 번만 보여 준다
          for (const no of asked) {
            const previous = before[no];
            if (previous) next[no] = previous;
            else delete next[no];
          }
          return { ...s, items: next, error: outcome.message, pending: Math.max(0, s.pending - 1) };
        }
        for (const item of analysis.questions) {
          const no = item.question.no;
          if (!asked.includes(no)) continue;
          next[no] = { state: toCardState(item, outcome.interpretations[String(no)], outcome.failed.includes(no)), type: item.outcome.type };
        }
        return { ...s, items: next, error: null, pending: Math.max(0, s.pending - 1) };
      });
    },
    [analysis, resetKey, current.items],
  );

  /** 이미 해석을 요청했거나 받은 문항 번호 → 그때의 유형 */
  const known = new Map(Object.entries(current.items).map(([no, entry]) => [Number(no), entry.type] as [number, QuestionType]));

  return { items, known, error: current.error, busy: current.pending > 0, run };
}
