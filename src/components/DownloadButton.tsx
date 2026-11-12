'use client';

// Design Ref: §2 ② 한눈에 보기 — "엑셀로 내려받기" 버튼 1개. 결과가 나온 뒤에만 보인다(이 컴포넌트를 결과 화면 안에 둔다).
// Plan SC: SC-6 — 버튼 1번으로 내려받기. 지금 화면의 결과(바꾼 유형·되돌린 열)와 만들어 둔 AI 해석이 그대로 담긴다.
// 엑셀 만들기는 브라우저에서 하고 서버로 보내지 않는다.

import { useState } from 'react';
import { downloadResultWorkbook } from '@/lib/excel/download';
import type { Analysis } from '@/lib/survey/analyze';
import type { Interpretation } from '@/lib/survey/types';

interface DownloadButtonProps {
  analysis: Analysis;
  /** 지금 화면에 있는 AI 해석 (문항 번호별). 해석을 만들지 않은 문항은 들어 있지 않다 */
  interpretations: Readonly<Record<number, Interpretation>>;
  /** AI 해석을 요청하는 중이면 내려받기를 잠시 막는다 (해석이 반쯤 빠진 파일이 만들어지지 않게) */
  disabled?: boolean;
}

export default function DownloadButton({ analysis, interpretations, disabled = false }: DownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'done' | 'error'; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const fileName = await downloadResultWorkbook(analysis, interpretations);
      setMessage({ kind: 'done', text: `${fileName} 파일을 내려받았어요.` });
    } catch {
      setMessage({ kind: 'error', text: '엑셀 파일을 만들지 못했어요. 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  const hasInterpretation = Object.keys(interpretations).length > 0;

  return (
    <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || disabled}
          className="whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? '엑셀 만드는 중…' : '엑셀로 내려받기'}
        </button>
        {message && (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            data-role="download-message"
            className={`text-sm ${message.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}
          >
            {message.text}
          </p>
        )}
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        지금 화면의 결과가 그대로 담겨요(시트 3개).{' '}
        {hasInterpretation ? '만들어 둔 AI 해석도 함께 들어가요.' : 'AI 해석을 만들지 않아서 해석 없이 내려받아요.'}{' '}
        주관식·서술형 응답 원문이 들어 있으니 공유 전에 개인정보를 확인하세요.
      </p>
    </div>
  );
}
