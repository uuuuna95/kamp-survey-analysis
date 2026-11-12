// Design Ref: §2.1 문항 카드(객관식) — 차트: 가로 막대. 화면(ChoiceResult)과 엑셀에 넣을 차트 그림(작업 20)이 같은 설정을 쓴다.
// Plan SC: SC-2 — 차트의 막대 길이는 표의 비율과 같은 값이다.
//
// Chart.js의 타입만 가져온다(`import type`). 화면 없이 값만 계산하는 함수라서 브라우저 없이도 테스트할 수 있다.

import type { BarElement, ChartData, ChartOptions, Plugin, Scale } from 'chart.js';
import type { ChoiceResult } from './types';

type Row = ChoiceResult['rows'][number];

/** 보기 막대 색 / "기타" 막대 색 */
export const BAR_COLOR = '#2563eb';
export const ETC_COLOR = '#71717a';

/** 막대 한 줄의 높이(px)와, 위아래 여백(눈금 글자 자리) */
const ROW_HEIGHT = 36;
const CHART_PADDING = 56;

/** 축 글자가 길면 줄여서 보여 준다. 전체 글은 표와 마우스를 올렸을 때 나온다 */
export function truncateLabel(label: string, max = 18): string {
  const chars = Array.from(label);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : label;
}

/** 차트 데이터: 보기별 비율(%) */
export function choiceChartData(rows: Row[]): ChartData<'bar', number[], string> {
  return {
    labels: rows.map((r) => r.label),
    datasets: [
      {
        data: rows.map((r) => r.percent),
        backgroundColor: rows.map((r) => (r.optionNo === 'etc' ? ETC_COLOR : BAR_COLOR)),
        borderRadius: 4,
        maxBarThickness: 22,
      },
    ],
  };
}

/** 가로축 끝(%): 가장 큰 비율보다 한 칸 넉넉하게, 100을 넘지 않게. 모두 0이면 100 */
export function chartAxisMax(rows: Row[]): number {
  const largest = rows.reduce((max, r) => Math.max(max, r.percent), 0);
  if (largest === 0) return 100;
  return Math.min(100, Math.ceil(largest / 10) * 10 + 10);
}

/** 차트 높이(px): 보기 줄 수에 맞춘다 */
export function chartHeight(rowCount: number): number {
  return rowCount * ROW_HEIGHT + CHART_PADDING;
}

/** 차트 옵션. dark는 어두운 화면용 글자·눈금 색 */
export function choiceChartOptions(rows: Row[], dark: boolean): ChartOptions<'bar'> {
  const text = dark ? '#d4d4d8' : '#3f3f46';
  const grid = dark ? '#3f3f46' : '#e4e4e7';
  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { right: 96 } }, // 막대 끝에 쓰는 "30.0% (12건)" 글자 자리
    scales: {
      x: {
        min: 0,
        max: chartAxisMax(rows),
        ticks: { color: text, callback: (value) => `${value}%` },
        grid: { color: grid },
      },
      y: {
        ticks: {
          color: text,
          callback: function (this: Scale, value) {
            return truncateLabel(this.getLabelForValue(Number(value)));
          },
        },
        grid: { display: false },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const row = rows[context.dataIndex];
            return `${row.count}건 · ${row.percent.toFixed(1)}%`;
          },
        },
      },
    },
  };
}

/** 막대 끝에 "30.0% (12건)"을 적는 플러그인 */
export function valueLabelPlugin(rows: Row[], dark: boolean): Plugin<'bar'> {
  return {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const bars = chart.getDatasetMeta(0).data as BarElement[];
      ctx.save();
      ctx.fillStyle = dark ? '#f4f4f5' : '#18181b';
      ctx.font = '12px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
      ctx.textBaseline = 'middle';
      bars.forEach((bar, i) => {
        const row = rows[i];
        if (!row) return;
        const { x, y } = bar.getProps(['x', 'y'], true);
        if (x === null || y === null) return; // 아직 위치가 정해지지 않은 막대는 건너뛴다
        ctx.fillText(`${row.percent.toFixed(1)}% (${row.count}건)`, x + 6, y);
      });
      ctx.restore();
    },
  };
}
