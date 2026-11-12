// Design Ref: §6 — 엑셀에 넣을 차트 그림(PNG). 화면과 같은 차트 설정(chart-config)으로 보이지 않는 캔버스에 그려서 그림으로 바꾼다.
// 브라우저에서만 쓴다(캔버스가 필요하다). 엑셀 만들기(build-workbook.ts)에는 renderChart로 넘긴다.

import { BarController, BarElement, CategoryScale, Chart, LinearScale } from 'chart.js';
import type { Plugin } from 'chart.js';
import { chartHeight, choiceChartData, choiceChartOptions, valueLabelPlugin } from '../survey/chart-config';
import type { ChoiceResult } from '../survey/types';
import { CHART_IMAGE_WIDTH } from './build-workbook';

Chart.register(BarController, BarElement, CategoryScale, LinearScale);

/** 그림 배경을 흰색으로 (PNG는 기본이 투명이라 엑셀에서 검게 보일 수 있다) */
const whiteBackground: Plugin<'bar'> = {
  id: 'whiteBackground',
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

/** 객관식 결과 하나를 차트 그림(PNG 바이트)으로 만든다. 응답이 없으면 null */
export async function renderChoiceChartPng(result: ChoiceResult): Promise<Uint8Array | null> {
  if (result.totalSelections === 0) return null;
  const { rows } = result;
  const canvas = document.createElement('canvas');
  canvas.width = CHART_IMAGE_WIDTH;
  canvas.height = chartHeight(rows.length);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: choiceChartData(rows),
    // 크기는 위에서 정했으므로 화면 크기에 맞춰 늘어나지 않게 하고, 글자가 또렷하도록 2배 해상도로 그린다
    options: { ...choiceChartOptions(rows, false), responsive: false, animation: false, devicePixelRatio: 2 },
    plugins: [whiteBackground, valueLabelPlugin(rows, false)],
  });
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally {
    chart.destroy();
  }
}
