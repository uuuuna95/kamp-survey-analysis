'use client';

// Design Ref: §2 화면 구성 / §7 파일 구조 — 한 페이지에서 단계 ①~④를 조립한다.
// 지금은 ① 파일 올리기, ② 한눈에 보기, ③ 문항별 결과(객관식 표·차트, 주관식·서술형 응답 목록)가 있다.
// ② 한눈에 보기에는 엑셀 내려받기 버튼(작업 21)이 있다. 문항 카드의 유형 선택(작업 17)으로 그 문항의 집계가 다시 만들어진다. AI 해석(작업 15)은 "AI 해석 만들기"를 눌렀을 때만 서버로 요청하고, 문항 카드에 붙는다. ④ 뺀 열(작업 18)은 목록에서 "문항으로 되돌리기"로 문항 카드로 돌아온다.

import { useMemo, useState } from 'react';
import AiInterpretation from '@/components/AiInterpretation';
import AiPanel from '@/components/AiPanel';
import ChoiceResult from '@/components/ChoiceResult';
import DownloadButton from '@/components/DownloadButton';
import ExcludedColumns from '@/components/ExcludedColumns';
import GroupTrends from '@/components/GroupTrends';
import QuestionCard from '@/components/QuestionCard';
import ResultSummary from '@/components/ResultSummary';
import TextResult from '@/components/TextResult';
import UploadPanel from '@/components/UploadPanel';
import { useAiInterpretation } from '@/components/useAiInterpretation';
import type { LoadedUpload } from '@/components/UploadPanel';
import { analyzeSurvey } from '@/lib/survey/analyze';
import type { TypeOverrides } from '@/lib/survey/analyze';
import { doneInterpretations, staleQuestionNos } from '@/lib/ai/client';
import { buildGroupTrends } from '@/lib/survey/group-trends';

export default function Home() {
  const [loaded, setLoaded] = useState<LoadedUpload | null>(null);
  // 사용자가 문항 카드에서 직접 고른 유형 (문항 번호별). 새 파일을 올리면 비운다
  const [typeOverrides, setTypeOverrides] = useState<TypeOverrides>({});
  // "문항으로 되돌리기"를 한 열의 키 (작업 18). 새 파일을 올리면 비운다
  const [restoredKeys, setRestoredKeys] = useState<string[]>([]);
  // 파일을 읽은 결과, 고른 유형, 되돌린 열이 바뀔 때만 다시 분석한다
  const analysis = useMemo(
    () => (loaded ? analyzeSurvey(loaded.survey, typeOverrides, restoredKeys, { includeParticipants: loaded.includeParticipants, groupBy: loaded.groupBy }) : null),
    [loaded, typeOverrides, restoredKeys],
  );

  // 마지막으로 "AI 해석 만들기"에 쓴 비밀번호 (다시 시도·자동 다시 해석에도 쓴다). 메모리에만 두고 저장하지 않는다
  const [usedPassword, setUsedPassword] = useState<string | null>(null);
  const ai = useAiInterpretation(analysis, loaded);

  // 엑셀에 넣을 AI 해석: 지금 화면에 해석이 있는 문항만 (유형을 바꿔서 비워진 문항은 들어 있지 않다)
  const interpretations = doneInterpretations(ai.items);
  // 집단별 경향 (부서·직급을 골랐을 때만). 주관식·서술형 집단별 주요 의견은 지금 있는 AI 해석으로 나눈다
  const trends = useMemo(() => (analysis ? buildGroupTrends(analysis, doneInterpretations(ai.items)) : []), [analysis, ai.items]);

  /**
   * 유형이나 되돌린 열을 바꾼다 (작업 17·18·19).
   * "AI 해석 만들기"를 한 번 누른 뒤에는, 바뀌어서 해석이 비게 된 문항만 같은 방식으로 자동으로 다시 요청한다.
   * 누르기 전에는 아무것도 보내지 않는다.
   */
  const applyChange = (nextOverrides: TypeOverrides, nextRestored: string[]) => {
    setTypeOverrides(nextOverrides);
    setRestoredKeys(nextRestored);
    if (!loaded || usedPassword === null) return;
    const next = analyzeSurvey(loaded.survey, nextOverrides, nextRestored, { includeParticipants: loaded.includeParticipants, groupBy: loaded.groupBy });
    const stale = staleQuestionNos(next, ai.known);
    if (stale.length > 0) void ai.run(usedPassword, stale, next);
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
          KAMP 설문조사 결과 분석
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          엑셀 원본과 설문 문항 파일을 올리면 문항별 결과를 정리해 드려요.
        </p>
      </header>

      <UploadPanel
        onLoaded={(next) => {
          setUsedPassword(null);
          setTypeOverrides({});
          setRestoredKeys([]);
          setLoaded(next);
        }}
        onReset={() => {
          setUsedPassword(null);
          setTypeOverrides({});
          setRestoredKeys([]);
          setLoaded(null);
        }}
      />

      {loaded && analysis && (
        <>
          <ResultSummary
            analysis={analysis}
            notes={loaded.survey.notes}
            action={<DownloadButton analysis={analysis} interpretations={interpretations} disabled={ai.busy} />}
          />

          <AiPanel
            key={loaded.survey.questions.length + loaded.password}
            initialPassword={loaded.password}
            busy={ai.busy}
            requested={Object.keys(ai.items).length > 0}
            error={ai.error}
            onRun={(password) => {
              setUsedPassword(password);
              void ai.run(password);
            }}
          />

          <GroupTrends trends={trends} />

          <section aria-labelledby="results-title" className="mt-6">
            <h2 id="results-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              ③ 문항별 결과
            </h2>
            <div className="mt-3 space-y-4">
              {analysis.questions.map((item) => {
                const no = item.question.no;
                // 참여자 정보 열은 AI에 보내지 않으므로 해석 영역이 없다
                const aiBox = item.participant !== null ? null : (
                  <AiInterpretation state={ai.items[no]} disabled={ai.busy} onRetry={() => void ai.run(usedPassword ?? loaded.password, [no])} />
                );
                return (
                  <QuestionCard
                    key={no}
                    item={item}
                    onUnrestore={() => applyChange(typeOverrides, restoredKeys.filter((k) => k !== item.restoredKey))}
                    onTypeChange={(type) => {
                      const next = { ...typeOverrides };
                      if (type === null) delete next[no];
                      else next[no] = type;
                      applyChange(next, restoredKeys);
                    }}
                  >
                    {item.outcome.type === 'choice' ? (
                      <>
                        <ChoiceResult result={item.outcome.result} groups={item.outcome.groups} />
                        {aiBox}
                      </>
                    ) : (
                      <>
                        {aiBox}
                        <TextResult result={item.outcome.result} />
                      </>
                    )}
                  </QuestionCard>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="excluded-title" className="mt-6">
            <h2 id="excluded-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              ④ 분석에서 뺀 열
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              이름·사번·부서로 보이거나 문항과 짝이 없는 열이에요. 잘못 뺀 열은 문항으로 되돌릴 수 있어요.
            </p>
            <ExcludedColumns
              columns={analysis.restorable}
              onRestore={(key) => applyChange(typeOverrides, restoredKeys.includes(key) ? restoredKeys : [...restoredKeys, key])}
            />
          </section>
        </>
      )}
    </main>
  );
}
