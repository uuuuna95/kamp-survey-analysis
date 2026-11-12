// 집단별 경향 — 부서별·직급별로 객관식 문항의 특정 보기 응답 비율이 다른 집단보다 특히 높은 경우만 알려 준다.
// 화면("③ 문항별 결과" 아래 "집단별 경향")과 엑셀(부서별·직급별 시트)이 같은 결과를 쓴다.
//
// 기준: 한 집단에서 어떤 보기의 비율이, 그 집단을 뺀 나머지 응답자 전체에서의 비율보다 HIGH_GAP_POINTS(%p) 이상 높으면 적는다.
// 숫자는 앱이 이미 센 집단별 결과(analyze.ts의 groups)에서 가져오고, 부서·직급 정보는 AI에 보내지 않는다.
// 값이 비어 있는 집단(미기재)은 문장의 주인공으로 적지 않는다(다른 집단과 비교할 때 "나머지"에는 들어간다).

import type { Analysis, GroupRole } from './analyze';
import { NO_GROUP_NAME } from './analyze';

/** 다른 집단보다 이만큼(%p) 이상 높으면 "특히 높게 나타났습니다"로 적는다 */
export const HIGH_GAP_POINTS = 30;

export interface GroupHighlight {
  no: number;
  title: string;
  /** 보기 이름 (예: "2. 그렇다") */
  option: string;
  /** 집단 이름 (예: "영업부", "과장") */
  group: string;
  /** 그 집단에서 이 보기의 비율 (화면 집단 표와 같은 값) */
  percent: number;
  /** 그 집단을 뺀 나머지 응답자에서 이 보기의 비율 (소수 첫째 자리) */
  othersPercent: number;
  /** 화면·엑셀에 보여 줄 문장 */
  text: string;
}

export interface GroupTrend {
  role: GroupRole;
  /** 열 제목 (예: "부서") */
  label: string;
  highlights: GroupHighlight[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 고른 집단 종류(부서·직급)마다 "특히 높게 나타난" 응답을 찾는다. 집단별 결과가 없으면 빈 배열 */
export function buildGroupTrends(analysis: Analysis): GroupTrend[] {
  const trends = new Map<GroupRole, GroupTrend>();
  for (const item of analysis.questions) {
    const { outcome, question } = item;
    if (item.participant !== null || outcome.type !== 'choice' || !outcome.groups) continue;
    const whole = outcome.result;
    for (const grouped of outcome.groups) {
      const trend = trends.get(grouped.role) ?? trends.set(grouped.role, { role: grouped.role, label: grouped.label, highlights: [] }).get(grouped.role)!;
      for (const g of grouped.groups) {
        if (g.name === NO_GROUP_NAME || g.result.totalSelections === 0) continue;
        const othersTotal = whole.totalSelections - g.result.totalSelections;
        if (othersTotal <= 0) continue; // 비교할 다른 응답이 없다
        g.result.rows.forEach((row, i) => {
          if (row.count === 0) return;
          const mine = (row.count / g.result.totalSelections) * 100;
          const others = ((whole.rows[i].count - row.count) / othersTotal) * 100;
          if (mine - others < HIGH_GAP_POINTS) return;
          trend.highlights.push({
            no: question.no,
            title: question.title,
            option: row.label,
            group: g.name,
            percent: row.percent,
            othersPercent: round1(others),
            text: `Q${question.no}. ${question.title} — "${row.label}": ${g.name}의 답변이 ${row.percent.toFixed(1)}%로 특히 높게 나타났습니다.`,
          });
        });
      }
    }
  }
  return [...trends.values()];
}
