// Design Ref: §2 ② 한눈에 보기 — 응답자 수, 문항 수, 확인 필요 문항 수, 그리고 읽다가 알게 된 점.
// 엑셀 내려받기 버튼(작업 21)은 action으로 받아서 이 영역 아래에 붙인다.

import type { ReactNode } from 'react';
import type { Analysis } from '@/lib/survey/analyze';

interface ResultSummaryProps {
  analysis: Analysis;
  /** 파일을 읽다가 알게 된 점 (짝이 없는 문항·열, 읽지 못한 줄 등) */
  notes: string[];
  /** 영역 맨 아래에 붙일 것 (엑셀 내려받기 버튼) */
  action?: ReactNode;
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd
        className={`text-2xl font-bold ${highlight ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-900 dark:text-zinc-50'}`}
      >
        {value}
      </dd>
    </div>
  );
}

export default function ResultSummary({ analysis, notes, action }: ResultSummaryProps) {
  return (
    <section
      aria-labelledby="summary-title"
      className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 id="summary-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        ② 한눈에 보기
      </h2>
      <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
        <Stat label="응답자" value={`${analysis.respondents}명`} />
        <Stat label="문항" value={`${analysis.questions.length}개`} />
        <Stat label="확인 필요" value={`${analysis.reviewCount}개`} highlight={analysis.reviewCount > 0} />
      </dl>
      {notes.length > 0 && (
        <div className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-semibold">알아 두세요</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {action}
    </section>
  );
}
