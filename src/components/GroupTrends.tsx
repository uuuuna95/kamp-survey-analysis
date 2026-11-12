'use client';

// 집단별 경향 — 부서별·직급별로 문항마다 어떤 응답을 했고 어떤 의견이 있는지 요약 문장과 차트로 보여 준다.
// AI 해석 영역 바로 아래에 놓는다. 숫자는 앱이 센 집단별 결과 그대로이고, 부서·직급 정보는 AI에 보내지 않는다.
// 주관식·서술형 "주요 의견"은 AI 해석을 만든 뒤에, AI가 묶은 의견을 앱이 집단별로 나눠 센 것이다.

import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js';
import { useMemo, useSyncExternalStore } from 'react';
import { Bar } from 'react-chartjs-2';
import { groupChartData, groupChartHeight, groupChartOptions } from '@/lib/survey/chart-config';
import type { ChoiceTrend, GroupTrend } from '@/lib/survey/group-trends';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const DARK_QUERY = '(prefers-color-scheme: dark)';
function subscribeDarkMode(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const getDarkMode = () => window.matchMedia(DARK_QUERY).matches;
const getServerDarkMode = () => false;

function ChoiceTrendChart({ trend, dark }: { trend: ChoiceTrend; dark: boolean }) {
  const input = useMemo(() => ({ labels: trend.labels, groups: trend.groups.filter((g) => g.answered > 0) }), [trend]);
  const { groups } = input;
  const data = useMemo(() => groupChartData(input), [input]);
  const options = useMemo(() => groupChartOptions(input, dark), [input, dark]);
  if (groups.length === 0) return <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">응답한 사람이 없어요.</p>;
  return (
    <div className="mt-2" style={{ height: groupChartHeight(groups.length, trend.labels.length) }}>
      <Bar data={data} options={options} role="img" aria-label="집단마다 보기별 비율을 이어 붙인 가로 막대 차트예요. 같은 숫자가 아래 표에 있어요." />
    </div>
  );
}

function ChoiceTrendTable({ trend }: { trend: ChoiceTrend }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer select-none text-zinc-700 dark:text-zinc-300">숫자로 보기</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[24rem] border-collapse">
          <thead>
            <tr className="border-b border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
              <th scope="col" className="py-1 pr-3 text-left font-semibold">
                집단
              </th>
              <th scope="col" className="px-2 py-1 text-left font-semibold">
                가장 많이 고른 보기
              </th>
              {trend.labels.map((label) => (
                <th key={label} scope="col" className="whitespace-nowrap px-2 py-1 text-right font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[{ name: '전체', answered: trend.overall.counts.reduce((s, c) => s + c, 0), ...trend.overall }, ...trend.groups].map((g) => (
              <tr key={g.name} className="border-b border-zinc-100 dark:border-zinc-800">
                <th scope="row" className="whitespace-nowrap py-1 pr-3 text-left font-normal text-zinc-900 dark:text-zinc-100">
                  {g.name} <span className="text-zinc-500">({g.answered}건)</span>
                </th>
                <td className="px-2 py-1 text-zinc-900 dark:text-zinc-100">{g.top ? `${g.top.label} ${g.top.percent.toFixed(1)}%` : '-'}</td>
                {g.counts.map((count, i) => (
                  <td key={i} className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                    {count}건 · {g.percents[i].toFixed(1)}%
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function GroupTrends({ trends }: { trends: GroupTrend[] }) {
  const dark = useSyncExternalStore(subscribeDarkMode, getDarkMode, getServerDarkMode);
  if (trends.length === 0) return null;
  return (
    <section aria-labelledby="group-trends-title" data-role="group-trends" className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 id="group-trends-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        집단별 경향
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        부서·직급별로 어떤 응답을 했는지 앱이 직접 세서 요약해요. 부서·직급 정보는 AI에 보내지 않아요. 주관식·서술형의 집단별 주요 의견은 AI 해석을 만든 뒤에, AI가 묶은 의견을 집단별로 나눠 세서 보여 줘요.
      </p>

      {trends.map((trend) => (
        <details key={trend.role} open data-group-role={trend.role} className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800">
            {trend.label}별 경향 <span className="font-normal text-zinc-600 dark:text-zinc-400">({trend.groups.length}개 집단)</span>
          </summary>
          <div className="border-t border-zinc-200 px-4 pb-4 dark:border-zinc-800">
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
              {trend.groups.map((g) => `${g.name} ${g.respondents}명`).join(' · ')}
            </p>

            <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">경향 요약</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
              {trend.highlights.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>

            {trend.choice.map((q) => (
              <div key={q.no} className="mt-6">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Q{q.no}. {q.title}
                </h3>
                <ChoiceTrendChart trend={q} dark={dark} />
                <ChoiceTrendTable trend={q} />
              </div>
            ))}

            {trend.text.map((q) => (
              <div key={q.no} className="mt-6">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Q{q.no}. {q.title} <span className="font-normal text-zinc-500">(주관식·서술형)</span>
                </h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {q.groups.map((g) => (
                    <li key={g.name} className="text-zinc-800 dark:text-zinc-200">
                      <span className="font-medium">{g.name}</span> — 응답 {g.answers.length}건
                      {g.opinions.length > 0 && (
                        <ul className="mt-1 list-disc pl-5 text-zinc-700 dark:text-zinc-300">
                          {g.opinions.slice(0, 3).map((o) => (
                            <li key={o.summary}>
                              {o.summary} ({o.count}명)
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
                {!q.hasOpinions && <p className="mt-1 text-xs text-zinc-500">AI 해석을 만들면 집단별 주요 의견이 여기에 나와요.</p>}
              </div>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}
