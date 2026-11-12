'use client';

// 집단별 경향 — "③ 문항별 결과" 아래에 놓는다. 부서별·직급별로 객관식 문항의 어떤 보기 응답 비율이
// 다른 집단보다 30%p 이상 특히 높은 경우만 문장으로 알려 준다. 숫자는 앱이 센 값이고, 부서·직급 정보는 AI에 보내지 않는다.

import { HIGH_GAP_POINTS } from '@/lib/survey/group-trends';
import type { GroupTrend } from '@/lib/survey/group-trends';

export default function GroupTrends({ trends }: { trends: GroupTrend[] }) {
  if (trends.length === 0) return null;
  return (
    <section aria-labelledby="group-trends-title" data-role="group-trends" className="mt-6">
      <h2 id="group-trends-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        부서별·직급별 경향
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        객관식 문항에서 어떤 보기의 응답 비율이 다른 집단보다 {HIGH_GAP_POINTS}%p 이상 높은 경우만 알려 드려요. 숫자는 앱이 직접 센 값이고, 부서·직급 정보는 AI에 보내지 않아요.
      </p>
      <div className="mt-3 space-y-4">
        {trends.map((trend) => (
          <div
            key={trend.role}
            data-group-role={trend.role}
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{trend.label}별 경향</h3>
            {trend.highlights.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                다른 {trend.label}보다 {HIGH_GAP_POINTS}%p 이상 특히 높게 나타난 응답이 없어요.
              </p>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
                {trend.highlights.map((h) => (
                  <li key={`${h.no}-${h.option}-${h.group}`}>{h.text}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
