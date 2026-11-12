// Design Ref: §2.1 문항 카드(주관식·서술형) — 응답 목록(기본은 접힘), 응답 수, 개인정보 확인 안내.
// Plan SC: 작업 13 — 응답 원문은 그대로 보이므로, 이름 같은 개인정보가 섞여 있을 수 있다는 안내를 항상 함께 보여 준다 (PRD 7번).
// 주요 의견 요약(AI)은 작업 15에서 이 카드의 위쪽에 붙인다.
//
// 접고 펴는 부분은 브라우저 기본 기능(<details>)이라 따로 스크립트가 없어도 키보드로 열 수 있다.

import type { TextResult as TextResultData } from '@/lib/survey/types';

interface TextResultProps {
  result: TextResultData;
}

export default function TextResult({ result }: TextResultProps) {
  const { answers } = result;

  if (answers.length === 0) {
    return <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">응답한 사람이 없어서 보여 줄 응답이 없어요.</p>;
  }

  return (
    <div>
      <p
        data-role="privacy-note"
        className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        응답 원문이 그대로 보여요. 이름 같은 개인정보가 있는지 공유 전에 확인하세요.
      </p>

      <details className="group mt-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800">
          <span className="group-open:hidden">응답 목록 보기</span>
          <span className="hidden group-open:inline">응답 목록 접기</span>
          <span className="ml-1 text-zinc-600 dark:text-zinc-400">({answers.length}건)</span>
        </summary>
        <ol className="max-h-96 list-decimal space-y-2 overflow-y-auto border-t border-zinc-200 py-3 pl-9 pr-3 text-sm text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
          {answers.map((answer, index) => (
            // 같은 답이 여러 번 나올 수 있어서 순서(index)를 key로 쓴다. 목록은 바뀌지 않고 통째로 다시 그려진다
            <li key={index} className="whitespace-pre-wrap break-words">
              {answer}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
