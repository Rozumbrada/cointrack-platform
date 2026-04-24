"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

interface OrganizationDto {
  id: string;
  name: string;
  planTier: string;
  memberCount: number;
  myRole: string;
  type: string;
  currency: string;
}

interface OrganizationListResponse {
  organizations: OrganizationDto[];
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrganizationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) =>
          api<OrganizationListResponse>("/api/v1/org", { token: t }),
        );
        setOrgs(res.organizations);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const b2b = orgs.filter((o) => o.type === "B2B");
  const groups = orgs.filter((o) => o.type === "GROUP");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Organizace a skupiny</h1>
        <p className="text-sm text-ink-600 mt-1">
          B2B firmy (sdílené účetnictví) a skupinové profily (dělení výdajů).
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : orgs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="font-medium text-ink-900">Žádné organizace</div>
          <p className="text-sm text-ink-600 mt-2">
            Vytvoř firmu nebo skupinu v mobilní aplikaci.
          </p>
        </div>
      ) : (
        <>
          <OrgSection title="Firmy (B2B)" icon="🏢" orgs={b2b} />
          <OrgSection title="Skupiny" icon="👥" orgs={groups} />
        </>
      )}
    </div>
  );
}

function OrgSection({
  title,
  icon,
  orgs,
}: {
  title: string;
  icon: string;
  orgs: OrganizationDto[];
}) {
  if (orgs.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-ink-200">
      <div className="px-6 py-3 border-b border-ink-200">
        <h2 className="font-semibold text-ink-900">{title}</h2>
      </div>
      <ul className="divide-y divide-ink-100">
        {orgs.map((o) => (
          <li key={o.id} className="px-6 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-ink-100 grid place-items-center text-xl">
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink-900 truncate">
                {o.name}
              </div>
              <div className="text-xs text-ink-500 flex items-center gap-2">
                <span>{o.memberCount} členů</span>
                <span>·</span>
                <span>{o.currency}</span>
                <span>·</span>
                <span className="text-[10px] uppercase tracking-wide bg-ink-100 text-ink-700 px-1.5 py-0.5 rounded">
                  {labelRole(o.myRole)}
                </span>
              </div>
            </div>
            <div className="text-[10px] uppercase text-ink-500">{o.planTier}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function labelRole(r: string): string {
  switch (r) {
    case "owner": return "vlastník";
    case "admin": return "admin";
    case "member": return "člen";
    default: return r;
  }
}
