import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryEntry, Settings } from "../types";
import { formatDuration } from "../types";
import type { ScheduleEntry } from "../lib/schedule";
import { upcoming } from "../lib/schedule";
import { ACCENTS, type Prefs, type ThemeMode } from "../lib/theme";
import { Avatar, colorFor } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { useDevices } from "../lib/useDevices";

export type Page = "home" | "meetings" | "recordings" | "settings";

type Props = {
  page: Page;
  onPage: (page: Page) => void;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  history: HistoryEntry[];
  schedule: ScheduleEntry[];
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  online: boolean | null;
  busy: boolean;
  personalRoom: string;
  onInstant: () => void;
  onJoinCode: () => void;
  onSchedule: () => void;
  onStartScheduled: (entry: ScheduleEntry) => void;
  onJoinRoom: (room: string, passcode?: string) => void;
  onStartPersonal: () => void;
  onOpenShortcuts: () => void;
  onCopy: (text: string, message?: string) => void;
};

const PAGES: Record<Page, string> = {
  home: "Home",
  meetings: "Meetings",
  recordings: "Recordings",
  settings: "Settings",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function timeLabel(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(ms: number) {
  const date = new Date(ms);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function sameDay(a: number, b: Date) {
  const date = new Date(a);
  return (
    date.getFullYear() === b.getFullYear() &&
    date.getMonth() === b.getMonth() &&
    date.getDate() === b.getDate()
  );
}

function titleFor(room: string, schedule: ScheduleEntry[]): string {
  return schedule.find((entry) => entry.room === room)?.title ?? `Room ${room}`;
}

export function Dashboard(props: Props) {
  const {
    page,
    onPage,
    settings,
    onSettings,
    history,
    schedule,
    prefs,
    onPrefs,
    online,
    busy,
    personalRoom,
    onInstant,
    onJoinCode,
    onSchedule,
    onStartScheduled,
    onJoinRoom,
    onStartPersonal,
    onOpenShortcuts,
    onCopy,
  } = props;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [bellOpen, setBellOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) setBellOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "n") onInstant();
      else if (key === "j") onJoinCode();
      else if (key === "s") onSchedule();
      else if (key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onInstant, onJoinCode, onSchedule]);

  const upcomingList = useMemo(() => upcoming(schedule, now), [schedule, now]);
  const rooms = upcomingList.slice(0, 3);

  function go(pageName: Page) {
    onPage(pageName);
    setSidebarOpen(false);
  }

  return (
    <div className="app">
      {sidebarOpen && <div className="scrim open" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sb-head">
          <button className="brand" onClick={() => go("home")}>
            <Logo />
            <span>OpenMeet</span>
          </button>
          <span className="tag-oss">v0.1 · OSS</span>
        </div>

        <div className="sb-new">
          <button className="btn btn-primary btn-block" onClick={onInstant} disabled={busy} title="New meeting">
            <Icon name="plus" />
            <span>New meeting</span>
            <span className="kbd">N</span>
          </button>
        </div>

        <nav className="nav">
          <NavItem icon="house" label="Home" active={page === "home"} onClick={() => go("home")} />
          <NavItem
            icon="calendar"
            label="Meetings"
            active={page === "meetings"}
            count={upcomingList.length}
            onClick={() => go("meetings")}
          />
          <NavItem icon="circle-play" label="Recordings" active={page === "recordings"} onClick={() => go("recordings")} />
          <NavItem icon="settings" label="Settings" active={page === "settings"} onClick={() => go("settings")} />
        </nav>

        <div className="sb-label">
          <span>Rooms</span>
        </div>
        <button className="nav-item room-link" onClick={onStartPersonal}>
          <span className="room-dot" style={{ background: colorFor(settings.displayName || "you") }} />
          <span>Personal room</span>
        </button>
        {rooms.map((entry) => (
          <button
            key={entry.id}
            className="nav-item room-link"
            onClick={() => onJoinRoom(entry.room)}
            title={`Join ${entry.title}`}
          >
            <span className="room-dot" style={{ background: entry.color }} />
            <span>{entry.title}</span>
          </button>
        ))}

        <div className="sb-foot">
          <div className={`server-card ${online ? "ok" : online === false ? "bad" : ""}`}>
            <span className="dot" />
            <div>
              <b>{online ? "Connected" : online === false ? "Offline" : "Checking…"}</b>
              <span className="truncate">{settings.serverUrl}</span>
            </div>
          </div>
          <button className="profile" onClick={() => go("settings")}>
            <Avatar name={settings.displayName || "Guest"} size={32} />
            <div className="p-text">
              <div className="p-name">{settings.displayName || "Set your name"}</div>
              <div className="p-mail">{personalRoom}</div>
            </div>
            <Icon name="chevrons-up-down" />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="crumbs">
            <span>Workspace</span>
            <Icon name="chevron-right" size={14} />
            <b>{PAGES[page]}</b>
          </div>
          <div className="input-wrap top-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              className="input"
              placeholder="Search meetings, rooms…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="kbd">/</span>
          </div>
          <button
            className="icon-btn"
            title="Toggle theme"
            onClick={() => onPrefs({ theme: (prefs.theme === "light" ? "dark" : "light") as ThemeMode })}
          >
            <Icon name={prefs.theme === "light" ? "moon" : "sun"} />
          </button>
          <div className="bell-wrap" ref={bellRef}>
            <button className="icon-btn" onClick={() => setBellOpen((value) => !value)} title="Reminders">
              <Icon name="bell" />
              {upcomingList.length > 0 && <span className="notif-dot" />}
            </button>
            {bellOpen && (
              <div className="popover bell-pop">
                <div className="pop-label">Coming up</div>
                {upcomingList.length === 0 && <div className="pop-empty">Nothing scheduled.</div>}
                {upcomingList.slice(0, 4).map((entry) => (
                  <button key={entry.id} className="pop-row" onClick={() => onJoinRoom(entry.room)}>
                    <span className="room-dot" style={{ background: entry.color }} />
                    <span className="grow">
                      <b>{entry.title}</b>
                      <small>
                        {dayLabel(entry.start)} · {timeLabel(entry.start)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {page === "home" && (
          <HomePage
            settings={settings}
            history={history}
            schedule={schedule}
            upcomingList={upcomingList}
            search={search}
            personalRoom={personalRoom}
            busy={busy}
            onInstant={onInstant}
            onJoinCode={onJoinCode}
            onSchedule={onSchedule}
            onStartScheduled={onStartScheduled}
            onJoinRoom={onJoinRoom}
            onCopy={onCopy}
            onPage={go}
          />
        )}
        {page === "meetings" && (
          <MeetingsPage
            schedule={schedule}
            upcomingList={upcomingList}
            history={history}
            onJoinRoom={onJoinRoom}
            onStartScheduled={onStartScheduled}
            onSchedule={onSchedule}
            onJoinCode={onJoinCode}
            onCopy={onCopy}
          />
        )}
        {page === "recordings" && <RecordingsPage />}
        {page === "settings" && (
          <SettingsPage
            settings={settings}
            onSettings={onSettings}
            prefs={prefs}
            onPrefs={onPrefs}
            personalRoom={personalRoom}
            online={online}
            onCopy={onCopy}
            onOpenShortcuts={onOpenShortcuts}
          />
        )}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b8ff8" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-gradient)" />
      <rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="#fff" strokeOpacity=".18" />
      <path
        d="M21.6 10.6A7.4 7.4 0 1 0 23.4 16"
        fill="none"
        stroke="#fff"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
      <circle cx="22.9" cy="9.4" r="2" fill="#fff" />
    </svg>
  );
}

function NavItem({
  icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick} title={label}>
      <Icon name={icon} />
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function HomePage({
  settings,
  history,
  schedule,
  upcomingList,
  search,
  personalRoom,
  busy,
  onInstant,
  onJoinCode,
  onSchedule,
  onStartScheduled,
  onJoinRoom,
  onCopy,
  onPage,
}: {
  settings: Settings;
  history: HistoryEntry[];
  schedule: ScheduleEntry[];
  upcomingList: ScheduleEntry[];
  search: string;
  personalRoom: string;
  busy: boolean;
  onInstant: () => void;
  onJoinCode: () => void;
  onSchedule: () => void;
  onStartScheduled: (entry: ScheduleEntry) => void;
  onJoinRoom: (room: string) => void;
  onCopy: (text: string, message?: string) => void;
  onPage: (page: Page) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const hour = new Date().getHours();
  const name = (settings.displayName || "").trim().split(" ")[0];
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = upcomingList.filter((entry) => sameDay(entry.start, new Date()));
  const next = upcomingList[0];
  const minutes = next ? Math.round((next.start - now) / 60000) : 0;

  const week = history.filter((entry) => now - entry.startedAt < 7 * 86400000);
  const weekMinutes = Math.round(week.reduce((sum, entry) => sum + entry.durationSecs, 0) / 60);

  const needle = search.trim().toLowerCase();
  const filteredUpcoming = needle
    ? upcomingList.filter((entry) => entry.title.toLowerCase().includes(needle) || entry.room.includes(needle))
    : upcomingList;
  const filteredHistory = needle
    ? history.filter((entry) => entry.room.includes(needle) || titleFor(entry.room, schedule).toLowerCase().includes(needle))
    : history;

  const chartDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const count = history.filter((entry) => sameDay(entry.startedAt, date)).length;
    return { label: date.toLocaleDateString([], { weekday: "narrow" }), count, today: index === 6 };
  });
  const max = Math.max(1, ...chartDays.map((day) => day.count));

  return (
    <section className="page active">
      <div className="hero">
        <div>
          <div className="eyebrow">
            <Icon name="calendar-days" size={14} />
            <span>{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
          </div>
          <h1>{name ? `${greeting}, ${name}` : greeting}</h1>
          <p>
            {today.length > 0 ? (
              <>
                You have <b>{today.length}</b> meeting{today.length > 1 ? "s" : ""} today
                {next && minutes > 0 && minutes < 120 ? (
                  <>
                    . Next one starts in <b>{minutes} min</b>.
                  </>
                ) : (
                  "."
                )}
              </>
            ) : (
              "Your calendar is clear. Start something."
            )}
          </p>
        </div>
        <div className="clock">
          {pad(new Date(now).getHours())}:{pad(new Date(now).getMinutes())}
          <small>{Intl.DateTimeFormat().resolvedOptions().timeZone.replace("_", " ")}</small>
        </div>
      </div>

      <div className="qa-grid">
        <button className="qa qa-primary" onClick={onInstant} disabled={busy}>
          <div className="qa-icon">
            <Icon name="video" size={18} />
          </div>
          <div>
            <div className="qa-title">Start an instant meeting</div>
            <div className="qa-desc">Spin up a room and invite anyone</div>
          </div>
          <Icon name="arrow-up-right" className="qa-arrow" />
          <span className="kbd">N</span>
        </button>
        <button className="qa" onClick={onJoinCode}>
          <div className="qa-icon">
            <Icon name="keyboard" size={18} />
          </div>
          <div>
            <div className="qa-title">Join with code</div>
            <div className="qa-desc">Enter a room ID or link</div>
          </div>
          <Icon name="arrow-up-right" className="qa-arrow" />
          <span className="kbd">J</span>
        </button>
        <button className="qa" onClick={onSchedule}>
          <div className="qa-icon">
            <Icon name="calendar-plus" size={18} />
          </div>
          <div>
            <div className="qa-title">Schedule meeting</div>
            <div className="qa-desc">Plan ahead and share the link</div>
          </div>
          <Icon name="arrow-up-right" className="qa-arrow" />
          <span className="kbd">S</span>
        </button>
      </div>

      <div className="home-cols">
        <div className="card">
          <div className="card-head">
            <h3>Upcoming meetings</h3>
            <button className="link" onClick={() => onPage("meetings")}>
              View calendar <Icon name="arrow-right" size={14} />
            </button>
          </div>
          <div className="mlist">
            {filteredUpcoming.length === 0 && <div className="empty">Nothing scheduled yet.</div>}
            {filteredUpcoming.slice(0, 4).map((entry) => (
              <ScheduleRow
                key={entry.id}
                entry={entry}
                now={now}
                onStart={() => onStartScheduled(entry)}
                onJoin={() => onJoinRoom(entry.room)}
                onCopy={() => onCopy(`openmeet.app/${entry.room}`, "Room code copied")}
              />
            ))}
          </div>
        </div>

        <div className="side-col">
          <div className="card room-card">
            <h4>Personal room</h4>
            <div className="sub">Always-on link, just for you</div>
            <div className="room-id">
              <span className="mono">{personalRoom}</span>
              <button className="icon-btn sm" onClick={() => onCopy(personalRoom, "Room code copied")} title="Copy">
                <Icon name="copy" size={14} />
              </button>
            </div>
            <div className="room-btns">
              <button className="btn btn-secondary btn-sm" onClick={() => onCopy(personalRoom, "Room code copied")}>
                <Icon name="link" size={14} /> Copy link
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => onStartScheduled({ title: "Personal room", start: now, duration: 30, room: personalRoom, id: "personal", color: "#6366f1" })}>
                <Icon name="video" size={14} /> Start
              </button>
            </div>
          </div>

          <div className="card stats">
            <div className="stats-head">
              <h3>This week</h3>
              <span className="chip chip-accent">
                <Icon name="trending-up" size={12} /> local
              </span>
            </div>
            <div className="stats-nums">
              <Stat value={String(week.length)} label="Meetings" />
              <Stat value={weekMinutes >= 60 ? `${(weekMinutes / 60).toFixed(1)}h` : `${weekMinutes}m`} label="In calls" />
              <Stat value={String(history.length)} label="Total" />
            </div>
            <div className="chart">
              {chartDays.map((day) => (
                <div key={day.label + day.count} className={day.today ? "today" : ""}>
                  <i style={{ height: `${Math.max(6, (day.count / max) * 100)}%` }} />
                  <span>{day.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Recent meetings</h3>
          <button className="link" onClick={() => onPage("meetings")}>
            View all <Icon name="arrow-right" size={14} />
          </button>
        </div>
        <HistoryTable history={filteredHistory.slice(0, 6)} schedule={schedule} onJoin={onJoinRoom} />
      </div>
    </section>
  );
}

function ScheduleRow({
  entry,
  now,
  onStart,
  onJoin,
  onCopy,
}: {
  entry: ScheduleEntry;
  now: number;
  onStart: () => void;
  onJoin: () => void;
  onCopy: () => void;
}) {
  const minutes = Math.round((entry.start - now) / 60000);
  const live = minutes <= 15 && minutes > -entry.duration;
  return (
    <div className="mrow">
      <div className="mtime">
        <b>{timeLabel(entry.start)}</b>
        <span>{dayLabel(entry.start)}</span>
      </div>
      <span className="mbar" style={{ background: entry.color }} />
      <div className="minfo">
        <div className="mtitle">{entry.title}</div>
        <div className="mmeta">
          <Icon name="clock" size={12} /> {entry.duration} min<span className="dotsep" />
          <span className="mono">{entry.room}</span>
        </div>
      </div>
      <div className="mact">
        {live ? (
          <span className="live-badge">
            <i />
            {minutes <= 0 ? "Live now" : `In ${minutes} min`}
          </span>
        ) : (
          <button className="icon-btn" onClick={onCopy} title="Copy room code">
            <Icon name="link" size={15} />
          </button>
        )}
        <button className={`btn btn-sm ${live ? "btn-primary" : "btn-secondary"}`} onClick={live ? onJoin : onStart}>
          {live ? "Join" : "Start"}
        </button>
      </div>
    </div>
  );
}

function HistoryTable({
  history,
  schedule,
  onJoin,
}: {
  history: HistoryEntry[];
  schedule: ScheduleEntry[];
  onJoin: (room: string) => void;
}) {
  if (history.length === 0) {
    return <div className="empty">Meetings you join will show up here.</div>;
  }
  return (
    <div className="table">
      <div className="trow head">
        <span>Meeting</span>
        <span>Date</span>
        <span>Duration</span>
        <span>People</span>
        <span />
      </div>
      {history.map((entry, index) => (
        <div className="trow" key={`${entry.room}-${entry.startedAt}-${index}`}>
          <div className="t-title">
            <span className="t-ic" style={{ ["--c" as string]: colorFor(entry.room) }}>
              <Icon name="video" size={15} />
            </span>
            <div>
              <b>{titleFor(entry.room, schedule)}</b>
              <span className="sub mono">{entry.room}</span>
            </div>
          </div>
          <span className="t-cell">
            {new Date(entry.startedAt).toLocaleDateString([], { month: "short", day: "numeric" })} ·{" "}
            {new Date(entry.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className="t-cell mono">{formatDuration(entry.durationSecs)}</span>
          <span className="t-cell">
            <Icon name="users" size={13} /> {entry.participants}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => onJoin(entry.room)}>
            Rejoin
          </button>
        </div>
      ))}
    </div>
  );
}

function MeetingsPage({
  schedule,
  upcomingList,
  history,
  onJoinRoom,
  onStartScheduled,
  onSchedule,
  onJoinCode,
  onCopy,
}: {
  schedule: ScheduleEntry[];
  upcomingList: ScheduleEntry[];
  history: HistoryEntry[];
  onJoinRoom: (room: string) => void;
  onStartScheduled: (entry: ScheduleEntry) => void;
  onSchedule: () => void;
  onJoinCode: () => void;
  onCopy: (text: string) => void;
}) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [day, setDay] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return date;
  });
  const list = day === null ? upcomingList : upcomingList.filter((entry) => sameDay(entry.start, days[day]));

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1>Meetings</h1>
          <p>Your schedule and meeting history.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-secondary" onClick={onJoinCode}>
            <Icon name="keyboard" /> Join
          </button>
          <button className="btn btn-primary" onClick={onSchedule}>
            <Icon name="calendar-plus" /> Schedule
          </button>
        </div>
      </div>

      <div className="seg tabs">
        <button className={tab === "upcoming" ? "active" : ""} onClick={() => setTab("upcoming")}>
          Upcoming <span className="count">{upcomingList.length}</span>
        </button>
        <button className={tab === "past" ? "active" : ""} onClick={() => setTab("past")}>
          History <span className="count">{history.length}</span>
        </button>
      </div>

      {tab === "upcoming" ? (
        <>
          <div className="week">
            {days.map((date, index) => {
              const count = upcomingList.filter((entry) => sameDay(entry.start, date)).length;
              return (
                <button
                  key={date.toDateString()}
                  className={`day ${day === index ? "active" : ""}`}
                  onClick={() => setDay(day === index ? null : index)}
                >
                  <span>{index === 0 ? "Today" : date.toLocaleDateString([], { weekday: "short" })}</span>
                  <b>{date.getDate()}</b>
                  <span className="dots">
                    {Array.from({ length: Math.min(count, 3) }, (_, dot) => (
                      <i key={dot} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="card">
            <div className="mlist">
              {list.length === 0 && <div className="empty">Nothing scheduled for this day.</div>}
              {list.map((entry) => (
                <ScheduleRow
                  key={entry.id}
                  entry={entry}
                  now={now}
                  onStart={() => onStartScheduled(entry)}
                  onJoin={() => onJoinRoom(entry.room)}
                  onCopy={() => onCopy(entry.room)}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <HistoryTable history={history} schedule={schedule} onJoin={onJoinRoom} />
        </div>
      )}
    </section>
  );
}

function RecordingsPage() {
  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1>Recordings</h1>
          <p>Local and cloud recordings will live here.</p>
        </div>
      </div>
      <div className="card empty-state">
        <div className="empty-ic">
          <Icon name="circle-play" size={26} />
        </div>
        <h3>Recording is not available yet</h3>
        <p className="sub">
          OpenMeet v0 does not record calls. The roadmap adds consent-based local recording, then
          optional cloud storage on your own server.
        </p>
        <div className="chip-row">
          <span className="chip">v1: local recording</span>
          <span className="chip">v2: self-hosted storage</span>
        </div>
      </div>
    </section>
  );
}

function SettingsPage({
  settings,
  onSettings,
  prefs,
  onPrefs,
  personalRoom,
  online,
  onCopy,
  onOpenShortcuts,
}: {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  personalRoom: string;
  online: boolean | null;
  onCopy: (text: string) => void;
  onOpenShortcuts: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "av" | "appearance" | "notifications">("profile");
  const devices = useDevices();

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Stored on this device only.</p>
        </div>
      </div>

      <div className="settings">
        <div className="stabs">
          <SettingsTab icon="user" label="Profile" active={tab === "profile"} onClick={() => setTab("profile")} />
          <SettingsTab icon="video" label="Audio & video" active={tab === "av"} onClick={() => setTab("av")} />
          <SettingsTab icon="palette" label="Appearance" active={tab === "appearance"} onClick={() => setTab("appearance")} />
          <SettingsTab
            icon="bell"
            label="Notifications"
            active={tab === "notifications"}
            onClick={() => setTab("notifications")}
          />
        </div>

        <div>
          {tab === "profile" && (
            <>
              <div className="card">
                <div className="profile-edit">
                  <Avatar name={settings.displayName || "Guest"} size={56} />
                  <div className="grow">
                    <b>{settings.displayName || "Set your name"}</b>
                    <div className="sub">Shown to other participants</div>
                  </div>
                  <span className={`chip ${online ? "chip-accent" : "chip-red"}`}>
                    {online ? "Server online" : online === false ? "Server offline" : "Checking"}
                  </span>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label className="label">Display name</label>
                    <input
                      className="input"
                      value={settings.displayName}
                      maxLength={64}
                      placeholder="Your name"
                      onChange={(event) => onSettings({ displayName: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="label">Signaling server</label>
                    <input
                      className="input mono"
                      value={settings.serverUrl}
                      placeholder="wss://meet.example"
                      spellCheck={false}
                      onChange={(event) => onSettings({ serverUrl: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="label">Personal room</label>
                    <div className="input-with-action">
                      <input className="input mono" value={personalRoom} readOnly />
                      <button className="icon-btn sm" onClick={() => onCopy(personalRoom)} title="Copy">
                        <Icon name="copy" size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label className="label">Shortcuts</label>
                    <button className="select" onClick={onOpenShortcuts}>
                      <Icon name="keyboard" />
                      <span className="sel-label">Keyboard shortcuts</span>
                      <Icon name="chevron-right" className="chev" />
                    </button>
                  </div>
                </div>
              </div>
              <p className="hint">
                OpenMeet never stores tokens or passwords on disk. Room passcodes live in server
                memory only.
              </p>
            </>
          )}

          {tab === "av" && (
            <>
              <div className="card">
                <div className="srow">
                  <div>
                    <b>Camera</b>
                    <div className="sub">Video source for new meetings</div>
                  </div>
                  <select
                    className="input select-input"
                    value={settings.cameraId}
                    onChange={(event) => onSettings({ cameraId: event.target.value })}
                  >
                    <option value="">System default</option>
                    {devices.cams.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="srow">
                  <div>
                    <b>Microphone</b>
                    <div className="sub">Input device for meetings</div>
                  </div>
                  <select
                    className="input select-input"
                    value={settings.micId}
                    onChange={(event) => onSettings({ micId: event.target.value })}
                  >
                    <option value="">System default</option>
                    {devices.mics.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="srow">
                  <div>
                    <b>Speaker</b>
                    <div className="sub">Output device for meeting audio</div>
                  </div>
                  <select
                    className="input select-input"
                    value={settings.speakerId}
                    onChange={(event) => onSettings({ speakerId: event.target.value })}
                  >
                    <option value="">System default</option>
                    {devices.speakers.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="card">
                <div className="srow">
                  <div>
                    <b>Join muted</b>
                    <div className="sub">Start every call with the microphone off</div>
                  </div>
                  <Switch checked={settings.startMuted} onChange={(value) => onSettings({ startMuted: value })} />
                </div>
                <div className="srow">
                  <div>
                    <b>Join with camera off</b>
                    <div className="sub">Camera stays off until you enable it</div>
                  </div>
                  <Switch checked={settings.startVideoOff} onChange={(value) => onSettings({ startVideoOff: value })} />
                </div>
              </div>
            </>
          )}

          {tab === "appearance" && (
            <>
              <div className="card">
                <div className="card-pad">
                  <div className="sgroup-title">Theme</div>
                  <div className="sub">Meeting rooms always use dark mode for focus.</div>
                </div>
                <div className="theme-cards">
                  {(["dark", "light", "system"] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={`theme-card ${prefs.theme === mode ? "active" : ""}`}
                      onClick={() => onPrefs({ theme: mode })}
                    >
                      <span className={`theme-preview ${mode}`} />
                      <span className="theme-label">{mode[0].toUpperCase() + mode.slice(1)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="srow">
                  <div>
                    <b>Accent color</b>
                    <div className="sub">Buttons, highlights and the active speaker ring</div>
                  </div>
                  <div className="swatches">
                    {ACCENTS.map((accent) => (
                      <button
                        key={accent.id}
                        className={`swatch ${prefs.accent === accent.id ? "active" : ""}`}
                        style={{ ["--c" as string]: accent.c }}
                        onClick={() => onPrefs({ accent: accent.id })}
                        title={accent.label}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === "notifications" && (
            <div className="card">
              <div className="srow">
                <div>
                  <b>Meeting reminders</b>
                  <div className="sub">Notify 5 minutes before a scheduled room</div>
                </div>
                <Switch
                  checked={prefs.notifications.reminders}
                  onChange={(value) => onPrefs({ notifications: { ...prefs.notifications, reminders: value } })}
                />
              </div>
              <div className="srow">
                <div>
                  <b>Chat notifications</b>
                  <div className="sub">Desktop notification when the window is in the background</div>
                </div>
                <Switch
                  checked={prefs.notifications.chat}
                  onChange={(value) => onPrefs({ notifications: { ...prefs.notifications, chat: value } })}
                />
              </div>
              <div className="srow">
                <div>
                  <b>Weekly digest</b>
                  <div className="sub">Summary of meeting time (roadmap)</div>
                </div>
                <Switch
                  checked={prefs.notifications.weekly}
                  onChange={(value) => onPrefs({ notifications: { ...prefs.notifications, weekly: value } })}
                />
              </div>
            </div>
          )}

          <p className="hint settings-foot">
            OpenMeet 0.1.0 · Apache-2.0 · self-hostable · no telemetry
          </p>
        </div>
      </div>
    </section>
  );
}

function SettingsTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`stab ${active ? "active" : ""}`} onClick={onClick}>
      <Icon name={icon} /> {label}
    </button>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span />
    </label>
  );
}
