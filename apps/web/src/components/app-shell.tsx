"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useRequireAuth } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { Icon, type IconName } from "./icons";
import { Spinner } from "./ui";

type NavItem = { href: string; label: string; icon: IconName; permission: string };
type NavGroup = { group: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "analytics:view" }],
  },
  {
    group: "Hiring",
    items: [
      { href: "/jobs", label: "Jobs", icon: "jobs", permission: "job:view" },
      { href: "/candidates", label: "Candidates", icon: "candidates", permission: "candidate:view" },
      { href: "/talent-search", label: "Smart search", icon: "search", permission: "candidate:view" },
      { href: "/copilot", label: "Copilot", icon: "copilot", permission: "job:view" },
    ],
  },
  {
    group: "Evaluate",
    items: [
      { href: "/interviews", label: "Interviews", icon: "interviews", permission: "interview:view" },
      { href: "/assessments", label: "Assessments", icon: "assessments", permission: "assessment:view" },
      { href: "/offers", label: "Offers", icon: "offers", permission: "offer:view" },
    ],
  },
  {
    group: "Workspace",
    items: [
      { href: "/upload", label: "Upload resumes", icon: "upload", permission: "resume:upload" },
      { href: "/communications", label: "Communications", icon: "mail", permission: "email:send" },
      { href: "/team", label: "Team", icon: "team", permission: "team:view" },
      { href: "/settings", label: "Settings", icon: "settings", permission: "job:view" },
    ],
  },
];

function activeFor(pathname: string) {
  for (const g of NAV) {
    for (const item of g.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item;
    }
  }
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, org, loading, can, signOut, switchOrg } = useRequireAuth();
  const pathname = usePathname();
  const { theme, ready, toggle } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading your workspace…" />
      </div>
    );
  }
  if (!me || !org) return null;

  const current = activeFor(pathname);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter((g) => g.items.length);

  const railBody = (
    <>
      <div className="flex h-14 items-center gap-2.5 px-4" style={{ borderBottom: "1px solid var(--rail-line)" }}>
        <span className="grid size-8 place-items-center rounded-md font-bold" style={{ background: "var(--rail-active)", color: "#042023" }}>
          V
        </span>
        <span className="font-semibold tracking-tight" style={{ color: "var(--rail-ink)" }}>
          Veyra Talent
        </span>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 pb-4" aria-label="Main">
        {groups.map((g) => (
          <div key={g.group}>
            <p className="rail-group">{g.group}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = current?.href === item.href;
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={`rail-link ${active ? "rail-link-active" : ""}`} aria-current={active ? "page" : undefined}>
                      <Icon name={item.icon} size={17} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-3 py-3 text-[11px]" style={{ borderTop: "1px solid var(--rail-line)", color: "var(--rail-muted)" }}>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="shield" size={13} /> AI is decision-support only
        </span>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh lg:grid" style={{ gridTemplateColumns: "var(--rail-w) 1fr" }}>
      {/* Desktop rail */}
      <aside className="rail sticky top-0 hidden h-dvh flex-col lg:flex">{railBody}</aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="rail animate-pop absolute inset-y-0 left-0 flex w-64 flex-col">
            <button className="absolute right-2 top-3.5 rounded-md p-1.5" style={{ color: "var(--rail-muted)" }} onClick={() => setDrawerOpen(false)} aria-label="Close menu">
              <Icon name="close" size={18} />
            </button>
            {railBody}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="topbar">
          <button className="btn-ghost btn-icon lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
            <Icon name="menu" size={18} />
          </button>

          <nav className="flex min-w-0 items-center gap-1.5" aria-label="Breadcrumb">
            <span className="crumb hidden sm:inline">{org.name}</span>
            <Icon name="chevron-right" size={13} className="hidden shrink-0 opacity-40 sm:block" />
            <span className="crumb crumb-current">{current?.label ?? "Workspace"}</span>
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            {me.organizations.length > 1 && (
              <select className="select hidden w-auto sm:block" value={org.id} onChange={(e) => switchOrg(e.target.value)} aria-label="Switch organization">
                {me.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}

            <button className="btn-ghost btn-icon" onClick={toggle} aria-label="Toggle colour theme" title="Toggle theme">
              {ready ? <Icon name={theme === "dark" ? "sun" : "moon"} size={17} /> : <span className="size-[17px]" />}
            </button>

            <div className="relative" ref={userRef}>
              <button className="btn-ghost flex items-center gap-2 pl-1.5 pr-2" onClick={() => setUserOpen((v) => !v)} aria-haspopup="menu" aria-expanded={userOpen}>
                <span className="grid size-7 place-items-center rounded-full text-xs font-semibold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                  {me.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-[13px] font-medium">{me.name}</span>
                  <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {org.role.replace(/_/g, " ").toLowerCase()}
                  </span>
                </span>
                <Icon name="chevron-down" size={14} className="hidden opacity-50 sm:block" />
              </button>

              {userOpen && (
                <div className="card animate-pop absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden p-1" style={{ boxShadow: "var(--shadow-float)" }} role="menu">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-medium">{me.name}</p>
                    <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {me.email}
                    </p>
                  </div>
                  <div className="divider my-1" />
                  <Link href="/settings" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-[var(--surface-hover)]" role="menuitem" onClick={() => setUserOpen(false)}>
                    <Icon name="settings" size={16} /> Settings
                  </Link>
                  <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)]" role="menuitem" onClick={() => void signOut()}>
                    <Icon name="logout" size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
