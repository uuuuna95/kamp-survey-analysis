'use client';

// Design Ref: §2 ④ 분석에서 뺀 열 — 열 번호(제목), 뺀 이유, "문항으로 되돌리기".
// Plan SC: PRD Must 4 — 이름·사번으로 판단된 열은 "이 열의 값이 AI로 전송되고 결과에 실립니다" 경고를 확인해야 되돌려진다.
//          질문이 없는 열은 열 제목을 질문으로 쓰는 주관식·서술형으로만 되돌아온다(아래 안내 문구).
// 뺀 열의 응답 값은 이 화면에 보여 주지 않는다 (개인정보). 응답이 있는 칸 수만 보여 준다.

import { useState } from 'react';
import type { RestorableColumn } from '@/lib/survey/analyze';

interface ExcludedColumnsProps {
  columns: RestorableColumn[];
  onRestore: (key: string) => void;
}

const REASON_TEXT: Record<RestorableColumn['reason'], string> = {
  'id-number': '사번으로 보여서 뺐어요 (응답이 모두 5~6자리 숫자)',
  department: '부서로 보여서 뺐어요 (응답이 모두 처·본부·실·부·원으로 끝남)',
  name: '이름으로 보여서 뺐어요 (응답이 모두 한글 2~5글자)',
  'not-in-questions': '문항 파일에 없는 번호예요',
  'header-not-number': '열 제목이 숫자가 아니에요 (또는 중복이에요)',
};

/** 질문이 없는 열을 되돌릴 때 알려 줄 말 */
const NO_QUESTION_NOTE = '질문이 없는 열이라 열 제목을 질문으로 쓰는 주관식·서술형으로만 되돌아와요.';

export const RESTORE_WARNING = '이 열의 값이 AI로 전송되고 결과에 실립니다. 이름·사번 같은 개인정보가 그대로 보일 수 있어요.';

export default function ExcludedColumns({ columns, onRestore }: ExcludedColumnsProps) {
  // 경고 확인을 기다리는 열의 키
  const [confirming, setConfirming] = useState<string | null>(null);

  if (columns.length === 0) {
    return <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">지금 분석에서 빠진 열이 없어요.</p>;
  }

  return (
    <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {columns.map((column) => {
        const noQuestion = column.reason === 'not-in-questions' || column.reason === 'header-not-number';
        return (
          <li key={column.key} data-role="excluded-column" data-key={column.key} className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-medium text-zinc-900 dark:text-zinc-100">
                  열 {column.label}
                  <span className="ml-2 font-normal text-zinc-600 dark:text-zinc-400">응답 {column.answerCount}건</span>
                </p>
                <p className="text-zinc-600 dark:text-zinc-400">{REASON_TEXT[column.reason]}</p>
                {noQuestion && <p className="text-zinc-600 dark:text-zinc-400">{NO_QUESTION_NOTE}</p>}
              </div>
              {confirming !== column.key && (
                <button
                  type="button"
                  onClick={() => (column.needsWarning ? setConfirming(column.key) : onRestore(column.key))}
                  className="whitespace-nowrap rounded-lg border border-blue-300 px-3 py-1.5 font-medium text-blue-800 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
                >
                  문항으로 되돌리기
                </button>
              )}
            </div>

            {confirming === column.key && (
              <div role="alertdialog" aria-label="되돌리기 확인" data-role="restore-warning" className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold">{RESTORE_WARNING}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(null);
                      onRestore(column.key);
                    }}
                    className="whitespace-nowrap rounded-lg bg-amber-700 px-3 py-1.5 font-medium text-white hover:bg-amber-800"
                  >
                    확인하고 되돌리기
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="whitespace-nowrap rounded-lg border border-amber-400 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
