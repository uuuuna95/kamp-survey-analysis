'use client';

// Design Ref: §2 ③ AI 해석 — "AI 해석 만들기" 버튼, 공유 비밀번호 입력, 외부 전송 안내, 오류 문구.
// Plan SC: PRD 7번 — 집계 결과와 주관식 관점 글이 외부 AI로 나간다는 것을 누르기 전에 알려 주고, 사용자가 누를 때만 보낸다.
// 비밀번호는 이 화면의 메모리에만 있고 어디에도 저장하지 않는다.

import { useId, useState } from 'react';
import type { FormEvent } from 'react';

interface AiPanelProps {
  /** 처음에 채워 둘 비밀번호 (파일 올리기에서 입력한 값) */
  initialPassword: string;
  busy: boolean;
  /** 해석을 한 번이라도 요청했는지 (버튼 글자를 "다시 만들기"로 바꾼다) */
  requested: boolean;
  error: string | null;
  onRun: (password: string) => void;
}

export default function AiPanel({ initialPassword, busy, requested, error, onRun }: AiPanelProps) {
  const passwordId = useId();
  const [password, setPassword] = useState(initialPassword);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRun(password);
  };

  return (
    <section
      aria-labelledby="ai-title"
      className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 id="ai-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        AI 해석
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        문항마다 결과를 쉬운 말로 풀어 줘요. 객관식은 2~3문장, 주관식·서술형은 주요 의견으로 묶어 줘요.
      </p>
      <p
        data-role="ai-privacy-note"
        className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        버튼을 누르면 문항 질문, 객관식 집계 숫자, 주관식·서술형 응답 글이 서버를 거쳐 외부 AI(OpenAI)로 전송돼요. 사번·부서·이름 열은 보내지 않아요. 사내
        보안 정책에서 허용된 자료만 사용하세요.
      </p>

      {requested && (
        <p data-role="ai-auto-note" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          한 번 만든 뒤에는 문항 유형을 바꾸거나 빠진 열을 되돌리면, 그 문항만 같은 방식으로 다시 해석을 요청해요.
        </p>
      )}

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor={passwordId} className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            공유 비밀번호
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? '해석하는 중…' : requested ? 'AI 해석 다시 만들기' : 'AI 해석 만들기'}
        </button>
      </form>

      {error && (
        <p role="alert" data-role="ai-error" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
