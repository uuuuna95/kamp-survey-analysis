'use client';

// Design Ref: §2.1 문항 카드(객관식) — 표("번호. 보기 내용", 응답 수, 비율, "기타" 줄 포함)와 가로 막대 차트.
// Plan SC: SC-2·3 — 표의 숫자는 집계 결과 그대로이고, 합계 줄에서 비율 합계가 100.0%인 것을 볼 수 있다.
// 차트는 눈으로 보는 용도이고, 스크린리더 사용자는 같은 숫자가 담긴 표를 읽는다.

import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js';
import { useMemo, useSyncExternalStore } from 'react';
import { Bar } from 'react-chartjs-2';
import { chartHeight, choiceChartData, choiceChartOptions, valueLabelPlugin } from '@/lib/survey/chart-config';
import type { GroupedChoice } from '@/lib/survey/analyze';
import type { ChoiceResult as ChoiceResultData } from '@/lib/survey/types';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

// 어두운 화면 설정을 따라 차트 글자색을 바꾼다 (캔버스는 CSS를 못 쓰기 때문)
const DARK_QUERY = '(prefers-color-scheme: dark)';
function subscribeDarkMode(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const getDarkMode = () => window.matchMedia(DARK_QUERY).matches;
const getServerDarkMode = () => false;

interface ChoiceResultProps {
  result: ChoiceResultData;
  /** 집단별 결과 (부서·직급을 골랐을 때만) */
  groups?: GroupedChoice[] | undefined;
}

/** 집단별 결과 표: 보기 줄 × 집단 칸(응답 수 · 비율). 집단이 많으면 옆으로 넘겨 본다 */
function GroupTable({ grouped }: { grouped: GroupedChoice }) {
  const rows = grouped.groups[0]?.result.rows ?? [];
  return (
    <details data-role="group-results" data-group-role={grouped.role} className="group mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800">
        {grouped.label}별 결과 보기 <span className="text-zinc-600 dark:text-zinc-400">({grouped.groups.length}개 집단)</span>
      </summary>
      <div className="overflow-x-auto border-t border-zinc-200 p-3 dark:border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{grouped.label}별 보기별 응답 수와 비율</caption>
          <thead>
            <tr className="border-b border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
              <th scope="col" className="py-2 pr-4 text-left font-semibold">
                보기
              </th>
              {grouped.groups.map((g) => (
                <th key={g.name} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                  {g.name}
                  <span className="block text-xs font-normal text-zinc-600 dark:text-zinc-400">응답 {g.result.totalSelections}건</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={String(row.optionNo)} className="border-b border-zinc-100 dark:border-zinc-800">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-zinc-900 dark:text-zinc-100">
                  {row.label}
                </th>
                {grouped.groups.map((g) => {
                  const cell = g.result.rows[i];
                  return (
                    <td key={g.name} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                      {cell.count}건 · {cell.percent.toFixed(1)}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function ChoiceResult({ result, groups }: ChoiceResultProps) {
  const dark = useSyncExternalStore(subscribeDarkMode, getDarkMode, getServerDarkMode);
  const { rows } = result;
  const data = useMemo(() => choiceChartData(rows), [rows]);
  const options = useMemo(() => choiceChartOptions(rows, dark), [rows, dark]);
  const plugins = useMemo(() => [valueLabelPlugin(rows, dark)], [rows, dark]);

  if (result.totalSelections === 0) {
    return <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">응답한 사람이 없어서 보여 줄 결과가 없어요.</p>;
  }

  // 비율 합계 (집계에서 이미 100.0%로 맞춰져 있다)
  const percentSum = Math.round(rows.reduce((sum, row) => sum + row.percent * 10, 0)) / 10;

  return (
    <div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[20rem] border-collapse text-sm">
          <caption className="sr-only">보기별 응답 수와 비율</caption>
          <thead>
            <tr className="border-b border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
              <th scope="col" className="py-2 pr-4 text-left font-semibold">
                보기
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                응답 수
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-semibold">
                비율
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.optionNo)} className="border-b border-zinc-100 dark:border-zinc-800">
                <th
                  scope="row"
                  className={`py-2 pr-4 text-left font-normal ${row.optionNo === 'etc' ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}
                >
                  {row.label}
                </th>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{row.count}건</td>
                <td className="py-2 pl-3 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{row.percent.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold text-zinc-900 dark:text-zinc-100">
              <th scope="row" className="py-2 pr-4 text-left">
                합계
              </th>
              <td className="px-3 py-2 text-right tabular-nums">{result.totalSelections}건</td>
              <td className="py-2 pl-3 text-right tabular-nums">{percentSum.toFixed(1)}%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4" style={{ height: chartHeight(rows.length) }}>
        <Bar
          data={data}
          options={options}
          plugins={plugins}
          role="img"
          aria-label="보기별 응답 비율을 보여 주는 가로 막대 차트예요. 같은 숫자가 위의 표에 있어요."
        />
      </div>

      {groups?.map((grouped) => (
        <GroupTable key={grouped.role} grouped={grouped} />
      ))}
    </div>
  );
}
