"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useRequireAuth } from "@/lib/session";
import { Spinner } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦", permission: "analytics:view" },
  { href: "/jobs", label: "Jobs", icon: "▤", permission: "job:view" },
  { href: "/candidates", label: "Candidates", icon: "◍", permission: "candidate:view" },
  { href: "/upload", label: "Upload resumes", icon: "⤒", permission: "resume:upload" },
  { href: "/team", label: "Team", icon: "⚇", permission: "team:view" },
  { href: "/settings", label: "Settings", icon: "⚙", permission: "job:view" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, org, loading, can, signOut, switchOrg } = useRequireAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading your workspace…" />
      </div>
    );
  }
  if (!me || !org) return null;

  const visible = NAV.filter((item) => can(item.permission));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b backdrop-blur" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface-raised) 90%, transparent)" }}>
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5">
          <button className="btn-ghost px-2 py-1 lg:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
            ☰
          </button>
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="grid size-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">V</span>
            <span className="hidden sm:inline">Veyra Talent</span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {me.organizations.length > 1 && (
              <select className="input w-auto py-1.5 text-sm" value={org.id} onChange={(e) => switchOrg(e.target.value)} aria-label="Switch organization">
                {me.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{me.name}</p>
              <p className="text-xs leading-tight" style={{ color: "var(--text-muted)" }}>
                {org.role.replace(/_/g, " ").toLowerCase()}
              </p>
            </div>
            <button className="btn-secondary py-1.5" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6">
        <nav className={`${menuOpen ? "block" : "hidden"} lg:block lg:w-56 lg:shrink-0`} aria-label="Main">
          <ul className="card sticky top-20 space-y-0.5 p-2">
            {visible.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-brand-600 text-white" : "hover:bg-[var(--surface-sunken)]"}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span aria-hidden="true" className="opacity-80">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
