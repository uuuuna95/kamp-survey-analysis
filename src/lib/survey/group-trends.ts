// 집단별 경향 — 부서별·직급별로 문항마다 어떤 응답을 했고 어떤 의견이 있는지 요약한다.
// 화면(AI 해석 아래 "집단별 경향")과 엑셀(부서별·직급별 시트)이 같은 결과를 쓴다.
//
// 모든 숫자는 앱이 이미 센 집단별 결과(analyze.ts의 groups)에서 그대로 가져오고 다시 세지 않는다.
// 참여자 정보(부서·직급)는 AI에 보내지 않는다. 주관식·서술형의 "집단별 주요 의견"은 AI가 이미 묶은 의견(관점 id 목록)을
// 앱이 응답자 순번으로 집단에 나눠 세서 만든다. AI 해석이 없으면 응답 수와 응답 원문만 보여 준다.

import type { Analysis, GroupRole } from './analyze';
import { NO_GROUP_NAME } from './analyze';
import type { Interpretation } from './types';

/** 집단 비율이 전체 비율과 이만큼(%p) 이상 차이 나면 경향 요약에 적는다 */
export const GAP_POINTS = 20;
/** 경향 요약에 집단별로 적는 주요 의견 수 */
export const TOP_OPINIONS = 3;

export interface TopChoice {
  /** 가장 많이 고른 보기 (같은 건수면 모두, "·"로 잇는다) */
  label: string;
  percent: number;
}

export interface ChoiceTrend {
  no: number;
  title: string;
  /** 보기 줄 이름 (문항 전체 표와 같은 순서, "기타" 포함) */
  labels: string[];
  overall: { counts: number[]; percents: number[]; top: TopChoice | null };
  groups: { name: string; respondents: number; answered: number; counts: number[]; percents: number[]; top: TopChoice | null }[];
}

export interface TextTrend {
  no: number;
  title: string;
  groups: { name: string; respondents: number; answers: string[]; opinions: { summary: string; count: number }[] }[];
  /** AI 해석(주요 의견)이 있는가 */
  hasOpinions: boolean;
}

export interface GroupTrend {
  role: GroupRole;
  /** 열 제목 (예: "부서") */
  label: string;
  /** 집단 이름과 응답자 수 (응답자가 많은 집단부터, 미기재는 맨 뒤) */
  groups: { name: string; respondents: number }[];
  choice: ChoiceTrend[];
  text: TextTrend[];
  /** 경향 요약 문장 */
  highlights: string[];
}

function topOf(labels: string[], counts: number[], percents: number[]): TopChoice | null {
  const max = Math.max(0, ...counts);
  if (max === 0) return null;
  const idx = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
  return { label: idx.map((i) => labels[i]).join('·'), percent: percents[idx[0]] };
}

const shortTitle = (title: string) => (Array.from(title).length > 30 ? `${Array.from(title).slice(0, 29).join('')}…` : title);
const fmt = (n: number) => n.toFixed(1);

/**
 * 고른 집단 종류(부서·직급)마다 경향을 만든다. 집단별 결과가 없으면(고르지 않았거나 값이 없으면) 빈 배열.
 * interpretations는 지금 화면에 있는 AI 해석 (주관식·서술형 주요 의견을 집단별로 나눌 때만 쓴다).
 */
export function buildGroupTrends(analysis: Analysis, interpretations: Readonly<Record<number, Interpretation>> = {}): GroupTrend[] {
  const trends = new Map<GroupRole, GroupTrend>();
  const trendFor = (role: GroupRole, label: string, groups: { name: string; respondents: number }[]) =>
    trends.get(role) ?? trends.set(role, { role, label, groups, choice: [], text: [], highlights: [] }).get(role)!;

  for (const item of analysis.questions) {
    const { outcome, question } = item;
    if (item.participant !== null || !outcome.groups) continue;

    if (outcome.type === 'choice') {
      const labels = outcome.result.rows.map((r) => r.label);
      const counts = outcome.result.rows.map((r) => r.count);
      const percents = outcome.result.rows.map((r) => r.percent);
      for (const grouped of outcome.groups) {
        const trend = trendFor(
          grouped.role,
          grouped.label,
          grouped.groups.map((g) => ({ name: g.name, respondents: g.result.respondents })),
        );
        trend.choice.push({
          no: question.no,
          title: question.title,
          labels,
          overall: { counts, percents, top: topOf(labels, counts, percents) },
          groups: grouped.groups.map((g) => {
            const gc = g.result.rows.map((r) => r.count);
            const gp = g.result.rows.map((r) => r.percent);
            return { name: g.name, respondents: g.result.respondents, answered: g.result.totalSelections, counts: gc, percents: gp, top: topOf(labels, gc, gp) };
          }),
        });
      }
    } else {
      const opinions = interpretations[question.no]?.opinions ?? [];
      const respondentOfView = new Map(outcome.result.views.map((v) => [v.id, v.respondent]));
      for (const grouped of outcome.groups) {
        const trend = trendFor(
          grouped.role,
          grouped.label,
          grouped.groups.map((g) => ({ name: g.name, respondents: g.respondents })),
        );
        trend.text.push({
          no: question.no,
          title: question.title,
          hasOpinions: opinions.length > 0,
          groups: grouped.groups.map((g) => {
            const members = new Set(g.respondentNos);
            const groupOpinions = opinions
              .map((o) => ({
                summary: o.summary,
                count: new Set(o.viewIds.map((id) => respondentOfView.get(id)).filter((r): r is number => r !== undefined && members.has(r))).size,
              }))
              .filter((o) => o.count > 0)
              .sort((a, b) => b.count - a.count);
            return { name: g.name, respondents: g.respondents, answers: g.answers, opinions: groupOpinions };
          }),
        });
      }
    }
  }

  for (const trend of trends.values()) trend.highlights = highlightsOf(trend);
  return [...trends.values()];
}

/** 경향 요약 문장: 전체와 가장 많이 고른 보기가 다른 집단, 비율 차이가 큰 집단, 집단별 주요 의견 */
function highlightsOf(trend: GroupTrend): string[] {
  const lines: string[] = [];
  for (const q of trend.choice) {
    const overallTop = q.overall.top;
    if (!overallTop) continue;
    const topIndex = q.labels.indexOf(overallTop.label.split('·')[0]);
    for (const g of q.groups) {
      if (g.name === NO_GROUP_NAME || !g.top) continue;
      if (g.top.label !== overallTop.label) {
        lines.push(
          `Q${q.no} ${shortTitle(q.title)} — ${g.name}: 가장 많이 고른 보기가 "${g.top.label}"(${fmt(g.top.percent)}%)로, 전체("${overallTop.label}" ${fmt(overallTop.percent)}%)와 달라요.`,
        );
      } else if (topIndex >= 0) {
        const gap = g.percents[topIndex] - q.overall.percents[topIndex];
        if (Math.abs(gap) >= GAP_POINTS) {
          lines.push(
            `Q${q.no} ${shortTitle(q.title)} — ${g.name}: "${q.labels[topIndex]}" 비율이 ${fmt(g.percents[topIndex])}%로 전체(${fmt(q.overall.percents[topIndex])}%)보다 ${fmt(Math.abs(gap))}%p ${gap > 0 ? '높아요' : '낮아요'}.`,
          );
        }
      }
    }
  }
  if (trend.choice.length > 0 && lines.length === 0) {
    lines.push(`객관식 문항마다 모든 ${trend.label} 집단이 전체와 같은 보기를 가장 많이 골랐고, 비율 차이도 ${GAP_POINTS}%p보다 작아요.`);
  }
  for (const q of trend.text) {
    if (!q.hasOpinions) continue;
    for (const g of q.groups) {
      if (g.name === NO_GROUP_NAME || g.opinions.length === 0) continue;
      lines.push(`Q${q.no} ${shortTitle(q.title)} — ${g.name}: 가장 많이 나온 의견은 "${g.opinions[0].summary}"(${g.opinions[0].count}명)이에요.`);
    }
  }
  return lines;
}
